/**
 * BCH/USD price for showing dollar amounts. Two public endpoints that answer a
 * browser without an API key (both checked Nov 19): CoinGecko first, Kraken as
 * the fallback. The result is cached for 60 seconds.
 *
 * The price only converts what the user sees; the wallet always shows the real
 * BCH amount before signing, and the page shows BCH beside every dollar figure.
 */

export interface PriceSource {
  name: string;
  url: string;
  /** Pull USD per BCH out of the JSON body, or null if it isn't there. */
  read(json: unknown): number | null;
}

const positive = (n: unknown): number | null => {
  const v = typeof n === "string" ? Number(n) : n;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
};

export const PRICE_SOURCES: PriceSource[] = [
  {
    name: "CoinGecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd",
    read: (json) => positive((json as { "bitcoin-cash"?: { usd?: unknown } })?.["bitcoin-cash"]?.usd),
  },
  {
    name: "Kraken",
    url: "https://api.kraken.com/0/public/Ticker?pair=BCHUSD",
    // c = last trade [price, volume]
    read: (json) => positive((json as { result?: { BCHUSD?: { c?: unknown[] } } })?.result?.BCHUSD?.c?.[0]),
  },
];

export interface Price {
  usdPerBch: number;
  source: string;
  /** Milliseconds since the epoch when it was fetched. */
  at: number;
}

export const PRICE_TTL_MS = 60_000;

let cached: Price | null = null;

/** Clear the cache (tests). */
export function resetPriceCache(): void {
  cached = null;
}

/**
 * Current USD per BCH. Tries each source in order and returns the first good
 * answer; throws a readable error if none answered.
 */
export async function getUsdPerBch(opts?: {
  fetchFn?: typeof fetch;
  now?: () => number;
  sources?: PriceSource[];
}): Promise<Price> {
  const now = opts?.now ?? Date.now;
  if (cached && now() - cached.at < PRICE_TTL_MS) return cached;
  const fetchFn = opts?.fetchFn ?? fetch;
  for (const source of opts?.sources ?? PRICE_SOURCES) {
    try {
      const res = await fetchFn(source.url, { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) continue;
      const usdPerBch = source.read(await res.json());
      if (usdPerBch) {
        cached = { usdPerBch, source: source.name, at: now() };
        return cached;
      }
    } catch {
      /* try the next source */
    }
  }
  throw new Error("Couldn't get the BCH price. You can still pay an amount in BCH.");
}
