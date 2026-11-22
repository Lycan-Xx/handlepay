import { beforeEach, describe, expect, it } from "vitest";
import { handleAvailability, handleNamesPost, type KV } from "../functions/_lib/names";
import { HostedError, claimName, hostedHandle, isHostedHandle, HOSTED_DOMAIN, lookupName, releaseName } from "../src/lib/hosted";
import { createBrowserKey, signerFor } from "../src/lib/signer";

function memoryKV(): KV {
  const data = new Map<string, string>();
  return {
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
}

/** The browser's fetch, wired straight into the server code, so the two are tested as one. */
function wire(env: { NAMES?: KV }) {
  return async (url: string, init?: RequestInit) => {
    const request = new Request(url, init);
    return init?.method === "POST" ? handleNamesPost(request, env) : handleAvailability(request, env);
  };
}

function freshBrowser() {
  const data = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  createBrowserKey();
  return signerFor("browser");
}

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = { location: { origin: "https://handlepay.example" } };
});

describe("hosted handles", () => {
  it("builds and recognises names on the free domain", () => {
    expect(hostedHandle(" Alice ")).toBe(`alice@${HOSTED_DOMAIN}`);
    expect(isHostedHandle(`alice@${HOSTED_DOMAIN}`)).toBe(true);
    expect(isHostedHandle(`ALICE@${HOSTED_DOMAIN.toUpperCase()}`)).toBe(true);
    expect(isHostedHandle("sani@lycanforge.com.ng")).toBe(false);
    expect(isHostedHandle(`alice@evil-${HOSTED_DOMAIN}`)).toBe(false);
    expect(isHostedHandle(`alice@${HOSTED_DOMAIN}.evil.com`)).toBe(false);
  });
});

describe("browser and server together", () => {
  it("claims a name with a request the server accepts", async () => {
    const env = { NAMES: memoryKV() };
    const signer = freshBrowser();
    const result = await claimName("Carol", signer, { fetchImpl: wire(env) });
    expect(result).toEqual({ name: "carol", already: false });
  });

  it("says so when the same key claims it again", async () => {
    const env = { NAMES: memoryKV() };
    const signer = freshBrowser();
    await claimName("carol", signer, { fetchImpl: wire(env) });
    // A real browser signs a new timestamp each time; wait out the same-second id.
    await new Promise((r) => setTimeout(r, 1100));
    expect(await claimName("carol", signer, { fetchImpl: wire(env) })).toEqual({ name: "carol", already: true });
  });

  it("is told a name is taken when another key has it", async () => {
    const env = { NAMES: memoryKV() };
    await claimName("carol", freshBrowser(), { fetchImpl: wire(env) });
    const other = freshBrowser();
    await expect(claimName("carol", other, { fetchImpl: wire(env) })).rejects.toMatchObject({ name: "HostedError", code: "taken" });
  });

  it("lets the owner release a name and anyone claim it again", async () => {
    const env = { NAMES: memoryKV() };
    const owner = freshBrowser();
    await claimName("carol", owner, { fetchImpl: wire(env) });
    await releaseName("carol", owner, { fetchImpl: wire(env) });
    expect((await lookupName("carol", undefined, { fetchImpl: wire(env) })).state).toBe("available");
  });

  it("won't let another key release it", async () => {
    const env = { NAMES: memoryKV() };
    await claimName("carol", freshBrowser(), { fetchImpl: wire(env) });
    await expect(releaseName("carol", freshBrowser(), { fetchImpl: wire(env) })).rejects.toMatchObject({ code: "not_yours" });
  });
});

describe("lookupName", () => {
  it("reports available, taken, yours, invalid and reserved", async () => {
    const env = { NAMES: memoryKV() };
    const signer = freshBrowser();
    expect(await lookupName("carol", undefined, { fetchImpl: wire(env) })).toEqual({ state: "available", name: "carol" });
    await claimName("carol", signer, { fetchImpl: wire(env) });
    expect((await lookupName("carol", undefined, { fetchImpl: wire(env) })).state).toBe("taken");
    expect(await lookupName("carol", await signer.pubkey(), { fetchImpl: wire(env) })).toEqual({ state: "yours" });
    expect((await lookupName("ab", undefined, { fetchImpl: wire(env) })).state).toBe("invalid");
    expect((await lookupName("admin", undefined, { fetchImpl: wire(env) })).state).toBe("invalid");
  });

  it("doesn't even ask the server about a name that can't be valid", async () => {
    let asked = false;
    const r = await lookupName("bad name!", undefined, { fetchImpl: async () => ((asked = true), new Response("{}")) });
    expect(r.state).toBe("invalid");
    expect(asked).toBe(false);
  });

  it("says free names are unavailable when the store isn't set up, or the address isn't the API", async () => {
    expect((await lookupName("carol", undefined, { fetchImpl: wire({}) })).state).toBe("unavailable");
    const html = async () => new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } });
    expect((await lookupName("carol", undefined, { fetchImpl: html })).state).toBe("unavailable");
  });

  it("says so when the network is down", async () => {
    const r = await lookupName("carol", undefined, {
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(r).toMatchObject({ state: "unavailable" });
  });
});

describe("claim and release errors", () => {
  it("refuses an invalid name before signing anything", async () => {
    let signed = false;
    const signer = { kind: "browser" as const, pubkey: async () => "a".repeat(64), sign: async () => ((signed = true), Promise.reject(new Error("no"))) };
    await expect(claimName("ab", signer)).rejects.toBeInstanceOf(HostedError);
    await expect(releaseName("bad name", signer)).rejects.toBeInstanceOf(HostedError);
    expect(signed).toBe(false);
  });

  it("turns a network failure into a readable error", async () => {
    const signer = freshBrowser();
    await expect(
      claimName("carol", signer, {
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("turns 'store not set up' into a readable error", async () => {
    await expect(claimName("carol", freshBrowser(), { fetchImpl: wire({}) })).rejects.toMatchObject({ code: "not_configured" });
  });

  it("turns an unexpected non-JSON reply into a readable error", async () => {
    const html = async () => new Response("<html>oops</html>", { status: 500 });
    await expect(claimName("carol", freshBrowser(), { fetchImpl: html })).rejects.toBeInstanceOf(HostedError);
  });
});
