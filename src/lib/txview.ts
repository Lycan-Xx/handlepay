/**
 * Turn a raw transaction into something a person can read: who paid, who got
 * paid, the fee, and any HandlePay proof inside it. Pure functions; the page
 * does the fetching.
 */
import {
  binToHex,
  decodeTransaction,
  hashTransaction,
  hexToBin,
  lockingBytecodeToCashAddress,
  type TransactionCommon,
} from "@bitauth/libauth";
import { PROOF_MAGIC, parseProofOutput } from "./binding";
import { PREFIX, type BchNetwork } from "./network";

export interface TxInputView {
  prevTxid: string;
  vout: number;
  /** Filled in when the parent transaction was available. */
  address?: string;
  sats?: bigint;
}

export interface TxOutputView {
  n: number;
  sats: bigint;
  /** Readable address for standard outputs. */
  address?: string;
  /** Hex of the data pushes when this is an OP_RETURN output. */
  data?: string;
  /** Nostr key committed by an HPAY v1 proof output. */
  hpayPubkey?: string;
  /** An OP_RETURN that starts with HPAY but isn't the exact v1 form. */
  hpayMalformed?: boolean;
  /** Carries CashTokens (shown, not decoded). */
  hasToken?: boolean;
}

export interface TxView {
  txid: string;
  size: number;
  version: number;
  locktime: number;
  inputs: TxInputView[];
  outputs: TxOutputView[];
  totalOut: bigint;
  /** Known only when every parent was found. */
  totalIn?: bigint;
  fee?: bigint;
  /** Sats per byte, rounded to 2 places, when the fee is known. */
  feeRate?: number;
}

export const isTxid = (s: string) => /^[0-9a-f]{64}$/.test(s);

/**
 * Decode `hex` and check it hashes to `txid`, so a server can't show us a
 * different transaction under this id. `parents` maps txid → raw hex.
 */
export function describeTransaction(
  txid: string,
  hex: string,
  network: BchNetwork,
  parents: Map<string, string> = new Map(),
): TxView {
  const bin = hexToBin(hex);
  if (hashTransaction(bin) !== txid) throw new Error("The server returned a different transaction than the one asked for.");
  const tx = decode(hex);
  if (!tx) throw new Error("This transaction couldn't be decoded.");

  const prefix = PREFIX[network];
  const parentTxs = new Map<string, TransactionCommon | null>();
  for (const [id, h] of parents) parentTxs.set(id, decode(h));

  const inputs: TxInputView[] = tx.inputs.map((input) => {
    const prevTxid = binToHex(input.outpointTransactionHash);
    const spent = parentTxs.get(prevTxid)?.outputs[input.outpointIndex];
    return {
      prevTxid,
      vout: input.outpointIndex,
      ...(spent ? { address: toAddress(spent.lockingBytecode, prefix), sats: spent.valueSatoshis } : {}),
    };
  });

  const outputs: TxOutputView[] = tx.outputs.map((o, n) => {
    const view: TxOutputView = { n, sats: o.valueSatoshis };
    if (o.token) view.hasToken = true;
    if (o.lockingBytecode[0] === 0x6a) {
      view.data = binToHex(o.lockingBytecode.slice(1));
      const pubkey = parseProofOutput(o.lockingBytecode);
      if (pubkey) view.hpayPubkey = pubkey;
      else if (binToHex(o.lockingBytecode).startsWith(`6a04${PROOF_MAGIC}`)) view.hpayMalformed = true;
    } else {
      view.address = toAddress(o.lockingBytecode, prefix);
    }
    return view;
  });

  const totalOut = outputs.reduce((s, o) => s + o.sats, 0n);
  const allKnown = inputs.every((i) => i.sats !== undefined);
  const totalIn = allKnown ? inputs.reduce((s, i) => s + (i.sats ?? 0n), 0n) : undefined;
  const fee = totalIn !== undefined ? totalIn - totalOut : undefined;

  return {
    txid,
    size: bin.length,
    version: tx.version,
    locktime: tx.locktime,
    inputs,
    outputs,
    totalOut,
    ...(totalIn !== undefined ? { totalIn } : {}),
    ...(fee !== undefined ? { fee, feeRate: Math.round((Number(fee) / bin.length) * 100) / 100 } : {}),
  };
}

function decode(hex: string): TransactionCommon | null {
  const tx = decodeTransaction(hexToBin(hex));
  return typeof tx === "string" ? null : tx;
}

function toAddress(lockingBytecode: Uint8Array, prefix: "bchtest" | "bitcoincash"): string | undefined {
  const r = lockingBytecodeToCashAddress({ bytecode: lockingBytecode, prefix });
  return typeof r === "string" ? undefined : r.address;
}
