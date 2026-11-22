/**
 * Nostr I/O: NIP-05 lookups, relay queries and publishing, NIP-07 signing.
 * Every event that comes back from a relay or a signer is signature-checked
 * here before anything else sees it.
 */
import type { WindowNostr } from "nostr-tools/nip07";
import { SimplePool } from "nostr-tools/pool";
import { verifyEvent, type EventTemplate, type NostrEvent } from "nostr-tools/pure";
import { BINDING_D, BINDING_KIND, PAYTACA_D, PAYTACA_KIND, PAYTO_KIND } from "./binding";

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

/** Always queried and published to, alongside any relays the NIP-05 file lists. */
export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Handles and NIP-05
// ---------------------------------------------------------------------------

export interface Handle {
  local: string;
  domain: string;
  /** Canonical lowercase `local@domain`. */
  full: string;
  /** Non-ASCII characters can hide look-alike names; the UI flags these. */
  nonAscii: boolean;
}

/** Parse `local@domain`. Returns null if it can't be a NIP-05 name. */
export function parseHandle(input: string): Handle | null {
  const trimmed = input.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  // NIP-05 local parts are a-z0-9-_. ; we also allow non-ASCII so we can flag it.
  if (!/^[\p{L}\p{N}._-]+$/u.test(local)) return null;
  if (!/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(domain)) return null;
  const nonAscii = /[^\x20-\x7e]/.test(trimmed);
  return { local, domain, full: `${local}@${domain}`, nonAscii };
}

export interface Nip05Result {
  pubkey: string;
  relays: string[];
}

export class Nip05UnreachableError extends Error {
  constructor(domain: string) {
    super(`Couldn't reach ${domain} to look up this name.`);
    this.name = "Nip05UnreachableError";
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Parse a nostr.json body for one name. */
export function readNip05Json(json: unknown, local: string): Nip05Result | null {
  if (typeof json !== "object" || json === null) return null;
  const j = json as { names?: Record<string, unknown>; relays?: Record<string, unknown> };
  const pubkey = j.names?.[local];
  if (typeof pubkey !== "string" || !HEX64.test(pubkey)) return null;
  const listed = j.relays?.[pubkey];
  const relays = Array.isArray(listed) ? listed.filter((r): r is string => typeof r === "string" && r.startsWith("wss://")) : [];
  return { pubkey, relays };
}

/**
 * Look up `local@domain` via `https://domain/.well-known/nostr.json?name=local`.
 * Tries the domain directly; if that fails at the network level (usually CORS),
 * retries through the HandlePay Worker when `proxy` is set.
 *
 * Returns null when the domain answers but doesn't list the name; throws
 * Nip05UnreachableError when it can't be reached at all.
 */
export async function fetchNip05(
  handle: Handle,
  opts: { fetchImpl?: FetchLike; proxy?: string; timeoutMs?: number } = {},
): Promise<Nip05Result | null> {
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const proxy = opts.proxy ?? import.meta.env?.VITE_NIP05_PROXY;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const direct = `https://${handle.domain}/.well-known/nostr.json?name=${encodeURIComponent(handle.local)}`;
  const urls = [direct];
  if (proxy) urls.push(`${proxy.replace(/\/$/, "")}/nip05?name=${encodeURIComponent(handle.full)}`);

  for (const url of urls) {
    let response: Response;
    try {
      // NIP-05 forbids following redirects.
      response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      continue; // network / CORS failure: try the next route
    }
    if (response.status === 404) return null;
    if (!response.ok) continue;
    try {
      return readNip05Json(await response.json(), handle.local);
    } catch {
      return null;
    }
  }
  throw new Nip05UnreachableError(handle.domain);
}

// ---------------------------------------------------------------------------
// Relays
// ---------------------------------------------------------------------------

let pool: SimplePool | null = null;
function getPool() {
  pool ??= new SimplePool();
  return pool;
}

export function relaysFor(extra: string[] = []): string[] {
  return [...new Set([...extra, ...DEFAULT_RELAYS].map((r) => r.replace(/\/$/, "")))];
}

/** No relay could be reached, so an empty answer would mean "couldn't check", not "nothing published". */
export class RelaysUnreachableError extends Error {
  constructor() {
    super("Couldn't reach any Nostr relay to read this name's records. Check your connection and try again.");
    this.name = "RelaysUnreachableError";
  }
}

/**
 * The relays that accept a connection. querySync answers [] both when relays have nothing and when
 * none can be reached; connecting first tells the two apart, so a dead connection reads as
 * "couldn't check", never as "no identity". Throws RelaysUnreachableError when none connect.
 */
export async function reachableRelays(
  p: { ensureRelay(url: string, params?: { connectionTimeout?: number }): Promise<unknown> },
  relays: string[],
  timeout: number,
): Promise<string[]> {
  const connected = await Promise.allSettled(relays.map((url) => p.ensureRelay(url, { connectionTimeout: timeout })));
  const ok = relays.filter((_, i) => connected[i].status === "fulfilled");
  if (!ok.length) throw new RelaysUnreachableError();
  return ok;
}

/**
 * Fetch a pubkey's identity events (binding, payto, Paytaca) from relays.
 * Drops anything with a bad signature or a different author.
 *
 * Throws RelaysUnreachableError when not one relay can be connected to.
 */
export async function queryIdentityEvents(pubkey: string, relays: string[], maxWait = 4_000): Promise<NostrEvent[]> {
  const p = getPool();
  relays = await reachableRelays(p, relays, maxWait);
  const results = await Promise.all([
    p.querySync(relays, { authors: [pubkey], kinds: [BINDING_KIND], "#d": [BINDING_D] }, { maxWait }),
    p.querySync(relays, { authors: [pubkey], kinds: [PAYTO_KIND] }, { maxWait }),
    p.querySync(relays, { authors: [pubkey], kinds: [PAYTACA_KIND], "#d": [PAYTACA_D] }, { maxWait }),
  ]);
  return dedupeVerified(results.flat(), pubkey);
}

/**
 * Check an event's id and signature from its fields alone.
 *
 * nostr-tools caches a successful check in a symbol property on the event
 * object, and object spread copies that symbol. So `{...signed, sig: other}`
 * would pass `verifyEvent` without being checked. Verifying a fresh copy of
 * the NIP-01 fields defeats the cache.
 */
export function verifySignature(e: NostrEvent): boolean {
  const { id, pubkey, created_at, kind, tags, content, sig } = e;
  try {
    return verifyEvent({ id, pubkey, created_at, kind, tags, content, sig });
  } catch {
    return false;
  }
}

/** Unique events by id, signature-checked, from `author` only. */
export function dedupeVerified(events: NostrEvent[], author: string): NostrEvent[] {
  const seen = new Map<string, NostrEvent>();
  for (const e of events) {
    if (seen.has(e.id) || e.pubkey !== author) continue;
    if (!verifySignature(e)) continue;
    seen.set(e.id, e);
  }
  return [...seen.values()];
}

/** Newest event, ties broken by lowest id (NIP-01 replaceable-event rule). */
export function newest(events: NostrEvent[]): NostrEvent | undefined {
  return [...events].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0];
}

export interface PublishResult {
  ok: string[];
  failed: { relay: string; reason: string }[];
}

export async function publishEvent(event: NostrEvent, relays: string[]): Promise<PublishResult> {
  const attempts = getPool().publish(relays, event);
  const settled = await Promise.allSettled(attempts);
  const result: PublishResult = { ok: [], failed: [] };
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") result.ok.push(relays[i]);
    else result.failed.push({ relay: relays[i], reason: String((s.reason as Error)?.message ?? s.reason) });
  });
  return result;
}

// ---------------------------------------------------------------------------
// NIP-07 signer (Alby, nos2x, …)
// ---------------------------------------------------------------------------

export function hasSigner(): boolean {
  return typeof window !== "undefined" && !!window.nostr;
}

export async function signerPubkey(): Promise<string> {
  if (!window.nostr) throw new Error("No Nostr signer found. Install Alby or nos2x, then reload.");
  const pubkey = await window.nostr.getPublicKey();
  if (!HEX64.test(pubkey)) throw new Error("The Nostr signer returned an invalid key.");
  return pubkey;
}

/** Sign with the browser extension and check the result before trusting it. */
export async function signWithExtension(template: EventTemplate, expectedPubkey?: string): Promise<NostrEvent> {
  if (!window.nostr) throw new Error("No Nostr signer found. Install Alby or nos2x, then reload.");
  const event = await window.nostr.signEvent(template);
  if (!verifySignature(event)) throw new Error("The Nostr signer returned a bad signature.");
  if (expectedPubkey && event.pubkey !== expectedPubkey) {
    throw new Error("The Nostr signer used a different key than the one you connected.");
  }
  return event;
}
