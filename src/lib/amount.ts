/** USD ↔ satoshi conversion for pay links. Amounts are always shown in BCH too. */
import { DUST_SATS, formatBch } from "./wallet";

const SATS_PER_BCH = 100_000_000;

/** Parse a user- or URL-supplied USD amount. Returns null if it isn't a positive number with ≤ 2 decimals. */
export function parseUsd(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = input.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** USD → whole satoshis at `usdPerBch`, rounded. Throws below dust. */
export function usdToSats(usd: number, usdPerBch: number): bigint {
  if (!(usdPerBch > 0) || !Number.isFinite(usdPerBch)) throw new Error("No BCH price available.");
  if (!(usd > 0) || !Number.isFinite(usd)) throw new Error("Enter an amount above zero.");
  const sats = BigInt(Math.round((usd / usdPerBch) * SATS_PER_BCH));
  if (sats < DUST_SATS) {
    throw new Error(`That's below the network minimum of ${DUST_SATS} sats (about $${satsToUsd(DUST_SATS, usdPerBch).toFixed(2)}).`);
  }
  return sats;
}

export function satsToUsd(sats: bigint, usdPerBch: number): number {
  return (Number(sats) / SATS_PER_BCH) * usdPerBch;
}

/** "$0.25 ≈ 0.00052000 BCH" */
export function describeAmount(sats: bigint, usdPerBch: number): string {
  return `$${satsToUsd(sats, usdPerBch).toFixed(2)} ≈ ${formatBch(sats)} BCH`;
}
