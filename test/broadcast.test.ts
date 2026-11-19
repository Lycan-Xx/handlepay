import { binToHex, encodeTransaction, hashTransaction, hexToBin, utf8ToBin } from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import { electrumScripthash, ensureBroadcast, type BroadcastProvider } from "../src/lib/broadcast";
import { lockingHex, owner, testAddress } from "./helpers";

const alice = owner("bc-alice");
const aliceChange = owner("bc-alice-change", "change", 0);
const bob = testAddress("bc-bob");
const parentTxid = "11".repeat(32);

/** A one-input transaction spending parentTxid:0 from Alice. */
function tx(outputs: { to: string; sats: bigint }[], unlock = "a") {
  const bin = encodeTransaction({
    version: 2,
    locktime: 0,
    inputs: [
      {
        outpointTransactionHash: hexToBin(parentTxid),
        outpointIndex: 0,
        sequenceNumber: 0xfffffffe,
        unlockingBytecode: utf8ToBin(unlock),
      },
    ],
    outputs: outputs.map((o) => ({ lockingBytecode: hexToBin(lockingHex(o.to)), valueSatoshis: o.sats })),
  });
  return { hex: binToHex(bin), txid: hashTransaction(bin) };
}

/** A fake Electrum server: a set of known transactions and per-address history. */
function server(opts: { known?: Record<string, string>; history?: Record<string, string[]>; sendError?: string }) {
  const known = { ...opts.known };
  const sent: string[] = [];
  const provider: BroadcastProvider = {
    async getRawTransaction(id) {
      if (!(id in known)) throw new Error("No such mempool or blockchain transaction");
      return known[id];
    },
    async sendRawTransaction(hex) {
      sent.push(hex);
      if (opts.sendError) throw new Error(opts.sendError);
      return "ok";
    },
    async performRequest(method, scripthash) {
      const ids = opts.history?.[scripthash as string] ?? [];
      return method === "blockchain.scripthash.get_mempool" ? ids.map((tx_hash) => ({ tx_hash })) : [];
    },
  };
  return { provider, sent };
}

const waits = { before: [0], after: [0, 0] };
const base = { inputAddresses: [alice.address], changeAddress: aliceChange.address, waits };

describe("ensureBroadcast", () => {
  const ours = tx([
    { to: bob, sats: 10_000n },
    { to: aliceChange.address, sats: 5_000n },
  ]);

  it("does nothing more when the wallet's broadcast already landed", async () => {
    const { provider, sent } = server({ known: { [ours.txid]: ours.hex } });
    expect(await ensureBroadcast({ ...base, provider, txid: ours.txid, hex: ours.hex })).toEqual({ txid: ours.txid, status: "seen" });
    expect(sent).toHaveLength(0);
  });

  it("sends the transaction itself when the network never got it (wallet on another network)", async () => {
    const { provider, sent } = server({});
    expect(await ensureBroadcast({ ...base, provider, txid: ours.txid, hex: ours.hex })).toEqual({ txid: ours.txid, status: "sent" });
    expect(sent).toEqual([ours.hex]);
  });

  it("treats 'already known' as success", async () => {
    const { provider } = server({ sendError: "txn-already-in-mempool" });
    expect((await ensureBroadcast({ ...base, provider, txid: ours.txid, hex: ours.hex })).status).toBe("seen");
  });

  it("finds the wallet's own version when the coins are already spent (Paytaca)", async () => {
    // Same payment, different encoding and change: a different txid.
    const theirs = tx(
      [
        { to: bob, sats: 10_000n },
        { to: aliceChange.address, sats: 4_800n },
      ],
      "wallet-signature",
    );
    const { provider } = server({
      known: { [theirs.txid]: theirs.hex },
      history: { [electrumScripthash(alice.address)]: [theirs.txid] },
      sendError: "the transaction was rejected by network rules.\n\nMissing inputs",
    });
    expect(await ensureBroadcast({ ...base, provider, txid: ours.txid, hex: ours.hex })).toEqual({
      txid: theirs.txid,
      status: "replaced",
    });
  });

  it("does not adopt a spender that pays someone else", async () => {
    const mallory = testAddress("bc-mallory");
    const other = tx([{ to: mallory, sats: 10_000n }], "other");
    const { provider } = server({
      known: { [other.txid]: other.hex },
      history: { [electrumScripthash(alice.address)]: [other.txid] },
      sendError: "bad-txns-inputs-missingorspent",
    });
    const result = await ensureBroadcast({ ...base, provider, txid: ours.txid, hex: ours.hex });
    expect(result).toMatchObject({ txid: ours.txid, status: "unverified" });
    expect(result.detail).toContain("missingorspent");
  });

  it("still throws for a transaction the network rejects for another reason", async () => {
    const { provider } = server({ sendError: "mandatory-script-verify-flag-failed" });
    await expect(ensureBroadcast({ ...base, provider, txid: ours.txid, hex: ours.hex })).rejects.toThrow("mandatory-script");
  });
});

describe("electrumScripthash", () => {
  it("is the byte-reversed SHA-256 of the locking bytecode", () => {
    // Checked against the live chipnet Fulcrum server on Nov 19: get_history for
    // this scripthash returned the address's five transactions.
    expect(electrumScripthash("bchtest:qqxeuaneldpe2awghfsy5h9pahhm5dwwxyx2q6ymcn")).toBe(
      "b0f1775405c441a976e2f8f45f2f382057e31edab6cb0b2805004560f1162e2c",
    );
  });
});
