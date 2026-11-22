import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  HTTP_AUTH_KIND,
  buildHttpAuthTemplate,
  encodeAuthHeader,
  sha256Hex,
  verifyHttpAuth,
} from "../src/lib/httpauth";

const URL_ = "https://handlepay.example/api/names";
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ action: "claim", name: "carol" });

async function signed(sk = generateSecretKey(), over: Partial<{ url: string; method: string; body: string; now: number }> = {}) {
  const template = await buildHttpAuthTemplate({ url: URL_, method: "POST", body: BODY, now: NOW, ...over });
  return { sk, event: finalizeEvent(template, sk) };
}

const check = (header: string | null, over: Partial<{ url: string; method: string; body: string; now: number }> = {}) =>
  verifyHttpAuth(header, { url: URL_, method: "POST", body: BODY, now: NOW, ...over });

describe("sha256Hex", () => {
  it("matches the known hash of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("verifyHttpAuth", () => {
  it("accepts a fresh, correctly signed request and reports who signed it", async () => {
    const { sk, event } = await signed();
    const r = await check(encodeAuthHeader(event));
    expect(r).toEqual({ ok: true, pubkey: getPublicKey(sk), eventId: event.id });
  });

  it("uses the kind NIP-98 names", async () => {
    expect((await signed()).event.kind).toBe(HTTP_AUTH_KIND);
    expect(HTTP_AUTH_KIND).toBe(27235);
  });

  it("refuses a missing, non-Nostr or garbled header", async () => {
    expect((await check(null)).ok).toBe(false);
    expect((await check("Bearer abc")).ok).toBe(false);
    expect((await check("Nostr !!!notbase64")).ok).toBe(false);
    expect((await check(`Nostr ${btoa("{}")}`)).ok).toBe(false);
    expect((await check(`Nostr ${btoa("not json")}`)).ok).toBe(false);
  });

  it("refuses an oversized header", async () => {
    expect((await check(`Nostr ${"A".repeat(5000)}`)).ok).toBe(false);
  });

  it("refuses a signature made for a different address", async () => {
    const { event } = await signed(undefined, { url: "https://other.example/api/names" });
    const r = await check(encodeAuthHeader(event));
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/different address/);
  });

  it("refuses the same address with a different path", async () => {
    const { event } = await signed(undefined, { url: "https://handlepay.example/api/other" });
    expect((await check(encodeAuthHeader(event))).ok).toBe(false);
  });

  it("ignores a query string on the signed URL, since the endpoint is what matters", async () => {
    const { event } = await signed(undefined, { url: `${URL_}?x=1` });
    expect((await check(encodeAuthHeader(event))).ok).toBe(true);
  });

  it("refuses a different method", async () => {
    const { event } = await signed(undefined, { method: "GET" });
    expect((await check(encodeAuthHeader(event))).ok).toBe(false);
  });

  it("refuses when the body isn't the one that was signed", async () => {
    const { event } = await signed();
    const r = await check(encodeAuthHeader(event), { body: JSON.stringify({ action: "claim", name: "mallory2" }) });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/body/);
  });

  it("refuses a request that is too old or too far ahead", async () => {
    const old = await signed(undefined, { now: NOW - 61 });
    expect((await check(encodeAuthHeader(old.event))).ok).toBe(false);
    const future = await signed(undefined, { now: NOW + 61 });
    expect((await check(encodeAuthHeader(future.event))).ok).toBe(false);
    const edge = await signed(undefined, { now: NOW - 60 });
    expect((await check(encodeAuthHeader(edge.event))).ok).toBe(true);
  });

  it("refuses an event of the wrong kind", async () => {
    const sk = generateSecretKey();
    const t = await buildHttpAuthTemplate({ url: URL_, method: "POST", body: BODY, now: NOW });
    const event = finalizeEvent({ ...t, kind: 1 }, sk);
    expect((await check(encodeAuthHeader(event))).ok).toBe(false);
  });

  it("refuses a changed field even when the old signature is attached", async () => {
    const { event } = await signed();
    const forged: NostrEvent = { ...event, tags: event.tags.map((t) => (t[0] === "u" ? ["u", URL_] : t)), content: "x" };
    expect((await check(encodeAuthHeader(forged))).ok).toBe(false);
  });

  it("refuses someone else's signature pasted onto an event naming a different key", async () => {
    const a = await signed();
    const b = await signed();
    const frankenstein: NostrEvent = { ...b.event, sig: a.event.sig };
    expect((await check(encodeAuthHeader(frankenstein))).ok).toBe(false);
  });

  it("is not fooled by an event object that carries a cached 'verified' mark", async () => {
    const a = await signed();
    const b = await signed();
    // verifyEvent caches success on the object; spreading copies that mark. A swapped sig must still fail.
    const { verifyEvent } = await import("nostr-tools/pure");
    expect(verifyEvent(a.event)).toBe(true);
    const swapped: NostrEvent = { ...a.event, sig: b.event.sig };
    expect((await check(encodeAuthHeader(swapped))).ok).toBe(false);
  });
});
