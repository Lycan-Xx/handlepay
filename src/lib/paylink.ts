/**
 * What a pay link may and may not decide.
 *
 * A pay link is /pay/<handle>?amount=<usd>&memo=<text>. Anyone can edit a
 * link, so its parameters are display hints only: the amount pre-fills the
 * form and the memo goes on the receipt. The recipient address never comes
 * from the link; it comes only from the verified binding (spec step 7).
 */
import { parseUsd } from "./amount";

export const MEMO_MAX = 140;

/** Parameters that look like they choose the recipient. They are ignored. */
const ADDRESS_LIKE = ["to", "address", "addr", "payto", "recipient"];

export interface PayParams {
  /** Dollar amount from the link, when it is a valid one. */
  amountUsd: number | null;
  /** The raw ?amount= text when it was present but not a valid amount. */
  badAmount?: string;
  memo?: string;
  /** Parameters present in the link that HandlePay deliberately ignores. */
  ignored: string[];
}

export function parsePayParams(search: URLSearchParams): PayParams {
  const rawAmount = search.get("amount");
  const amountUsd = parseUsd(rawAmount);
  const memo = cleanMemo(search.get("memo"));
  const ignored = [...new Set([...search.keys()].filter((k) => ADDRESS_LIKE.includes(k.toLowerCase())))];
  return {
    amountUsd,
    ...(rawAmount !== null && amountUsd === null ? { badAmount: rawAmount } : {}),
    ...(memo ? { memo } : {}),
    ignored,
  };
}

/** Parse a BCH amount like "0.0005" into satoshis. Null unless it's positive with ≤ 8 decimals. */
export function parseBchAmount(input: string | null | undefined): bigint | null {
  if (!input) return null;
  const s = input.trim();
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(s);
  if (!m) return null;
  const sats = BigInt(m[1]) * 100_000_000n + BigInt((m[2] ?? "").padEnd(8, "0"));
  return sats > 0n ? sats : null;
}

/** Collapse whitespace, drop control characters, cap the length. */
export function cleanMemo(memo: string | null | undefined): string | undefined {
  if (!memo) return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = memo.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > MEMO_MAX ? `${clean.slice(0, MEMO_MAX - 1)}…` : clean;
}

/**
 * The three honest payment states (spec "After signing"):
 * Submitted = we have a txid; Seen = the network server returns it;
 * Confirmed = it is in a block. Never say confirmed before it is.
 */
export type PaymentStage = "submitted" | "seen" | "confirmed";

export function paymentStage(seen: boolean, confirmations: number): PaymentStage {
  if (confirmations >= 1) return "confirmed";
  return seen ? "seen" : "submitted";
}

export interface Receipt {
  handle: string;
  address: string;
  sats: bigint;
  /** Dollar value at the time of paying, when a price was available. */
  usd?: number;
  memo?: string;
  txid: string;
  network: string;
  /** Milliseconds since the epoch. */
  at: number;
  explorerUrl: string;
  /** How the transaction reached the network (from ensureBroadcast). */
  broadcast?: { status: "seen" | "sent" | "replaced" | "unverified"; detail?: string };
  /** Network fee in satoshis, computed when the transaction was built. */
  fee?: bigint;
  /**
   * The payer's own addresses spent from. Shown only on the printed receipt
   * (the payer's copy), never on /tx, which anyone can open.
   */
  payerAddresses?: string[];
}

/** Plain-text receipt for the Copy button. */
export function receiptText(r: Receipt, bch: (sats: bigint) => string): string {
  return [
    `Paid ${r.handle}`,
    `Amount: ${bch(r.sats)} BCH${r.usd !== undefined ? ` (about $${r.usd.toFixed(2)})` : ""}`,
    ...(r.memo ? [`Memo: ${r.memo}`] : []),
    `To address: ${r.address}`,
    `Network: ${r.network}`,
    ...(r.fee !== undefined ? [`Network fee: ${r.fee} sats`] : []),
    `Transaction: ${r.txid}`,
    `Explorer: ${r.explorerUrl}`,
    `Time: ${new Date(r.at).toISOString()}`,
  ].join("\n");
}

/** A wallet saying the coins it was asked to spend don't exist or are spent. */
const MISSING_COINS = /missing.?inputs?|missingorspent|inputs?-spent|utxos? (is|are) missing|missing or already spent|already spent/i;

/**
 * Map a wallet or relay failure to one sentence that says what to do next.
 *
 * WizardConnect carries no network, so a wallet set to the other network signs
 * our transaction but can't find its coins: Cashonize then refuses ("one of its
 * UTXOs is missing or already spent"). That case is checked before the
 * cancellation words, because such messages also say "rejected".
 */
export function paymentErrorMessage(e: unknown, aborted: boolean, network?: "chipnet" | "mainnet"): string {
  if (aborted) return "Payment cancelled. Nothing was sent.";
  const message = e instanceof Error ? e.message : String(e);
  // Already worded by sendBch; the server's reason inside may contain "rejected", which isn't a wallet cancel.
  if (message.startsWith("Your wallet signed the payment")) return message;
  if (MISSING_COINS.test(message)) {
    const other = network === "mainnet" ? "chipnet" : "mainnet";
    return network
      ? `Your wallet couldn't find the coins for this payment, so nothing was sent. It's probably set to ${other} while this page is on ${network}: switch the wallet to ${network} and try again. If it is on ${network}, press Refresh and retry.`
      : "Your wallet couldn't find the coins for this payment, so nothing was sent. Check that the wallet and this page are on the same network, then try again.";
  }
  if (/reject|denied|declin|cancel/i.test(message)) return "Payment cancelled in your wallet. Nothing was sent.";
  return message;
}
