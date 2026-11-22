/**
 * @handlepay/resolve: check a name like `sani@lycanforge.com.ng` and get back
 * the Bitcoin Cash address it has proven it controls, or the reason it hasn't.
 *
 * This is the same code the HandlePay app runs (src/lib), re-exported, so the
 * app and the package can't drift apart. See docs/SPEC.md for the protocol.
 */
import type { BchNetwork } from "../../../src/lib/network";
import { liveDeps, resolveHandle, type Pin, type Resolution, type ResolveDeps } from "../../../src/lib/resolve";

export interface ResolveOptions {
  /** Which chain the address must be on. Default: mainnet. */
  network?: BchNetwork;
  /**
   * What you saw for this name last time. If the name now resolves to a
   * different key or address, the status is "changed" instead of "verified".
   */
  pinned?: Pin | null;
  /** Replace the network lookups, for tests or your own servers. */
  deps?: ResolveDeps;
}

/**
 * Resolve a name to a verified address.
 *
 * Looks the name up with NIP-05, reads its signed binding from Nostr relays,
 * and checks the BCH proof transaction from raw bytes. Pay `address` only
 * when `status` is "verified" (or after your user has confirmed a "claimed"
 * or "changed" result, as the app does).
 *
 * Rejects, rather than returning "not_found", when it can't check: no Nostr
 * relay could be reached (RelaysUnreachableError) or the BCH server didn't
 * answer. A name you couldn't check isn't a name that doesn't exist.
 */
export async function resolve(name: string, options: ResolveOptions = {}): Promise<Resolution> {
  const network = options.network ?? "mainnet";
  return resolveHandle(name, network, options.deps ?? liveDeps(network), options.pinned);
}

export { resolveHandle, liveDeps, paymentGate } from "../../../src/lib/resolve";
export type { Pin, Resolution, ResolveDeps, Status } from "../../../src/lib/resolve";

export {
  BINDING_KIND,
  BINDING_D,
  PAYTO_KIND,
  PROOF_MAGIC,
  PROOF_VERSION,
  buildBindingEvent,
  buildPaytoEvent,
  buildRevokeEvent,
  checkProof,
  normalizeAddress,
  parseBindingEvent,
  parseProofOutput,
  proofOpReturnChunks,
} from "../../../src/lib/binding";
export type { Check, ParsedBinding, ProofInput } from "../../../src/lib/binding";

export { DEFAULT_RELAYS, RelaysUnreachableError, fetchNip05, parseHandle, queryIdentityEvents } from "../../../src/lib/nostr";
export type { Handle, Nip05Result } from "../../../src/lib/nostr";

export { AUTH_KIND, AUTH_MAX_AGE_SEC, buildAuthTemplate, createChallenge, verifyAuthEvent } from "../../../src/lib/auth";
export type { AuthResult } from "../../../src/lib/auth";

export type { BchNetwork } from "../../../src/lib/network";
