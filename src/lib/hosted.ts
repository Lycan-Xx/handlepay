/**
 * The browser's side of free HandlePay names: ask whether a name is free, claim
 * it, give it up. Every write is signed by the key that will own the name
 * (NIP-98, see httpauth.ts); the server is in functions/_lib/names.ts.
 */
import { buildHttpAuthTemplate, encodeAuthHeader } from "./httpauth";
import { checkLocalName } from "./hostedRules";
import type { Signer } from "./signer";

/** The domain free names live on: names look like alice@<this>. */
export const HOSTED_DOMAIN: string = import.meta.env?.VITE_HOSTED_DOMAIN || "handlepay.lycanforge.com.ng";

/** Base address of the names API. Empty means this site; set it to test the screens against another deployment. */
const API_BASE: string = (import.meta.env?.VITE_NAMES_API || "").replace(/\/$/, "");

export const isHostedHandle = (full: string) => full.toLowerCase().endsWith(`@${HOSTED_DOMAIN}`);
export const hostedHandle = (local: string) => `${local.trim().toLowerCase()}@${HOSTED_DOMAIN}`;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The server's answer, in words a person can read. */
export class HostedError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "HostedError";
    this.code = code;
  }
}

const apiUrl = () => `${API_BASE || window.location.origin}/api/names`;

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await res.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type Availability =
  | { state: "invalid"; message: string }
  | { state: "taken"; message: string }
  | { state: "yours" }
  | { state: "available"; name: string }
  | { state: "unavailable"; message: string };

/** Is `local` free? Pass your key to be told if it's already yours. */
export async function lookupName(local: string, pubkey?: string, opts: { fetchImpl?: FetchLike } = {}): Promise<Availability> {
  const checked = checkLocalName(local);
  if (!checked.ok) return { state: "invalid", message: checked.message };
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const query = new URLSearchParams({ name: checked.name });
  if (pubkey) query.set("pubkey", pubkey);
  let res: Response;
  try {
    res = await fetchImpl(`${apiUrl()}?${query}`, { signal: AbortSignal.timeout(6_000) });
  } catch {
    return { state: "unavailable", message: "Couldn't reach the name service. Check your connection." };
  }
  const body = await readJson(res);
  if (res.status === 503 || !body) {
    return { state: "unavailable", message: "Free names aren't available from here right now. You can use your own domain instead." };
  }
  if (body.yours === true) return { state: "yours" };
  if (body.available === true) return { state: "available", name: checked.name };
  if (body.problem === "taken") return { state: "taken", message: String(body.message ?? "Someone already has that name.") };
  return { state: "invalid", message: String(body.message ?? "That name can't be used.") };
}

async function signedPost(
  payload: { action: "claim" | "release"; name: string },
  signer: Signer,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const url = apiUrl();
  const body = JSON.stringify(payload);
  const template = await buildHttpAuthTemplate({ url, method: "POST", body });
  const event = await signer.sign(template);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      body,
      headers: { Authorization: encodeAuthHeader(event), "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HostedError("Couldn't reach the name service. Check your connection and try again.", "network");
  }
  const data = await readJson(res);
  if (res.ok && data) return data;
  const code = typeof data?.error === "string" ? data.error : res.status === 503 ? "not_configured" : "failed";
  const message =
    typeof data?.message === "string"
      ? data.message
      : res.status === 503
        ? "Free names aren't available from here right now."
        : "The name service didn't accept that. Try again.";
  throw new HostedError(message, code);
}

/** Claim `local` for the signer's key. Saying it again for a name you already hold is fine. */
export async function claimName(local: string, signer: Signer, opts: { fetchImpl?: FetchLike } = {}): Promise<{ name: string; already: boolean }> {
  const checked = checkLocalName(local);
  if (!checked.ok) throw new HostedError(checked.message, checked.problem);
  const data = await signedPost({ action: "claim", name: checked.name }, signer, opts.fetchImpl ?? ((u, i) => fetch(u, i)));
  return { name: checked.name, already: data.already === true };
}

/** Give up `local`, so anyone can claim it. Only its owner's key can. */
export async function releaseName(local: string, signer: Signer, opts: { fetchImpl?: FetchLike } = {}): Promise<void> {
  const checked = checkLocalName(local);
  if (!checked.ok) throw new HostedError(checked.message, checked.problem);
  await signedPost({ action: "release", name: checked.name }, signer, opts.fetchImpl ?? ((u, i) => fetch(u, i)));
}
