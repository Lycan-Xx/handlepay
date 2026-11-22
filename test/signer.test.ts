import { verifyEvent } from "nostr-tools/pure";
import { beforeEach, describe, expect, it } from "vitest";
import {
  browserKeyPubkey,
  createBrowserKey,
  exportBrowserKey,
  hasBrowserKey,
  importBrowserKey,
  signerFor,
  signerHolding,
} from "../src/lib/signer";

function installStorage(opts: { broken?: boolean; dropsWrites?: boolean } = {}) {
  const data = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (opts.broken) throw new Error("QuotaExceededError");
      if (!opts.dropsWrites) data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return data;
}

const template = { kind: 1, created_at: 1_800_000_000, tags: [], content: "hello" };

beforeEach(() => {
  installStorage();
});

describe("browser key", () => {
  it("starts empty, then makes and keeps a key", () => {
    expect(hasBrowserKey()).toBe(false);
    expect(browserKeyPubkey()).toBeNull();
    const pub = createBrowserKey();
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    expect(hasBrowserKey()).toBe(true);
    expect(browserKeyPubkey()).toBe(pub);
  });

  it("refuses to replace an existing key, so a name's key can't be lost by a stray click", () => {
    const first = createBrowserKey();
    expect(() => createBrowserKey()).toThrow(/already has a key/);
    expect(browserKeyPubkey()).toBe(first);
  });

  it("signs events that verify, with the saved key", async () => {
    const pub = createBrowserKey();
    const signer = signerFor("browser");
    expect(await signer.pubkey()).toBe(pub);
    const event = await signer.sign(template);
    expect(event.pubkey).toBe(pub);
    expect(verifyEvent(event)).toBe(true);
  });

  it("refuses to sign as a key other than the expected one", async () => {
    createBrowserKey();
    await expect(signerFor("browser").sign(template, "f".repeat(64))).rejects.toThrow(/isn't the one this name uses/);
  });

  it("explains itself when there is no saved key", async () => {
    await expect(signerFor("browser").pubkey()).rejects.toThrow(/no saved key/);
    await expect(signerFor("browser").sign(template)).rejects.toThrow(/no saved key/);
  });

  it("backs up as an nsec and restores to the same key", async () => {
    const pub = createBrowserKey();
    const nsec = exportBrowserKey()!;
    expect(nsec).toMatch(/^nsec1/);
    installStorage(); // a fresh browser
    expect(hasBrowserKey()).toBe(false);
    expect(importBrowserKey(nsec)).toBe(pub);
    expect(browserKeyPubkey()).toBe(pub);
  });

  it("restores from 64 hex characters, in either case, and ignores stray spaces", () => {
    const pub = createBrowserKey();
    const nsec = exportBrowserKey()!;
    // Recover the hex via a second import round-trip.
    const data = installStorage();
    importBrowserKey(nsec);
    const hex = [...data.values()][0];
    installStorage();
    expect(importBrowserKey(`  ${hex.toUpperCase()}  `)).toBe(pub);
  });

  it("rejects things that aren't secret keys", () => {
    for (const bad of ["", "hello", "npub1qqqqqq", "nsec1notvalid", "ab".repeat(31), "zz".repeat(32)]) {
      expect(() => importBrowserKey(bad), JSON.stringify(bad)).toThrow(/secret key/);
    }
    expect(hasBrowserKey()).toBe(false);
  });

  it("says so when the browser won't store anything", () => {
    installStorage({ broken: true });
    expect(() => createBrowserKey()).toThrow(/won't let the site save a key/);
    installStorage({ dropsWrites: true });
    expect(() => createBrowserKey()).toThrow(/didn't keep the key/);
  });

  it("ignores a corrupted stored value instead of crashing", () => {
    const data = installStorage();
    data.set("handlepay-browser-key", "not a key");
    expect(hasBrowserKey()).toBe(false);
    expect(browserKeyPubkey()).toBeNull();
  });
});

describe("signerHolding", () => {
  it("finds the browser key when it matches the name's key", async () => {
    const pub = createBrowserKey();
    const s = await signerHolding(pub);
    expect(s?.kind).toBe("browser");
  });

  it("returns nothing when no signer holds that key", async () => {
    createBrowserKey();
    expect(await signerHolding("a".repeat(64))).toBeNull();
  });

  it("returns nothing when there is no browser key and no extension", async () => {
    expect(await signerHolding("a".repeat(64))).toBeNull();
  });
});
