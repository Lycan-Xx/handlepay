/**
 * F4: challenge–response sign-in against a handle's Nostr key. No server:
 * the verifier makes the challenge, the user signs a kind-22242 event with
 * NIP-07, and the verifier checks it. A real site must create and remember
 * the challenge itself; this page does both ends to demonstrate the flow.
 */
import { binToHex } from "@bitauth/libauth";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { verifySignature } from "./nostr";

export const AUTH_KIND = 22242;
export const AUTH_MAX_AGE_SEC = 5 * 60;

export function createChallenge(): string {
  return binToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function buildAuthTemplate(challenge: string, origin: string, createdAt?: number): EventTemplate {
  return {
    kind: AUTH_KIND,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    tags: [
      ["challenge", challenge],
      ["relay", origin],
    ],
    content: "",
  };
}

export type AuthResult = { ok: true; pubkey: string } | { ok: false; reason: string };

export function verifyAuthEvent(
  event: NostrEvent,
  expected: { challenge: string; origin: string; pubkey: string; now?: number },
): AuthResult {
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
  if (event.kind !== AUTH_KIND) return { ok: false, reason: "Not a sign-in event" };
  if (!verifySignature(event)) return { ok: false, reason: "Signature is invalid" };
  if (tag("challenge") !== expected.challenge) return { ok: false, reason: "Signed a different challenge" };
  if (tag("relay") !== expected.origin) return { ok: false, reason: "Signed for a different site" };
  if (Math.abs(now - event.created_at) > AUTH_MAX_AGE_SEC) return { ok: false, reason: "Sign-in expired; try again" };
  if (event.pubkey !== expected.pubkey) return { ok: false, reason: "Signed with a key this name doesn't use" };
  return { ok: true, pubkey: event.pubkey };
}
