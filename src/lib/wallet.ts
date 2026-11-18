import { binToHex, encodeTransaction, publicKeyToP2pkhCashAddress } from "@bitauth/libauth";
import { sourceOutputToRelay } from "@wizardconnect/core/hdwalletv1-serialize";
import type { DappConnectionManager } from "@wizardconnect/dapp";
import { TransactionBuilder, placeholderP2PKHUnlocker, type SpendableUtxo } from "cashscript";
import { PREFIX, getProvider, type BchNetwork } from "./network";

/** WizardConnect path names and the BIP44 child index each maps to. */
const PATHS = { receive: 0, change: 1 } as const;
type PathName = keyof typeof PATHS;

/** How many addresses per path to scan for coins. Raise if a wallet has used more. */
const SCAN_DEPTH = 10;

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

export interface SendResult {
  txid: string;
  signedTransaction: string;
}

/**
 * Pay `amount` satoshis to `to` from the connected wallet.
 *
 * Steps: pick coins, build the transaction with placeholder unlockers, tell the
 * wallet which HD key signs each input (inputPaths), let the wallet sign and
 * broadcast, then return the txid.
 */
export async function sendBch(opts: {
  manager: DappConnectionManager;
  network: BchNetwork;
  coins: WalletCoin[];
  to: string;
  amount: bigint;
  changeAddress: string;
  userPrompt?: string;
  opReturn?: string[];
}): Promise<SendResult> {
  const { manager, network, coins, to, amount, changeAddress, userPrompt, opReturn } = opts;

  // Largest coins first; stop once we cover amount plus a fee buffer.
  const sorted = [...coins].sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1));
  const feeBuffer = 2_000n;
  const picked: WalletCoin[] = [];
  let total = 0n;
  for (const coin of sorted) {
    picked.push(coin);
    total += coin.satoshis;
    if (total >= amount + feeBuffer) break;
  }
  if (total < amount + feeBuffer) {
    throw new Error(`Not enough funds: have ${total} sats, need about ${amount + feeBuffer}.`);
  }

  const builder = new TransactionBuilder({ provider: getProvider(network), maximumFeeSatsPerByte: 5 });
  for (const coin of picked) builder.addInput(coin, placeholderP2PKHUnlocker(coin.owner.address));
  if (amount > 0n) builder.addOutput({ to, amount });
  if (opReturn) builder.addOpReturnOutput(opReturn);
  builder.addBchChangeOutputIfNeeded({ to: changeAddress, feeRate: 1 });

  const wc = builder.generateWcTransactionObject({ broadcast: true, userPrompt });

  // WizardConnect sends JSON over a relay, so the dapp must serialise the
  // libauth objects itself: transaction as hex, source outputs via the
  // library's relay format (hex strings, "<bigint: Nn>" values).
  const request = {
    transaction: {
      transaction: binToHex(encodeTransaction(wc.transaction)),
      sourceOutputs: wc.sourceOutputs.map(sourceOutputToRelay),
      broadcast: true,
      userPrompt,
    },
    inputPaths: picked.map(
      (coin, i) => [i, coin.owner.path, coin.owner.index] as [number, string, number],
    ),
  };

  // The relay-format source outputs are plain JSON, not libauth types, so the
  // request is cast to the manager's parameter type.
  const response = await manager.signTransaction(
    request as unknown as Parameters<DappConnectionManager["signTransaction"]>[0],
  );
  if (response.error) throw new Error(response.error);

  const txid = await txidOf(response.signedTransaction);
  return { txid, signedTransaction: response.signedTransaction };
}

/** Transaction id = double-SHA256 of the raw transaction, byte-reversed. */
async function txidOf(rawHex: string): Promise<string> {
  const bytes = Uint8Array.from(rawHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const once = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const twice = new Uint8Array(await crypto.subtle.digest("SHA-256", once));
  return binToHex(twice.reverse());
}
