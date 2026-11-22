/**
 * NIP-98 HTTP auth: prove "this request comes from the holder of this Nostr
 * key" without a password or account.
 *
 * The client signs a kind-27235 event that names the exact URL, the method and
 * a hash of the body, and sends it in `Authorization: Nostr <base64 event>`.
 * Because the signature covers the URL and body, a captured header can't be
 * used on another endpoint or with a different request, and the server also
 * refuses anything older than a minute or seen before.
 *
 * Shared by the browser (to sign) and the Pages Function (to check), so it
 * imports nothing but nostr-tools' signature check.
 */
import { verifyEvent, type EventTemplate, type NostrEvent } from "nostr-tools/pure";

export const HTTP_AUTH_KIND = 27235;
/** How far a request's timestamp may be from the server's clock, in seconds. */
export const HTTP_AUTH_WINDOW_SEC = 60;
const MAX_HEADER_BYTES = 4096;
const HEX64 = /^[0-9a-f]{64}$/;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The event a client signs for one request. `now` is in seconds. */
export async function buildHttpAuthTemplate(req: {
  url: string;
  method: string;
  body: string;
  now?: number;
}): Promise<EventTemplate> {
  return {
    kind: HTTP_AUTH_KIND,
    created_at: req.now ?? Math.floor(Date.now() / 1000),
    tags: [
      ["u", req.url],
      ["method", req.method.toUpperCase()],
      ["payload", await sha256Hex(req.body)],
    ],
    content: "",
  };
}

export function encodeAuthHeader(event: NostrEvent): string {
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Nostr ${btoa(binary)}`;
}

export type HttpAuthResult =
  | { ok: true; pubkey: string; eventId: string }
  | { ok: false; reason: string };

/**
 * Check an Authorization header against the request actually received.
 * `url` is the full request URL, `now` is in seconds.
 */
export async function verifyHttpAuth(
  header: string | null,
  req: { url: string; method: string; body: string; now?: number },
): Promise<HttpAuthResult> {
  if (!header || !header.startsWith("Nostr ")) return { ok: false, reason: "Missing Nostr authorization." };
  const encoded = header.slice("Nostr ".length).trim();
  if (encoded.length > MAX_HEADER_BYTES) return { ok: false, reason: "Authorization is too large." };

  let event: NostrEvent;
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    event = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: "Authorization isn't valid." };
  }

  if (
    typeof event !== "object" || event === null ||
    typeof event.id !== "string" || typeof event.sig !== "string" || typeof event.content !== "string" ||
    typeof event.created_at !== "number" || typeof event.kind !== "number" ||
    typeof event.pubkey !== "string" || !HEX64.test(event.pubkey) ||
    !Array.isArray(event.tags) || !event.tags.every((t) => Array.isArray(t) && t.every((s) => typeof s === "string"))
  ) {
    return { ok: false, reason: "Authorization isn't a Nostr event." };
  }
  if (event.kind !== HTTP_AUTH_KIND) return { ok: false, reason: "Authorization has the wrong kind." };

  // Check the signature from the bare fields: nostr-tools caches a pass on the object itself.
  const { id, pubkey, created_at, kind, tags, content, sig } = event;
  let valid = false;
  try {
    valid = verifyEvent({ id, pubkey, created_at, kind, tags, content, sig });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "The signature doesn't check out." };

  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
  const signedUrl = tag("u");
  if (!signedUrl) return { ok: false, reason: "Authorization doesn't name a URL." };
  let sameEndpoint = false;
  try {
    const a = new URL(signedUrl);
    const b = new URL(req.url);
    sameEndpoint = a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    sameEndpoint = false;
  }
  if (!sameEndpoint) return { ok: false, reason: "Authorization was signed for a different address." };
  if (tag("method")?.toUpperCase() !== req.method.toUpperCase()) {
    return { ok: false, reason: "Authorization was signed for a different method." };
  }
  if (tag("payload") !== (await sha256Hex(req.body))) {
    return { ok: false, reason: "Authorization doesn't match the request body." };
  }
  const now = req.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.created_at) > HTTP_AUTH_WINDOW_SEC) {
    return { ok: false, reason: "Authorization is too old or from the future. Check your device's clock." };
  }
  return { ok: true, pubkey: event.pubkey, eventId: event.id };
}
