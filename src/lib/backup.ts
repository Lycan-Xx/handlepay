/**
 * Backup files for a key kept in this browser.
 *
 * Both files are made here, in the browser, from a Blob: no network request,
 * so they work offline and nothing reaches a server. Two kinds:
 *   handlepay-key-<name>.txt            the key as nsec (plain; guard it)
 *   handlepay-key-<name>.ncryptsec.txt  the key encrypted with a password (NIP-49)
 *
 * Restore accepts either file, picked or pasted, as well as a bare key:
 * extractKey finds the key line in whatever text it is given.
 */

export interface BackupFile {
  /** The full name, like yourname@handlepay.lycanforge.com.ng. */
  name: string;
  npub: string;
  /** `nsec1…`, or `ncryptsec1…` when `encrypted`. */
  key: string;
  encrypted: boolean;
  created: Date;
}

/** handlepay-key-<name>.txt, or .ncryptsec.txt for the encrypted one. Characters a file system may refuse become "-". */
export function backupFileName(name: string, encrypted: boolean): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9@._-]+/g, "-").replace(/^-+|-+$/g, "") || "name";
  return `handlepay-key-${safe}${encrypted ? ".ncryptsec" : ""}.txt`;
}

export function backupFileText(b: BackupFile): string {
  return [
    "HandlePay identity key backup",
    "This file controls your HandlePay name. Never share it.",
    "",
    `Name: ${b.name}`,
    `Public key (npub): ${b.npub}`,
    `Created: ${b.created.toISOString()}`,
    b.encrypted ? `Key (ncryptsec, NIP-49, needs your password): ${b.key}` : `Key (nsec): ${b.key}`,
    "",
    "How to restore: HandlePay → Get paid → I have a backed-up key",
    b.encrypted
      ? "Open this file there (or paste the key line), then enter the password you chose."
      : "Open this file there, or paste the key line.",
    "",
    "Your money is not in this file. It stays in your BCH wallet either way.",
    "",
  ].join("\n");
}

/**
 * The secret key inside `text`: an ncryptsec1… or nsec1… string, or a line
 * that is exactly 64 hex characters. Null if there isn't one. The public key
 * (npub1…) in a backup file is never mistaken for it.
 */
export function extractKey(text: string): string | null {
  const encrypted = /\bncryptsec1[02-9ac-hj-np-z]+/i.exec(text);
  if (encrypted) return encrypted[0];
  const nsec = /\bnsec1[02-9ac-hj-np-z]+/i.exec(text);
  if (nsec) return nsec[0];
  const hex = /^\s*([0-9a-fA-F]{64})\s*$/m.exec(text);
  return hex ? hex[1] : null;
}

/** Save `text` as a file through the browser's own download, without any request. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
