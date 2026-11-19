import { binToHex, encodeTransaction, hashTransaction, hexToBin, publicKeyToP2pkhCashAddress } from "@bitauth/libauth";
import { sourceOutputToRelay } from "@wizardconnect/core/hdwalletv1-serialize";
import type { DappConnectionManager } from "@wizardconnect/dapp";
import {
  TransactionBuilder,
  placeholderP2PKHUnlocker,
  type NetworkProvider,
  type SpendableUtxo,
} from "cashscript";
import { PREFIX, getProvider, type BchNetwork } from "./network";

/** WizardConnect path names and the BIP44 child index each maps to. */
const PATHS = { receive: 0, change: 1 } as const;
export type PathName = keyof typeof PATHS;

/** How many addresses per path to scan for coins. Raise if a wallet has used more. */
const SCAN_DEPTH = 10;

/** Extra satoshis selected on top of the amount so the fee is always covered. */
export const FEE_BUFFER = 2_000n;

/** Smallest output the network relays. */
export const DUST_SATS = 546n;

export interface WalletAddress {
  path: PathName;
  index: number;
  address: string;
}

export interface WalletCoin extends SpendableUtxo {
  owner: WalletAddress;
}

/**
 * Derive the wallet's addresses from the xpubs it shared at pairing.
 * The dapp never sees private keys; it only computes addresses.
 */
export function deriveAddresses(
  manager: DappConnectionManager,
  network: BchNetwork,
  depth = SCAN_DEPTH,
): WalletAddress[] {
  const result: WalletAddress[] = [];
  for (const path of Object.keys(PATHS) as PathName[]) {
    for (let index = 0; index < depth; index++) {
      const publicKey = manager.getPubkey(PATHS[path], BigInt(index));
      if (!publicKey) continue;
      const { address } = publicKeyToP2pkhCashAddress({ publicKey, prefix: PREFIX[network] });
      result.push({ path, index, address });
    }
  }
  return result;
}

/** Fetch spendable plain-BCH coins (no CashTokens) across the scanned addresses. */
export async function getCoins(addresses: WalletAddress[], network: BchNetwork): Promise<WalletCoin[]> {
  const provider = getProvider(network);
  const perAddress = await Promise.all(
    addresses.map(async (owner) => {
      const utxos = await provider.getUtxos(owner.address);
      return utxos.filter((u) => !u.token).map((u) => ({ ...u, owner }));
    }),
  );
  return perAddress.flat();
}

export class InsufficientFundsError extends Error {
  readonly have: bigint;
  readonly need: bigint;
  constructor(have: bigint, need: bigint) {
    super(`You have ${formatBch(have)} BCH; this needs about ${formatBch(need)}.`);
    this.name = "InsufficientFundsError";
    this.have = have;
    this.need = need;
  }
}

/** Satoshis as a BCH decimal string, trailing zeros kept (8 places). */
export function formatBch(sats: bigint): string {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / 100_000_000n;
  const frac = (abs % 100_000_000n).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Pick coins largest-first until `amount` plus the fee buffer is covered.
 * `onlyFrom` restricts selection to one address (proof transactions must spend
 * only from the address being bound).
 */
export function selectCoins(coins: WalletCoin[], amount: bigint, onlyFrom?: string): WalletCoin[] {
  const pool = onlyFrom ? coins.filter((c) => c.owner.address === onlyFrom) : coins;
  const sorted = [...pool].sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));
  const need = amount + FEE_BUFFER;
  const picked: WalletCoin[] = [];
  let total = 0n;
  for (const coin of sorted) {
    picked.push(coin);
    total += coin.satoshis;
    if (total >= need) return picked;
  }
  throw new InsufficientFundsError(total, need);
}

/** The JSON-safe request WizardConnect relays to the wallet. */
export interface SignRequest {
  transaction: {
    transaction: string;
    sourceOutputs: ReturnType<typeof sourceOutputToRelay>[];
    broadcast: true;
    userPrompt?: string;
  };
  inputPaths: [number, PathName, number][];
}

export interface PaymentSpec {
  network: BchNetwork;
  /** Coins to spend, already selected. */
  coins: WalletCoin[];
  /** Recipient. Ignored when `amount` is 0 (OP_RETURN-only transactions). */
  to?: string;
  amount: bigint;
  changeAddress: string;
  userPrompt?: string;
  /** OP_RETURN chunks in CashScript form: "0x…" is hex, anything else UTF-8. */
  opReturn?: string[];
  /** Override for tests; defaults to the network's Electrum provider. */
  provider?: NetworkProvider;
}

/**
 * Build the sign request for a payment without touching the wallet.
 *
 * WizardConnect sends JSON over a relay, so the libauth objects are serialised
 * here: transaction as hex, source outputs in the library's relay format
 * (hex strings, "<bigint: Nn>" values), plus the HD path of every input.
 */
export function buildSignRequest(spec: PaymentSpec): SignRequest {
  const { network, coins, to, amount, changeAddress, userPrompt, opReturn } = spec;
  if (amount > 0n && amount < DUST_SATS) {
    throw new Error(`The smallest payment is ${DUST_SATS} sats; ${amount} is too small.`);
  }
  if (amount > 0n && !to) throw new Error("No recipient address.");

  const provider = spec.provider ?? getProvider(network);
  const builder = new TransactionBuilder({ provider, maximumFeeSatsPerByte: 5 });
  for (const coin of coins) builder.addInput(coin, placeholderP2PKHUnlocker(coin.owner.address));
  if (amount > 0n) builder.addOutput({ to: to!, amount });
  if (opReturn) builder.addOpReturnOutput(opReturn);
  builder.addBchChangeOutputIfNeeded({ to: changeAddress, feeRate: 1 });

  const wc = builder.generateWcTransactionObject({ broadcast: true, userPrompt });
  return {
    transaction: {
      transaction: binToHex(encodeTransaction(wc.transaction)),
      sourceOutputs: wc.sourceOutputs.map(sourceOutputToRelay),
      broadcast: true,
      userPrompt,
    },
    inputPaths: coins.map((coin, i) => [i, coin.owner.path, coin.owner.index]),
  };
}

export interface SendResult {
  txid: string;
  signedTransaction: string;
}

/**
 * Pay `amount` satoshis to `to` from the connected wallet.
 *
 * Steps: pick coins, build the transaction with placeholder unlockers, tell the
 * wallet which HD key signs each input (inputPaths), let the wallet sign and
 * broadcast, then return the txid. Every transaction the app makes goes
 * through here.
 */
export async function sendBch(opts: {
  manager: DappConnectionManager;
  network: BchNetwork;
  coins: WalletCoin[];
  to?: string;
  amount: bigint;
  changeAddress: string;
  userPrompt?: string;
  opReturn?: string[];
  /** Spend only coins from this address (proof transactions). */
  onlyFrom?: string;
}): Promise<SendResult> {
  const picked = selectCoins(opts.coins, opts.amount, opts.onlyFrom);
  const request = buildSignRequest({ ...opts, coins: picked });

  // The relay-format source outputs are plain JSON, not libauth types, so the
  // request is cast to the manager's parameter type.
  const response = await opts.manager.signTransaction(
    request as unknown as Parameters<DappConnectionManager["signTransaction"]>[0],
  );
  if (response.error) throw new Error(response.error);

  const txid = txidOf(response.signedTransaction);
  await ensureBroadcast(opts.network, txid, response.signedTransaction);
  return { txid, signedTransaction: response.signedTransaction };
}

/**
 * The request asks the wallet to broadcast, but not every wallet does (Selene
 * signed without broadcasting in testing). Give the network a moment to show
 * the transaction; if it still isn't known, broadcast the signed hex ourselves.
 * Re-sending an already-known transaction is harmless.
 */
async function ensureBroadcast(network: BchNetwork, txid: string, hex: string): Promise<void> {
  const provider = getProvider(network);
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await provider.getRawTransaction(txid);
      return;
    } catch {
      /* not visible yet */
    }
  }
  try {
    await provider.sendRawTransaction(hex);
  } catch (e) {
    // An "already known" error means the wallet's broadcast landed after all.
    if (!/already|known|duplicate|txn-already/i.test((e as Error).message)) throw e;
  }
}

/** Transaction id of a raw transaction (double SHA-256, byte-reversed hex). */
export function txidOf(rawHex: string): string {
  return hashTransaction(hexToBin(rawHex));
}
