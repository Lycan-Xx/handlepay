import { finalizeEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { buildRevokeEvent } from "../src/lib/binding";
import {
  Nip05UnreachableError,
  RelaysUnreachableError,
  reachableRelays,
  dedupeVerified,
  fetchNip05,
  newest,
  parseHandle,
  readNip05Json,
  relaysFor,
  verifySignature,
} from "../src/lib/nostr";
import { nostrKey } from "./helpers";

const pk = "a".repeat(64);

describe("parseHandle", () => {
  it("lowercases and splits", () => {
    expect(parseHandle(" Sani@LycanForge.com.ng ")).toEqual({
      local: "sani",
      domain: "lycanforge.com.ng",
      full: "sani@lycanforge.com.ng",
      nonAscii: false,
    });
  });

  it("accepts the root name _@domain", () => {
    expect(parseHandle("_@example.com")?.local).toBe("_");
  });

  it.each(["sani", "@example.com", "sani@", "sani@localhost", "sa ni@example.com", "sani@exa mple.com"])("rejects %j", (h) => {
    expect(parseHandle(h)).toBeNull();
  });

  it("flags non-ASCII look-alikes", () => {
    expect(parseHandle("sаni@example.com")?.nonAscii).toBe(true); // Cyrillic а
  });
});

describe("readNip05Json", () => {
  it("reads the pubkey and its wss relays", () => {
    const json = { names: { sani: pk }, relays: { [pk]: ["wss://r.example", "http://bad", 3] } };
    expect(readNip05Json(json, "sani")).toEqual({ pubkey: pk, relays: ["wss://r.example"] });
  });

  it("rejects npubs and missing names", () => {
    expect(readNip05Json({ names: { sani: "npub1abc" } }, "sani")).toBeNull();
    expect(readNip05Json({ names: {} }, "sani")).toBeNull();
    expect(readNip05Json(null, "sani")).toBeNull();
  });
});

describe("fetchNip05", () => {
  const handle = parseHandle("sani@lycanforge.com.ng")!;
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("fetches directly from the domain without following redirects", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const result = await fetchNip05(handle, {
      fetchImpl: async (url, init) => {
        calls.push([url, init]);
        return ok({ names: { sani: pk } });
      },
    });
    expect(result?.pubkey).toBe(pk);
    expect(calls[0][0]).toBe("https://lycanforge.com.ng/.well-known/nostr.json?name=sani");
    expect(calls[0][1]?.redirect).toBe("error");
  });

  it("falls back to the proxy on a CORS / network failure", async () => {
    const urls: string[] = [];
    const result = await fetchNip05(handle, {
      proxy: "https://proxy.example/",
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.startsWith("https://lycanforge")) throw new TypeError("Failed to fetch");
        return ok({ names: { sani: pk } });
      },
    });
    expect(result?.pubkey).toBe(pk);
    expect(urls[1]).toBe("https://proxy.example/nip05?name=sani%40lycanforge.com.ng");
  });

  it("returns null on 404 and throws when every route fails", async () => {
    expect(await fetchNip05(handle, { fetchImpl: async () => new Response("", { status: 404 }) })).toBeNull();
    await expect(
      fetchNip05(handle, {
        proxy: "",
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ).rejects.toBeInstanceOf(Nip05UnreachableError);
  });
});

describe("relay helpers", () => {
  const key = nostrKey("relay-test");

  it("merges NIP-05 relays with defaults without duplicates", () => {
    const relays = relaysFor(["wss://nos.lol/", "wss://extra.example"]);
    expect(relays[0]).toBe("wss://nos.lol");
    expect(relays).toContain("wss://extra.example");
    expect(new Set(relays).size).toBe(relays.length);
  });

  it("dedupeVerified drops bad signatures, other authors and duplicates", () => {
    const a = finalizeEvent(buildRevokeEvent(1), key.secretKey);
    const b = finalizeEvent(buildRevokeEvent(2), key.secretKey);
    const other = finalizeEvent(buildRevokeEvent(3), nostrKey("other").secretKey);
    const forged = { ...b, content: "tampered" };
    expect(dedupeVerified([a, a, b, other, forged], key.pubkey).map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it("rejects a copied event with a swapped signature (nostr-tools caches verification on the object)", () => {
    const a = finalizeEvent(buildRevokeEvent(1), key.secretKey);
    const b = finalizeEvent(buildRevokeEvent(2), key.secretKey);
    const swapped = { ...b, sig: a.sig };
    expect(verifySignature(b)).toBe(true);
    expect(verifySignature(swapped)).toBe(false);
    expect(dedupeVerified([swapped], key.pubkey)).toEqual([]);
  });

  it("newest picks the latest created_at", () => {
    const a = finalizeEvent(buildRevokeEvent(1), key.secretKey);
    const b = finalizeEvent(buildRevokeEvent(2), key.secretKey);
    expect(newest([a, b])?.id).toBe(b.id);
    expect(newest([])).toBeUndefined();
  });
});

describe("reachableRelays", () => {
  const pool = (up: string[]) => ({
    ensureRelay: async (url: string) => {
      if (!up.includes(url)) throw new Error("connection failed");
      return {};
    },
  });

  it("keeps only the relays that accept a connection", async () => {
    expect(await reachableRelays(pool(["wss://b"]), ["wss://a", "wss://b", "wss://c"], 1000)).toEqual(["wss://b"]);
  });

  it("throws RelaysUnreachableError, not an empty answer, when none connect", async () => {
    await expect(reachableRelays(pool([]), ["wss://a", "wss://b"], 1000)).rejects.toBeInstanceOf(RelaysUnreachableError);
  });
});
