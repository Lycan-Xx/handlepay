import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRICE_SOURCES, PRICE_TTL_MS, getUsdPerBch, resetPriceCache } from "../src/lib/price";

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

describe("price sources", () => {
  it("read the real response shapes", () => {
    const [gecko, kraken] = PRICE_SOURCES;
    expect(gecko.read({ "bitcoin-cash": { usd: 208.03 } })).toBe(208.03);
    expect(kraken.read({ error: [], result: { BCHUSD: { c: ["208.010000", "0.24"] } } })).toBe(208.01);
  });

  it("reject missing, zero or junk prices", () => {
    const [gecko, kraken] = PRICE_SOURCES;
    expect(gecko.read({})).toBeNull();
    expect(gecko.read({ "bitcoin-cash": { usd: 0 } })).toBeNull();
    expect(kraken.read({ result: { BCHUSD: { c: ["abc"] } } })).toBeNull();
    expect(kraken.read(null)).toBeNull();
  });
});

describe("getUsdPerBch", () => {
  beforeEach(() => resetPriceCache());

  it("falls back to the second source when the first fails", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("blocked"))
      .mockResolvedValueOnce(json({ result: { BCHUSD: { c: ["300.5"] } } }));
    const price = await getUsdPerBch({ fetchFn, now: () => 1 });
    expect(price).toMatchObject({ usdPerBch: 300.5, source: "Kraken" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("skips a source that answers with an error status", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({}, false))
      .mockResolvedValueOnce(json({ result: { BCHUSD: { c: ["250"] } } }));
    expect((await getUsdPerBch({ fetchFn, now: () => 1 })).usdPerBch).toBe(250);
  });

  it("caches for 60 seconds, then fetches again", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ "bitcoin-cash": { usd: 200 } }));
    let t = 1_000;
    await getUsdPerBch({ fetchFn, now: () => t });
    t += PRICE_TTL_MS - 1;
    await getUsdPerBch({ fetchFn, now: () => t });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t += 2;
    await getUsdPerBch({ fetchFn, now: () => t });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws a readable error when every source fails", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(getUsdPerBch({ fetchFn })).rejects.toThrow("Couldn't get the BCH price");
  });
});
