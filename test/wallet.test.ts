import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import { MockNetworkProvider } from "cashscript";
import { describe, expect, it } from "vitest";
import {
  FEE_BUFFER,
  InsufficientFundsError,
  buildSignRequest,
  feeOf,
  formatBch,
  selectCoins,
  txidOf,
} from "../src/lib/wallet";
import { lockingHex, owner, testAddress, testCoin } from "./helpers";

const provider = new MockNetworkProvider();
const alice = owner("alice");
const aliceChange = owner("alice-change", "change", 0);
const bob = testAddress("bob");

function decode(hex: string) {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === "string") throw new Error(tx);
  return tx;
}

describe("selectCoins", () => {
  it("picks largest coins first and stops once amount + buffer is covered", () => {
    const small = testCoin(alice, 3_000n);
    const big = testCoin(alice, 50_000n);
    const mid = testCoin(alice, 10_000n);
    expect(selectCoins([small, big, mid], 40_000n)).toEqual([big]);
    expect(selectCoins([small, big, mid], 55_000n)).toEqual([big, mid]);
  });

  it("restricts to one address when asked", () => {
    const fromAlice = testCoin(alice, 5_000n);
    const fromChange = testCoin(aliceChange, 100_000n);
    expect(selectCoins([fromChange, fromAlice], 0n, alice.address)).toEqual([fromAlice]);
  });

  it("throws a readable error when funds are short", () => {
    const coin = testCoin(alice, 1_000n);
    expect(() => selectCoins([coin], 5_000n)).toThrow(InsufficientFundsError);
    expect(() => selectCoins([coin], 5_000n)).toThrow(
      `You have 0.00001000 BCH; this needs about ${formatBch(5_000n + FEE_BUFFER)}.`,
    );
  });

  it("counts only the restricted address towards the total", () => {
    const fromChange = testCoin(aliceChange, 100_000n);
    expect(() => selectCoins([fromChange], 0n, alice.address)).toThrow(InsufficientFundsError);
  });
});

describe("buildSignRequest", () => {
  it("builds payment + change at about 1 sat/byte and survives JSON.stringify", () => {
    const coin = testCoin(alice, 100_000n);
    const request = buildSignRequest({
      network: "chipnet",
      coins: [coin],
      to: bob,
      amount: 10_000n,
      changeAddress: aliceChange.address,
      userPrompt: "test",
      provider,
    });

    // The relay uses plain JSON.stringify, which throws on BigInt.
    const json = JSON.stringify(request);
    expect(JSON.parse(json)).toEqual(request);

    const tx = decode(request.transaction.transaction);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.outputs).toHaveLength(2);
    expect(binToHex(tx.outputs[0].lockingBytecode)).toBe(lockingHex(bob));
    expect(tx.outputs[0].valueSatoshis).toBe(10_000n);
    expect(binToHex(tx.outputs[1].lockingBytecode)).toBe(lockingHex(aliceChange.address));

    const fee = 100_000n - 10_000n - tx.outputs[1].valueSatoshis;
    // 1 input (P2PKH, ~148 B once signed) + 2 outputs ≈ 226 B.
    expect(fee).toBeGreaterThanOrEqual(200n);
    expect(fee).toBeLessThanOrEqual(260n);

    expect(request.inputPaths).toEqual([[0, "receive", 0]]);
    // The wallet only signs; HandlePay broadcasts (Paytaca drops a signed payment if its own server is down).
    expect(request.transaction.broadcast).toBe(false);
    expect(request.transaction.sourceOutputs).toHaveLength(1);
  });

  it("supports an OP_RETURN-only transaction with change back to the sender", () => {
    const coin = testCoin(alice, 20_000n);
    const request = buildSignRequest({
      network: "chipnet",
      coins: [coin],
      amount: 0n,
      changeAddress: alice.address,
      opReturn: ["0x48504159", "0x01"],
      provider,
    });
    const tx = decode(request.transaction.transaction);
    expect(tx.outputs).toHaveLength(2);
    expect(binToHex(tx.outputs[0].lockingBytecode)).toBe("6a04485041590101");
    expect(tx.outputs[0].valueSatoshis).toBe(0n);
    expect(binToHex(tx.outputs[1].lockingBytecode)).toBe(lockingHex(alice.address));
  });

  it("maps every input to its HD path", () => {
    const a = testCoin(alice, 1_500n);
    const b = testCoin(owner("alice-r3", "receive", 3), 1_500n);
    const c = testCoin(owner("alice-c2", "change", 2), 1_500n);
    const request = buildSignRequest({
      network: "chipnet",
      coins: [a, b, c],
      to: bob,
      amount: 1_000n,
      changeAddress: aliceChange.address,
      provider,
    });
    expect(request.inputPaths).toEqual([
      [0, "receive", 0],
      [1, "receive", 3],
      [2, "change", 2],
    ]);
  });

  it("rejects dust payments", () => {
    const coin = testCoin(alice, 100_000n);
    expect(() =>
      buildSignRequest({ network: "chipnet", coins: [coin], to: bob, amount: 545n, changeAddress: alice.address, provider }),
    ).toThrow(/smallest payment is 546 sats/);
  });
});

describe("txidOf", () => {
  it("matches the known txid of the BCH genesis coinbase", () => {
    const genesis =
      "01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000";
    expect(txidOf(genesis)).toBe("4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b");
  });
});

describe("feeOf", () => {
  it("is inputs minus outputs of the built transaction", () => {
    const coin = testCoin(alice, 100_000n);
    const request = buildSignRequest({ network: "chipnet", coins: [coin], to: bob, amount: 10_000n, changeAddress: aliceChange.address, provider });
    const tx = decode(request.transaction.transaction);
    expect(feeOf(request.transaction.transaction, [coin])).toBe(100_000n - 10_000n - tx.outputs[1].valueSatoshis);
  });

  it("gives up on bytes that aren't a transaction, or inputs that don't cover the outputs", () => {
    const coin = testCoin(alice, 100_000n);
    const request = buildSignRequest({ network: "chipnet", coins: [coin], to: bob, amount: 10_000n, changeAddress: aliceChange.address, provider });
    expect(feeOf("00", [coin])).toBeUndefined();
    expect(feeOf(request.transaction.transaction, [{ satoshis: 1n }])).toBeUndefined();
  });
});
