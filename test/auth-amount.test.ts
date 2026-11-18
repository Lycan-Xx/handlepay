import { finalizeEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { parseUsd, satsToUsd, usdToSats } from "../src/lib/amount";
import { buildAuthTemplate, createChallenge, verifyAuthEvent } from "../src/lib/auth";
import { nostrKey } from "./helpers";

describe("challenge–response sign-in", () => {
  const key = nostrKey("auth");
  const origin = "https://handlepay.example";
  const now = 1_700_000_000;
  const challenge = createChallenge();
  const signed = finalizeEvent(buildAuthTemplate(challenge, origin, now), key.secretKey);
  const expected = { challenge, origin, pubkey: key.pubkey, now };

  it("makes 32-byte hex challenges that differ each time", () => {
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(createChallenge()).not.toBe(challenge);
  });

  it("accepts a fresh, correctly signed response", () => {
    expect(verifyAuthEvent(signed, expected)).toEqual({ ok: true, pubkey: key.pubkey });
  });

  it.each([
    ["wrong challenge", { challenge: createChallenge() }, "Signed a different challenge"],
    ["wrong site", { origin: "https://evil.example" }, "Signed for a different site"],
    ["stale (6 min)", { now: now + 360 }, "Sign-in expired; try again"],
    ["other pubkey", { pubkey: nostrKey("other").pubkey }, "Signed with a key this name doesn't use"],
  ])("rejects %s", (_, override, reason) => {
    expect(verifyAuthEvent(signed, { ...expected, ...override })).toEqual({ ok: false, reason });
  });

  it("rejects a tampered event", () => {
    const tampered = { ...signed, tags: [["challenge", createChallenge()], ["relay", origin]] };
    expect(verifyAuthEvent(tampered, expected)).toEqual({ ok: false, reason: "Signature is invalid" });
  });
});

describe("amounts", () => {
  it("parses USD from links and inputs", () => {
    expect(parseUsd("0.25")).toBe(0.25);
    expect(parseUsd("$5")).toBe(5);
    for (const bad of ["", "0", "-1", "1.234", "abc", "1e3", null]) expect(parseUsd(bad)).toBeNull();
  });

  it("converts USD to whole sats, rounding", () => {
    // $0.25 at $480/BCH = 0.00052083… BCH
    expect(usdToSats(0.25, 480)).toBe(52_083n);
    expect(satsToUsd(52_083n, 480)).toBeCloseTo(0.25, 4);
  });

  it("enforces the 546-sat dust floor", () => {
    expect(() => usdToSats(0.001, 480)).toThrow(/minimum of 546 sats/);
  });

  it("refuses without a price", () => {
    expect(() => usdToSats(1, 0)).toThrow("No BCH price available.");
  });
});
