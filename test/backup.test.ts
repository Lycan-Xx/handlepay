import { beforeEach, describe, expect, it } from "vitest";
import { backupFileName, backupFileText, extractKey } from "../src/lib/backup";
import {
  BACKUP_PASSWORD_MIN,
  browserKeyNpub,
  browserKeyPubkey,
  createBrowserKey,
  exportBrowserKey,
  exportBrowserKeyEncrypted,
  importBrowserKey,
  isEncryptedKey,
} from "../src/lib/signer";

function installStorage() {
  const data = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

// Low scrypt cost so the tests stay fast; the app uses the NIP-49 default.
const LOGN = 4;

beforeEach(() => installStorage());

describe("backup files", () => {
  it("names the files after the full name, and marks the encrypted one", () => {
    expect(backupFileName("sani@handlepay.lycanforge.com.ng", false)).toBe("handlepay-key-sani@handlepay.lycanforge.com.ng.txt");
    expect(backupFileName("sani@handlepay.lycanforge.com.ng", true)).toBe(
      "handlepay-key-sani@handlepay.lycanforge.com.ng.ncryptsec.txt",
    );
    expect(backupFileName("a b/c", false)).toBe("handlepay-key-a-b-c.txt");
  });

  it("holds the warning, name, npub, date, key and how to restore", () => {
    createBrowserKey();
    const text = backupFileText({
      name: "sani@handlepay.lycanforge.com.ng",
      npub: browserKeyNpub()!,
      key: exportBrowserKey()!,
      encrypted: false,
      created: new Date("2026-11-22T10:00:00Z"),
    });
    expect(text).toContain("This file controls your HandlePay name. Never share it.");
    expect(text).toContain("Name: sani@handlepay.lycanforge.com.ng");
    expect(text).toContain(`Public key (npub): ${browserKeyNpub()}`);
    expect(text).toContain("Created: 2026-11-22T10:00:00.000Z");
    expect(text).toContain(`Key (nsec): ${exportBrowserKey()}`);
    expect(text).toContain("HandlePay → Get paid → I have a backed-up key");
  });

  it("finds the secret key in a backup file, never the npub", () => {
    createBrowserKey();
    const nsec = exportBrowserKey()!;
    const file = backupFileText({ name: "x@y.z", npub: browserKeyNpub()!, key: nsec, encrypted: false, created: new Date() });
    expect(extractKey(file)).toBe(nsec);
    expect(extractKey(`  ${nsec}  `)).toBe(nsec);
    expect(extractKey(`npub only: ${browserKeyNpub()}`)).toBeNull();
    expect(extractKey("a".repeat(64))).toBe("a".repeat(64));
    expect(extractKey("nothing here")).toBeNull();
  });
});

describe("encrypted backup (NIP-49)", () => {
  it("round-trips through a file and a password back to the same key", () => {
    const pub = createBrowserKey();
    const ncryptsec = exportBrowserKeyEncrypted("correct horse", LOGN)!;
    expect(ncryptsec.startsWith("ncryptsec1")).toBe(true);
    expect(isEncryptedKey(ncryptsec)).toBe(true);
    const file = backupFileText({ name: "x@y.z", npub: browserKeyNpub()!, key: ncryptsec, encrypted: true, created: new Date() });
    expect(file).not.toContain("nsec1");

    installStorage(); // a new device
    const key = extractKey(file)!;
    expect(key).toBe(ncryptsec);
    expect(importBrowserKey(key, { password: "correct horse" })).toBe(pub);
    expect(browserKeyPubkey()).toBe(pub);
  });

  it("asks for the password, and refuses a wrong one without saving anything", () => {
    createBrowserKey();
    const ncryptsec = exportBrowserKeyEncrypted("correct horse", LOGN)!;
    installStorage();
    expect(() => importBrowserKey(ncryptsec)).toThrow(/encrypted/);
    expect(() => importBrowserKey(ncryptsec, { password: "wrong password" })).toThrow(/password/);
    expect(browserKeyPubkey()).toBeNull();
  });

  it(`needs a password of at least ${BACKUP_PASSWORD_MIN} characters`, () => {
    createBrowserKey();
    expect(() => exportBrowserKeyEncrypted("short", LOGN)).toThrow(/at least/);
  });
});
