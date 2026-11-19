import { MockNetworkProvider } from "cashscript";
import { finalizeEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { makeMallory, runFakeClaim, tamperLink } from "../src/lib/attack";
import { buildBindingEvent, proofOpReturnChunks } from "../src/lib/binding";
import type { ChainTx } from "../src/lib/network";
import { paymentGate, resolveHandle, type ResolveDeps } from "../src/lib/resolve";
import { buildSignRequest, txidOf } from "../src/lib/wallet";
import { fundingTx, nostrKey, owner, testKey } from "./helpers";

const HANDLE = "sani@lycanforge.com.ng";

/** Sani, verified for real: a confirmed proof from her address and a signed binding. */
async function verifiedSani() {
  const key = nostrKey("sani");
  const addr = owner("sani");
  const funding = fundingTx([{ owner: addr, satoshis: 10_000n }], "sani-attack");
  const proofHex = buildSignRequest({
    network: "chipnet",
    coins: funding.coins,
    amount: 0n,
    changeAddress: addr.address,
    opReturn: proofOpReturnChunks(key.pubkey),
    provider: new MockNetworkProvider(),
  }).transaction.transaction;
  const proofTxid = txidOf(proofHex);
  const txs = new Map<string, ChainTx>([
    [funding.txid, { hex: funding.hex, confirmations: 5 }],
    [proofTxid, { hex: proofHex, confirmations: 3 }],
  ]);
  const binding = finalizeEvent(buildBindingEvent({ address: addr.address, proofTxid, network: "chipnet", nip05: HANDLE }), key.secretKey);
  const deps: ResolveDeps = {
    fetchNip05: async () => ({ pubkey: key.pubkey, relays: [] }),
    queryEvents: async () => [binding],
    getTransaction: async (txid) => {
      const tx = txs.get(txid);
      if (!tx) throw new Error("not found");
      return tx;
    },
  };
  const victim = await resolveHandle(HANDLE, "chipnet", deps);
  return { victim, deps, addr };
}

const mallory = makeMallory("chipnet", testKey("mallory").privateKey);

describe("fake claim on a verified address", () => {
  it("leaves Mallory Claimed when she names the address with no proof", async () => {
    const { victim, deps } = await verifiedSani();
    expect(victim.status).toBe("verified");
    const { noProof } = await runFakeClaim(victim, mallory, "chipnet", deps);
    expect(noProof.status).toBe("claimed");
    expect(noProof.reason).toBe("No BCH proof from this address");
    expect(noProof.address).toBe(victim.address);
    expect(paymentGate(noProof)).toBe("confirm_unverified");
  });

  it("leaves Mallory Claimed when she reuses the victim's real proof", async () => {
    const { victim, deps } = await verifiedSani();
    const { replay } = await runFakeClaim(victim, mallory, "chipnet", deps);
    expect(replay.status).toBe("claimed");
    expect(replay.reason).toBe("Proof names a different Nostr key");
    // The proof really was paid from the address; it just commits to Sani's key, not Mallory's.
    expect(replay.checks.find((c) => c.id === "spends")?.ok).toBe(true);
    expect(replay.checks.find((c) => c.id === "commits")?.ok).toBe(false);
  });

  it("refuses to run without a verified victim", async () => {
    await expect(runFakeClaim({ status: "not_found", checks: [] }, mallory, "chipnet", {} as ResolveDeps)).rejects.toThrow();
  });
});

describe("tampered pay link", () => {
  it("ignores ?to= and keeps paying the verified address", async () => {
    const { victim, addr } = await verifiedSani();
    const link = tamperLink(HANDLE, victim, mallory);
    expect(link.href).toContain(`to=${mallory.address}`);
    expect(link.href.startsWith("/pay/sani@lycanforge.com.ng?")).toBe(true);
    expect(link.params.ignored).toEqual(["to"]);
    expect(link.params.amountUsd).toBe(250);
    expect(link.recipient).toBe(addr.address);
    expect(link.recipient).not.toBe(mallory.address);
  });

  it("makes a fresh attacker each time", () => {
    expect(makeMallory("chipnet").pubkey).not.toBe(makeMallory("chipnet").pubkey);
    expect(makeMallory("mainnet").address.startsWith("bitcoincash:")).toBe(true);
  });
});
