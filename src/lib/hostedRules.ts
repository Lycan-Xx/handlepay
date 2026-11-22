/**
 * Rules for a free HandlePay-hosted name (`alice@<hosted domain>`).
 *
 * One copy, used by the browser (to tell people early) and by the Pages
 * Function (to enforce). Keep it free of imports so both can load it.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 24;

/** Names no one may claim: ours, the wallets', the demo's, and ones that would look official. */
export const RESERVED_NAMES: readonly string[] = [
  "sani", "lycan", "mallory", "alice", "bob",
  "admin", "administrator", "root", "support", "help", "info", "security", "abuse", "contact",
  "handlepay", "handle", "pay", "payments", "official", "team", "staff", "mod", "moderator",
  "paytaca", "cashonize", "selene", "wallet", "bch", "bitcoin", "bitcoincash", "satoshi", "nakamoto",
  "nostr", "relay", "api", "www", "mail", "ftp", "dev", "test", "demo", "null", "undefined",
];

export type NameProblem = "too_short" | "too_long" | "bad_chars" | "reserved";

export type NameCheck = { ok: true; name: string } | { ok: false; problem: NameProblem; message: string };

/** Lowercase letters, digits, "-" and "_"; starts and ends with a letter or digit. */
const SHAPE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function checkLocalName(raw: string): NameCheck {
  const name = raw.trim().toLowerCase();
  if (name.length < NAME_MIN) return { ok: false, problem: "too_short", message: `Use at least ${NAME_MIN} characters.` };
  if (name.length > NAME_MAX) return { ok: false, problem: "too_long", message: `Use at most ${NAME_MAX} characters.` };
  if (!SHAPE.test(name) || name.includes("--")) {
    return {
      ok: false,
      problem: "bad_chars",
      message: "Use only lowercase letters, numbers, - and _, starting and ending with a letter or number.",
    };
  }
  if (RESERVED_NAMES.includes(name)) return { ok: false, problem: "reserved", message: "That name is reserved. Pick another." };
  return { ok: true, name };
}
