/**
 * Make sure a signed transaction is on the network, and find out which
 * transaction actually is.
 *
 * Every request asks the wallet to broadcast, but what lands is not always
 * the hex the wallet handed back:
 *
 * - A wallet on the wrong network broadcasts to that network, where it fails.
 *   Pairing and signing carry no network, so a mainnet-only wallet (Selene)
 *   signs chipnet transactions correctly and they never arrive. We re-send.
 * - A wallet may broadcast its own version of the transaction and return a
 *   different encoding (Paytaca, in testing). The coins are then already spent,
 *   re-sending fails with "missing inputs", and the txid computed from the
 *   returned hex isn't on the network. We look up the transaction that spent
 *   the coins and, if it pays the same outputs, report that one.
 */
import {
  binToHex,
  cashAddressToLockingBytecode,
  decodeTransaction,
  hexToBin,
  sha256,
  type TransactionCommon,
} from "@bitauth/libauth";

/** The slice of the Electrum provider this needs; a fake stands in for tests. */
export interface BroadcastProvider {
  getRawTransaction(txid: string): Promise<string>;
  sendRawTransaction(hex: string): Promise<string>;
  performRequest(method: string, ...params: unknown[]): Promise<unknown>;
}

export type BroadcastStatus =
  /** The network already had our transaction (the wallet's broadcast worked). */
  | "seen"
  /** The network didn't have it; we sent it ourselves. */
  | "sent"
  /** The wallet broadcast its own version; `txid` is that version. */
  | "replaced"
  /** We couldn't confirm anything reached the network. */
  | "unverified";

export interface BroadcastResult {
  txid: string;
  status: BroadcastStatus;
  /** Why the status is "unverified": the server's own words. */
  detail?: string;
}

const ALREADY = /already in block chain|txn-already/i;
const SPENT = /missing inputs|missingorspent|inputs-spent|mempool-conflict/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ensureBroadcast(opts: {
  provider: BroadcastProvider;
  txid: string;
  hex: string;
  /** Address of the coins this transaction spends' owner, per input (for the spender lookup). */
  inputAddresses: string[];
  /** Outputs to the wallet's own change address may differ in a replacement; others must match. */
  changeAddress?: string;
  /** Poll delays in ms; shortened in tests. */
  waits?: { before: number[]; after: number[] };
}): Promise<BroadcastResult> {
  const { provider, txid, hex } = opts;
  const waits = opts.waits ?? { before: [1_500, 1_500, 1_500], after: [2_000, 3_000, 4_000] };

  const known = async (id: string) => {
    try {
      await provider.getRawTransaction(id);
      return true;
    } catch {
      return false;
    }
  };

  for (const ms of waits.before) {
    await sleep(ms);
    if (await known(txid)) return { txid, status: "seen" };
  }

  try {
    await provider.sendRawTransaction(hex);
    return { txid, status: "sent" };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    if (ALREADY.test(message)) return { txid, status: "seen" };
    if (!SPENT.test(message)) throw e;

    // The coins are spent. If it was by our own transaction (a server that
    // hadn't caught up), it shows up shortly; otherwise find the spender.
    const ours = decode(hex);
    for (const ms of waits.after) {
      if (await known(txid)) return { txid, status: "seen" };
      const spender = ours && (await findMatchingSpender(provider, ours, opts.inputAddresses, opts.changeAddress));
      if (spender) return { txid: spender, status: "replaced" };
      await sleep(ms);
    }
    return { txid, status: "unverified", detail: message };
  }
}

/**
 * The transaction now spending our first input, if it pays every output we
 * asked for (change to the wallet's own address may differ).
 */
async function findMatchingSpender(
  provider: BroadcastProvider,
  ours: TransactionCommon,
  inputAddresses: string[],
  changeAddress?: string,
): Promise<string | null> {
  const first = ours.inputs[0];
  const address = inputAddresses[0];
  if (!first || !address) return null;
  const outpoint = `${binToHex(first.outpointTransactionHash)}:${first.outpointIndex}`;

  let candidates: string[];
  try {
    candidates = await recentTxids(provider, address);
  } catch {
    return null;
  }

  for (const id of candidates) {
    let tx: TransactionCommon | null;
    try {
      tx = decode(await provider.getRawTransaction(id));
    } catch {
      continue;
    }
    if (!tx) continue;
    const spendsIt = tx.inputs.some((i) => `${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}` === outpoint);
    if (spendsIt && paysSameOutputs(ours, tx, changeAddress)) return id;
  }
  return null;
}

/** Txids touching `address`: mempool first, then the newest confirmed ones. */
async function recentTxids(provider: BroadcastProvider, address: string): Promise<string[]> {
  const scripthash = electrumScripthash(address);
  const mempool = (await provider.performRequest("blockchain.scripthash.get_mempool", scripthash)) as { tx_hash: string }[];
  const history = (await provider.performRequest("blockchain.scripthash.get_history", scripthash)) as { tx_hash: string }[];
  const ids = [...(mempool ?? []), ...(history ?? []).slice(-20).reverse()].map((h) => h.tx_hash);
  return [...new Set(ids)];
}

function paysSameOutputs(ours: TransactionCommon, theirs: TransactionCommon, changeAddress?: string): boolean {
  const change = changeAddress ? lockingHex(changeAddress) : null;
  const key = (o: TransactionCommon["outputs"][number]) => `${binToHex(o.lockingBytecode)}:${o.valueSatoshis}`;
  const theirKeys = new Set(theirs.outputs.map(key));
  return ours.outputs.filter((o) => binToHex(o.lockingBytecode) !== change).every((o) => theirKeys.has(key(o)));
}

function decode(hex: string): TransactionCommon | null {
  const tx = decodeTransaction(hexToBin(hex));
  return typeof tx === "string" ? null : tx;
}

function lockingHex(address: string): string | null {
  const r = cashAddressToLockingBytecode(address);
  return typeof r === "string" ? null : binToHex(r.bytecode);
}

/** Electrum's address key: SHA-256 of the locking bytecode, byte-reversed. */
export function electrumScripthash(address: string): string {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === "string") throw new Error(r);
  return binToHex(sha256.hash(r.bytecode).slice().reverse());
}
