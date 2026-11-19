import { binToHex, encodeTransaction, hashTransaction, hexToBin } from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import { PROOF_MAGIC } from "../src/lib/binding";
import { explorerTx } from "../src/lib/network";
import { matchRoute } from "../src/lib/router";
import { describeTransaction, isTxid } from "../src/lib/txview";
import { lockingHex, testAddress } from "./helpers";

const alice = testAddress("tv-alice");
const bob = testAddress("tv-bob");
const pubkey = "93bff6dff051698ec24f2ea64638294f1992025b767dca1c89458d83f31740f7";

function build(inputs: { txid: string; vout: number }[], outputs: { lock: string; sats: bigint }[]) {
  const bin = encodeTransaction({
    version: 2,
    locktime: 0,
    inputs: inputs.map((i) => ({
      outpointTransactionHash: hexToBin(i.txid),
      outpointIndex: i.vout,
      sequenceNumber: 0xfffffffe,
      unlockingBytecode: new Uint8Array([0x51]),
    })),
    outputs: outputs.map((o) => ({ lockingBytecode: hexToBin(o.lock), valueSatoshis: o.sats })),
  });
  return { hex: binToHex(bin), txid: hashTransaction(bin) };
}

const parent = build([{ txid: "00".repeat(32), vout: 0 }], [{ lock: lockingHex(alice), sats: 10_000n }]);
const proof = build(
  [{ txid: parent.txid, vout: 0 }],
  [
    { lock: `6a04${PROOF_MAGIC}010120${pubkey}`, sats: 0n },
    { lock: lockingHex(alice), sats: 9_765n },
  ],
);

describe("describeTransaction", () => {
  it("reads a HandlePay proof: who paid, the committed key, the change, the fee", () => {
    const view = describeTransaction(proof.txid, proof.hex, "chipnet", new Map([[parent.txid, parent.hex]]));
    expect(view.inputs).toEqual([{ prevTxid: parent.txid, vout: 0, address: alice, sats: 10_000n }]);
    expect(view.outputs[0]).toMatchObject({ n: 0, sats: 0n, hpayPubkey: pubkey });
    expect(view.outputs[1]).toEqual({ n: 1, sats: 9_765n, address: alice });
    expect(view.fee).toBe(235n);
    expect(view.feeRate).toBeCloseTo(235 / view.size, 2);
  });

  it("leaves the fee unknown when a parent is missing, instead of guessing", () => {
    const view = describeTransaction(proof.txid, proof.hex, "chipnet");
    expect(view.inputs[0].address).toBeUndefined();
    expect(view.fee).toBeUndefined();
    expect(view.totalOut).toBe(9_765n);
  });

  it("refuses a transaction that doesn't hash to the requested id", () => {
    expect(() => describeTransaction("ab".repeat(32), proof.hex, "chipnet")).toThrow("different transaction");
  });

  it("flags an HPAY-looking output that isn't the exact v1 form", () => {
    const bad = build([{ txid: parent.txid, vout: 0 }], [{ lock: `6a04${PROOF_MAGIC}0102`, sats: 0n }]);
    expect(describeTransaction(bad.txid, bad.hex, "chipnet").outputs[0]).toMatchObject({ hpayMalformed: true });
  });

  it("shows plain OP_RETURN data and mainnet addresses", () => {
    const tx = build(
      [{ txid: parent.txid, vout: 0 }],
      [
        { lock: "6a0568656c6c6f", sats: 0n },
        { lock: lockingHex(testAddress("tv-bob", "mainnet")), sats: 1_000n },
      ],
    );
    const view = describeTransaction(tx.txid, tx.hex, "mainnet");
    expect(view.outputs[0]).toEqual({ n: 0, sats: 0n, data: "0568656c6c6f" });
    expect(view.outputs[1].address).toMatch(/^bitcoincash:/);
    expect(bob).toMatch(/^bchtest:/);
  });
});

describe("transaction links", () => {
  it("route /tx/<txid> and carry the network", () => {
    const id = "883E0BD30499A6A49C99BA70796452085FDF0DFA3D3339BCBE56FA22228811F5";
    expect(matchRoute(`/tx/${id}`)).toEqual({ name: "tx", txid: id.toLowerCase() });
    expect(matchRoute("/tx/1234").name).toBe("not_found");
    expect(explorerTx("chipnet", id.toLowerCase())).toBe(`/tx/${id.toLowerCase()}?network=chipnet`);
    expect(isTxid(id.toLowerCase())).toBe(true);
    expect(isTxid(id)).toBe(false);
  });
});
