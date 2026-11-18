import { hexToBin } from "@bitauth/libauth";
import { MockNetworkProvider } from "cashscript";
import { finalizeEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  BINDING_KIND,
  PAYTACA_D,
  PAYTACA_KIND,
  bareAddress,
  buildBindingEvent,
  buildPaytoEvent,
  buildRevokeEvent,
  checkProof,
  normalizeAddress,
  parseBindingEvent,
  parsePaytacaEvent,
  parsePaytoEvent,
  parseProofOutput,
  proofOpReturnChunks,
  type ProofInput,
} from "../src/lib/binding";
import { buildSignRequest, txidOf, type WalletCoin } from "../src/lib/wallet";
import { fundingTx, nostrKey, owner, testAddress } from "./helpers";

const provider = new MockNetworkProvider();
const sani = owner("sani");
const saniOther = owner("sani-other", "receive", 1);
const saniKey = nostrKey("sani");
const malloryKey = nostrKey("mallory");

/** Build an unsigned proof transaction through the same path the app uses. */
function proofTx(coins: WalletCoin[], pubkey: string, changeTo = sani.address) {
  const request = buildSignRequest({
    network: "chipnet",
    coins,
    amount: 0n,
    changeAddress: changeTo,
    opReturn: proofOpReturnChunks(pubkey),
    provider,
  });
  const hex = request.transaction.transaction;
  return { hex, txid: txidOf(hex) };
}

function scenario(overrides: Partial<ProofInput> = {}) {
  const funding = fundingTx([{ owner: sani, satoshis: 10_000n }]);
  const proof = proofTx(funding.coins, saniKey.pubkey);
  const input: ProofInput = {
    proofHex: proof.hex,
    proofTxid: proof.txid,
    confirmations: 1,
    parents: new Map([[funding.txid, funding.hex]]),
    address: sani.address,
    pubkey: saniKey.pubkey,
    eventNetwork: "chipnet",
    network: "chipnet",
    ...overrides,
  };
  return { input, funding, proof };
}

const failed = (checks: ReturnType<typeof checkProof>) => checks.filter((c) => !c.ok).map((c) => c.id);

describe("proof output", () => {
  it("round-trips through the OP_RETURN builder", () => {
    const funding = fundingTx([{ owner: sani, satoshis: 10_000n }]);
    const { hex } = proofTx(funding.coins, saniKey.pubkey);
    expect(hex).toContain(`6a04485041590101 20${saniKey.pubkey}`.replace(" ", ""));
  });

  it("parses the canonical form", () => {
    const script = hexToBin(`6a04485041590101 20${saniKey.pubkey}`.replace(" ", ""));
    expect(parseProofOutput(script)).toBe(saniKey.pubkey);
  });

  it.each([
    ["wrong prefix", `6a04485041580101 20${saniKey.pubkey}`],
    ["wrong version", `6a04485041590102 20${saniKey.pubkey}`],
    ["short pubkey", `6a0448504159010120${saniKey.pubkey.slice(0, 62)}`],
    ["long pubkey", `6a0448504159010121${saniKey.pubkey}00`],
    ["trailing data", `6a0448504159010120${saniKey.pubkey}0100`],
    ["not OP_RETURN", `0004485041590101 20${saniKey.pubkey}`],
    ["OP_1 instead of push", `6a044850415951 20${saniKey.pubkey}`],
  ])("rejects %s", (_, hex) => {
    expect(parseProofOutput(hexToBin(hex.replace(" ", "")))).toBeNull();
  });

  it("rejects a non-hex pubkey", () => {
    expect(() => proofOpReturnChunks("npub1xyz")).toThrow();
  });
});

describe("checkProof", () => {
  it("passes all four checks for an honest proof", () => {
    expect(failed(checkProof(scenario().input))).toEqual([]);
  });

  it("fails 'commits' when Mallory claims Sani's proof (pubkey mismatch)", () => {
    const { input } = scenario({ pubkey: malloryKey.pubkey });
    const checks = checkProof(input);
    expect(failed(checks)).toEqual(["commits"]);
    expect(checks.find((c) => c.id === "commits")?.detail).toBe("Proof names a different Nostr key");
  });

  it("fails 'spends' when Mallory's own proof names Sani's address", () => {
    const mallory = owner("mallory");
    const funding = fundingTx([{ owner: mallory, satoshis: 10_000n }]);
    const proof = proofTx(funding.coins, malloryKey.pubkey, mallory.address);
    const checks = checkProof({
      proofHex: proof.hex,
      proofTxid: proof.txid,
      confirmations: 3,
      parents: new Map([[funding.txid, funding.hex]]),
      address: sani.address,
      pubkey: malloryKey.pubkey,
      eventNetwork: "chipnet",
      network: "chipnet",
    });
    expect(failed(checks)).toEqual(["spends"]);
    expect(checks[0].detail).toBe("Proof spends a coin from a different address");
  });

  it("fails 'spends' when the proof has an extra input from another address", () => {
    const funding = fundingTx([
      { owner: sani, satoshis: 10_000n },
      { owner: saniOther, satoshis: 10_000n },
    ]);
    const proof = proofTx(funding.coins, saniKey.pubkey);
    const { input } = scenario({ proofHex: proof.hex, proofTxid: proof.txid, parents: new Map([[funding.txid, funding.hex]]) });
    expect(failed(checkProof(input))).toEqual(["spends"]);
  });

  it("fails 'confirmed' with a waiting reason when unconfirmed", () => {
    const checks = checkProof(scenario({ confirmations: 0 }).input);
    expect(failed(checks)).toEqual(["confirmed"]);
    expect(checks.find((c) => c.id === "confirmed")?.detail).toBe("Waiting for confirmation");
  });

  it("fails 'network' when the event is for another network", () => {
    expect(failed(checkProof(scenario({ eventNetwork: "mainnet" }).input))).toEqual(["network"]);
  });

  it("fails when the server returns bytes that don't hash to the txid", () => {
    const { input } = scenario();
    const other = scenario().proof;
    expect(failed(checkProof({ ...input, proofHex: other.hex }))).toEqual(["spends", "commits", "confirmed"]);
  });

  it("fails 'spends' when a parent is missing or tampered", () => {
    const { input, funding } = scenario();
    expect(failed(checkProof({ ...input, parents: new Map() }))).toEqual(["spends"]);
    const tampered = scenario().funding.hex;
    expect(failed(checkProof({ ...input, parents: new Map([[funding.txid, tampered]]) }))).toEqual(["spends"]);
  });

  it("fails 'commits' for a transaction with no HPAY output", () => {
    const funding = fundingTx([{ owner: sani, satoshis: 10_000n }]);
    const request = buildSignRequest({
      network: "chipnet",
      coins: funding.coins,
      to: testAddress("bob"),
      amount: 1_000n,
      changeAddress: sani.address,
      provider,
    });
    const hex = request.transaction.transaction;
    const { input } = scenario({ proofHex: hex, proofTxid: txidOf(hex), parents: new Map([[funding.txid, funding.hex]]) });
    const checks = checkProof(input);
    expect(failed(checks)).toEqual(["commits"]);
    expect(checks.find((c) => c.id === "commits")?.detail).toBe("No HandlePay proof in this transaction");
  });
});

describe("addresses", () => {
  it("strips and restores prefixes", () => {
    const bare = bareAddress(sani.address);
    expect(bare).not.toContain(":");
    expect(normalizeAddress(bare, "chipnet")).toBe(sani.address);
    expect(normalizeAddress(sani.address, "chipnet")).toBe(sani.address);
  });

  it("rejects the wrong network and garbage", () => {
    expect(normalizeAddress(sani.address, "mainnet")).toBeNull();
    expect(normalizeAddress("qqqq", "chipnet")).toBeNull();
  });
});

describe("binding events", () => {
  const txid = "ab".repeat(32);
  const sign = (t: Parameters<typeof finalizeEvent>[0], key = saniKey) => finalizeEvent(t, key.secretKey);

  it("builds and parses a binding with tags and content in agreement", () => {
    const template = buildBindingEvent({ address: sani.address, proofTxid: txid, network: "chipnet", nip05: "Sani@Example.com" });
    expect(template.kind).toBe(BINDING_KIND);
    expect(template.tags).toContainEqual(["payto", "bitcoincash", bareAddress(sani.address)]);
    expect(template.tags).toContainEqual(["nip05", "sani@example.com"]);
    expect(parseBindingEvent(sign(template))).toEqual({
      type: "binding",
      address: sani.address,
      proofTxid: txid,
      network: "chipnet",
      nip05: "sani@example.com",
    });
  });

  it("refuses to build for an address on the wrong network", () => {
    expect(() => buildBindingEvent({ address: sani.address, proofTxid: txid, network: "mainnet" })).toThrow();
  });

  it("parses a revocation", () => {
    expect(parseBindingEvent(sign(buildRevokeEvent()))).toEqual({ type: "revoked" });
  });

  it("rejects an event whose tags and content disagree", () => {
    const template = buildBindingEvent({ address: sani.address, proofTxid: txid, network: "chipnet" });
    template.tags = template.tags.map((t) => (t[0] === "payto" ? ["payto", "bitcoincash", bareAddress(saniOther.address)] : t));
    expect(parseBindingEvent(sign(template))).toMatchObject({ type: "invalid" });
  });

  it("rejects malformed content", () => {
    const template = buildBindingEvent({ address: sani.address, proofTxid: txid, network: "chipnet" });
    expect(parseBindingEvent(sign({ ...template, content: "not json" }))).toMatchObject({ type: "invalid" });
    expect(parseBindingEvent(sign({ ...template, content: '{"v":2}' }))).toMatchObject({ type: "invalid" });
  });

  it("reads NIP-A3 payto, accepting both prefixed and bare addresses", () => {
    expect(parsePaytoEvent(sign(buildPaytoEvent(sani.address)), "chipnet")).toBe(sani.address);
    const prefixed = { ...buildPaytoEvent(sani.address), tags: [["payto", "bitcoincash", sani.address]] };
    expect(parsePaytoEvent(sign(prefixed), "chipnet")).toBe(sani.address);
  });

  it("reads Paytaca's 30078 event as plain or JSON content", () => {
    const base = { kind: PAYTACA_KIND, created_at: 1, tags: [["d", PAYTACA_D]] };
    expect(parsePaytacaEvent(sign({ ...base, content: sani.address }), "chipnet")).toBe(sani.address);
    expect(parsePaytacaEvent(sign({ ...base, content: JSON.stringify({ address: sani.address }) }), "chipnet")).toBe(sani.address);
    expect(parsePaytacaEvent(sign({ ...base, tags: [["d", "other"]], content: sani.address }), "chipnet")).toBeNull();
  });
});
