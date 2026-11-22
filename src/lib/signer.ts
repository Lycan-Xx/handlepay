/**
 * Who signs for a name: a Nostr browser extension, or a key kept in this
 * browser.
 *
 * Most people don't have a Nostr extension, and needing one was a barrier to
 * getting paid by name. So HandlePay can make a key for you and keep it in this
 * browser's storage. The trade-offs are real and the UI says them: the key
 * lives only on this device (back it up), and anyone who can read this
 * browser's storage could use it. It never controls any money. It only signs
 * the name's claims and the sign-in challenge, and the BCH proof still has to
 * come from your wallet.
 */
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { decode, nsecEncode } from "nostr-tools/nip19";
import { hasSigner, signWithExtension, signerPubkey, verifySignature } from "./nostr";

export type SignerKind = "extension" | "browser";

export interface Signer {
  kind: SignerKind;
  pubkey(): Promise<string>;
  /** Sign `template`; if `expectedPubkey` is given, refuse a signature by any other key. */
  sign(template: EventTemplate, expectedPubkey?: string): Promise<NostrEvent>;
}

const STORAGE_KEY = "handlepay-browser-key";
const HEX64 = /^[0-9a-f]{64}$/;

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

function readSecret(): Uint8Array | null {
  try {
    const hex = localStorage.getItem(STORAGE_KEY);
    return hex && HEX64.test(hex) ? fromHex(hex) : null;
  } catch {
    return null;
  }
}

function writeSecret(secret: Uint8Array): void {
  try {
    localStorage.setItem(STORAGE_KEY, toHex(secret));
  } catch {
    throw new Error("This browser won't let the site save a key (private window, or storage turned off). Use a normal window, or a Nostr extension.");
  }
  // Check it stuck: some browsers accept the write and then drop it.
  if (!readSecret()) throw new Error("This browser didn't keep the key. Use a normal window, or a Nostr extension.");
}

export function hasBrowserKey(): boolean {
  return readSecret() !== null;
}

/** The public key of the key kept in this browser, if there is one. */
export function browserKeyPubkey(): string | null {
  const secret = readSecret();
  return secret ? getPublicKey(secret) : null;
}

/** Make and keep a new key. Refuses to replace one that exists, so a name's key can't be lost by a stray click. */
export function createBrowserKey(): string {
  if (hasBrowserKey()) throw new Error("This browser already has a key.");
  const secret = generateSecretKey();
  writeSecret(secret);
  return getPublicKey(secret);
}

/** Keep a key from a backup: an `nsec1…` string or 64 hex characters. */
export function importBrowserKey(input: string): string {
  const text = input.trim();
  let secret: Uint8Array;
  if (HEX64.test(text.toLowerCase())) {
    secret = fromHex(text.toLowerCase());
  } else {
    try {
      const decoded = decode(text);
      if (decoded.type !== "nsec") throw new Error("not an nsec");
      secret = decoded.data;
    } catch {
      throw new Error("That doesn't look like a secret key. It should start with nsec1 or be 64 letters and numbers.");
    }
  }
  writeSecret(secret);
  return getPublicKey(secret);
}

/** The key as `nsec1…`, for the person to back up. */
export function exportBrowserKey(): string | null {
  const secret = readSecret();
  return secret ? nsecEncode(secret) : null;
}

function browserSigner(): Signer {
  return {
    kind: "browser",
    async pubkey() {
      const secret = readSecret();
      if (!secret) throw new Error("This browser has no saved key. Restore it from your backup, or start again.");
      return getPublicKey(secret);
    },
    async sign(template, expectedPubkey) {
      const secret = readSecret();
      if (!secret) throw new Error("This browser has no saved key. Restore it from your backup, or start again.");
      const event = finalizeEvent(template, secret);
      if (!verifySignature(event)) throw new Error("Couldn't sign with the saved key.");
      if (expectedPubkey && event.pubkey !== expectedPubkey) {
        throw new Error("The key saved in this browser isn't the one this name uses.");
      }
      return event;
    },
  };
}

const extensionSigner: Signer = {
  kind: "extension",
  pubkey: () => signerPubkey(),
  sign: (template, expectedPubkey) => signWithExtension(template, expectedPubkey),
};

export function signerFor(kind: SignerKind): Signer {
  return kind === "browser" ? browserSigner() : extensionSigner;
}

/**
 * The signer that holds `pubkey`: the browser key if it matches, else the
 * extension if it matches. Null if neither does (or neither exists).
 */
export async function signerHolding(pubkey: string): Promise<Signer | null> {
  if (browserKeyPubkey() === pubkey) return browserSigner();
  if (hasSigner()) {
    try {
      if ((await signerPubkey()) === pubkey) return extensionSigner;
    } catch {
      /* the extension declined to share its key */
    }
  }
  return null;
}
