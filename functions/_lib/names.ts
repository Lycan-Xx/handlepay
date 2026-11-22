/**
 * The free HandlePay-hosted name registry, as plain functions.
 *
 * What this server does: it plays "the domain" for names like
 * alice@handlepay.lycanforge.com.ng. It serves a standard NIP-05 file that
 * says which Nostr key each name belongs to, and lets a key holder claim or
 * give up a name by signing the request (NIP-98, see src/lib/httpauth.ts).
 *
 * What it does NOT do: decide who gets paid. A name still only shows Verified
 * when the owner's wallet has also made a BCH proof transaction naming the
 * same key, which no server (including this one) can fake. If this server
 * listed the wrong key for a name, that name would come out Claimed, not
 * Verified, for any address it didn't control the coins of.
 *
 * Storage is one Cloudflare KV namespace bound as NAMES. With no binding every
 * write answers 503 and the NIP-05 file is empty, so the rest of the site is
 * unaffected.
 */
import { verifyHttpAuth } from "../../src/lib/httpauth";
import { checkLocalName } from "../../src/lib/hostedRules";

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  NAMES?: KV;
}

export const MAX_NAMES_PER_KEY = 3;
export const CLAIMS_PER_IP_PER_HOUR = 10;
const MAX_BODY_BYTES = 1024;
/** A request's signature is accepted once; remember ids a little longer than the signing window. */
const SEEN_TTL_SEC = 180;
const HEX64 = /^[0-9a-f]{64}$/;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

interface NameRecord {
  pubkey: string;
  at: number;
}

const nameKey = (name: string) => `name:${name}`;
const ownerKey = (pubkey: string) => `owner:${pubkey}`;

async function readRecord(kv: KV, name: string): Promise<NameRecord | null> {
  const raw = await kv.get(nameKey(name));
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as NameRecord;
    return typeof r?.pubkey === "string" && HEX64.test(r.pubkey) ? r : null;
  } catch {
    return null;
  }
}

async function readOwned(kv: KV, pubkey: string): Promise<string[]> {
  const raw = await kv.get(ownerKey(pubkey));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /.well-known/nostr.json?name=alice  (NIP-05)
// ---------------------------------------------------------------------------

export async function handleNostrJson(request: Request, env: Env): Promise<Response> {
  const wanted = new URL(request.url).searchParams.get("name") ?? "";
  const checked = checkLocalName(wanted);
  // Anything that couldn't have been registered (badly formed, or reserved like sani) is simply not listed.
  if (!env.NAMES || !checked.ok) return json(200, { names: {} });
  const record = await readRecord(env.NAMES, checked.name);
  return json(200, { names: record ? { [checked.name]: record.pubkey } : {} });
}

// ---------------------------------------------------------------------------
// GET /api/names?name=alice[&pubkey=…]  (is it free?)
// ---------------------------------------------------------------------------

export async function handleAvailability(request: Request, env: Env): Promise<Response> {
  if (!env.NAMES) return json(503, { error: "not_configured", message: "Free names aren't switched on yet." });
  const params = new URL(request.url).searchParams;
  const checked = checkLocalName(params.get("name") ?? "");
  if (!checked.ok) return json(200, { available: false, problem: checked.problem, message: checked.message });
  const record = await readRecord(env.NAMES, checked.name);
  if (!record) return json(200, { name: checked.name, available: true });
  const asking = params.get("pubkey")?.toLowerCase();
  if (asking && asking === record.pubkey) return json(200, { name: checked.name, available: false, yours: true });
  return json(200, { name: checked.name, available: false, problem: "taken", message: "Someone already has that name." });
}

// ---------------------------------------------------------------------------
// POST /api/names  { action: "claim" | "release", name }
// ---------------------------------------------------------------------------

export async function handleNamesPost(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  const kv = env.NAMES;
  if (!kv) return json(503, { error: "not_configured", message: "Free names aren't switched on yet." });

  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json(413, { error: "too_large", message: "That request is too large." });

  const auth = await verifyHttpAuth(request.headers.get("Authorization"), {
    url: request.url,
    method: request.method,
    body,
    now: Math.floor(now / 1000),
  });
  if (!auth.ok) return json(401, { error: "unauthorized", message: auth.reason });

  let parsed: { action?: unknown; name?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { error: "bad_request", message: "The request wasn't valid JSON." });
  }
  if (typeof parsed !== "object" || parsed === null || (parsed.action !== "claim" && parsed.action !== "release")) {
    return json(400, { error: "bad_request", message: "Unknown action." });
  }
  const checked = checkLocalName(typeof parsed.name === "string" ? parsed.name : "");
  if (!checked.ok) return json(400, { error: checked.problem, message: checked.message });
  const name = checked.name;

  // Each signed request works once: a captured copy can't be replayed inside the signing window.
  if (await kv.get(`seen:${auth.eventId}`)) return json(409, { error: "replay", message: "That request was already used." });

  // A best-effort cap on how fast one network address can make requests that write.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const bucket = `rl:${ip}:${Math.floor(now / 3_600_000)}`;
  const used = Number((await kv.get(bucket)) ?? "0");
  if (used >= CLAIMS_PER_IP_PER_HOUR) return json(429, { error: "rate_limited", message: "Too many requests from here. Try again in an hour." });
  await kv.put(bucket, String(used + 1), { expirationTtl: 3700 });
  await kv.put(`seen:${auth.eventId}`, "1", { expirationTtl: SEEN_TTL_SEC });

  const existing = await readRecord(kv, name);

  if (parsed.action === "release") {
    if (!existing) return json(404, { error: "not_found", message: "That name isn't registered." });
    if (existing.pubkey !== auth.pubkey) return json(403, { error: "not_yours", message: "That name belongs to a different key." });
    await kv.delete(nameKey(name));
    const owned = (await readOwned(kv, auth.pubkey)).filter((n) => n !== name);
    if (owned.length) await kv.put(ownerKey(auth.pubkey), JSON.stringify(owned));
    else await kv.delete(ownerKey(auth.pubkey));
    return json(200, { ok: true, released: name });
  }

  // claim
  if (existing) {
    if (existing.pubkey === auth.pubkey) return json(200, { ok: true, name, pubkey: auth.pubkey, already: true });
    return json(409, { error: "taken", message: "Someone already has that name." });
  }
  const owned = await readOwned(kv, auth.pubkey);
  if (owned.length >= MAX_NAMES_PER_KEY) {
    return json(429, { error: "too_many", message: `One key can hold up to ${MAX_NAMES_PER_KEY} free names. Give one up first.` });
  }
  await kv.put(nameKey(name), JSON.stringify({ pubkey: auth.pubkey, at: now } satisfies NameRecord));
  // KV isn't transactional: if two keys claimed at once, only the one the store kept wins.
  const stored = await readRecord(kv, name);
  if (!stored || stored.pubkey !== auth.pubkey) return json(409, { error: "taken", message: "Someone already has that name." });
  await kv.put(ownerKey(auth.pubkey), JSON.stringify([...owned, name]));
  return json(201, { ok: true, name, pubkey: auth.pubkey });
}
