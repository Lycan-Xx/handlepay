/**
 * The /security demo: the two attacks HandlePay stops outright (spec F8,
 * "Security and threat model"), run for real against a live, verified name.
 *
 * Mallory is made fresh in the browser each run: a new Nostr key and a new BCH
 * address. Her signed events never leave the page; they are handed straight to
 * the same resolveHandle the pay page uses, with the chain lookups going to the
 * real network server. We also assume the worst about names: her own domain
 * lists her key, so the only thing between Mallory and the victim's payers is
 * the BCH proof.
 *
 * 1. Fake claim: Mallory signs events saying the victim's address is hers,
 *    first with no proof at all, then reusing the victim's real proof
 *    transaction. Both must come out Claimed, never Verified.
 * 2. Tampered link: a pay link for the victim with `?to=<Mallory's address>`
 *    and an edited amount. The recipient must stay the victim's verified
 *    address; the amount is only ever a pre-filled, visible suggestion.
 */
import { publicKeyToP2pkhCashAddress, secp256k1 } from "@bitauth/libauth";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { buildBindingEvent, buildPaytoEvent } from "./binding";
import { PREFIX, type BchNetwork } from "./network";
import { parsePayParams, type PayParams } from "./paylink";
import { liveDeps, resolveHandle, type Resolution, type ResolveDeps } from "./resolve";
import { payPath } from "./router";

/** The demo names, one per network (a key has one binding at a time). */
export const DEMO_HANDLES: Record<BchNetwork, string> = {
  chipnet: "lycan@lycanforge.com.ng",
  mainnet: "sani@lycanforge.com.ng",
};

export const MALLORY_HANDLE = "mallory@attacker.example";

export interface Mallory {
  pubkey: string;
  address: string;
  secretKey: Uint8Array;
}

/** A throwaway attacker: a fresh Nostr key and a BCH address on `network`. */
export function makeMallory(network: BchNetwork, secretKey: Uint8Array = generateSecretKey()): Mallory {
  const bchPublicKey = secp256k1.derivePublicKeyCompressed(secretKey);
  if (typeof bchPublicKey === "string") throw new Error(bchPublicKey);
  const { address } = publicKeyToP2pkhCashAddress({ publicKey: bchPublicKey, prefix: PREFIX[network] });
  return { pubkey: getPublicKey(secretKey), address, secretKey };
}

export interface FakeClaimResult {
  /** Mallory names the victim's address with no proof (a kind-10133 payto event). */
  noProof: Resolution;
  /** Mallory's binding reuses the victim's real proof transaction. */
  replay: Resolution;
  events: { noProof: NostrEvent; replay: NostrEvent };
}

/**
 * Resolve Mallory's name the way the pay page would, with her domain listing
 * her key and the relays returning only `events`. Chain lookups use `deps`.
 */
function resolveAsMallory(mallory: Mallory, events: NostrEvent[], network: BchNetwork, deps: ResolveDeps) {
  return resolveHandle(MALLORY_HANDLE, network, {
    fetchNip05: async () => ({ pubkey: mallory.pubkey, relays: [] }),
    queryEvents: async () => events,
    getTransaction: deps.getTransaction,
  });
}

export async function runFakeClaim(
  victim: Resolution,
  mallory: Mallory,
  network: BchNetwork,
  deps: ResolveDeps,
): Promise<FakeClaimResult> {
  if (!victim.address || !victim.proofTxid) throw new Error("The victim needs a verified address and proof first.");
  const noProof = finalizeEvent(buildPaytoEvent(victim.address), mallory.secretKey);
  const replay = finalizeEvent(
    buildBindingEvent({ address: victim.address, proofTxid: victim.proofTxid, network, nip05: MALLORY_HANDLE }),
    mallory.secretKey,
  );
  const [a, b] = await Promise.all([
    resolveAsMallory(mallory, [noProof], network, deps),
    resolveAsMallory(mallory, [replay], network, deps),
  ]);
  return { noProof: a, replay: b, events: { noProof, replay } };
}

export interface TamperedLink {
  /** The link Mallory sends round, with her address and a bigger amount. */
  href: string;
  /** What the pay page reads from it. */
  params: PayParams;
  /** Where the money would go: the victim's verified address, never `?to=`. */
  recipient?: string;
  malloryAddress: string;
}

export function tamperLink(victimHandle: string, victim: Resolution, mallory: Mallory): TamperedLink {
  const base = payPath(victimHandle, { amount: "250", memo: "Invoice 7" });
  const href = `${base}&to=${mallory.address}`;
  const params = parsePayParams(new URL(href, "https://handlepay.invalid").searchParams);
  return { href, params, recipient: victim.address, malloryAddress: mallory.address };
}

export interface AttackRun {
  victim: Resolution;
  /** Present only when the victim is Verified, so there is something real to copy. */
  fake?: FakeClaimResult;
  link?: TamperedLink;
  ms: number;
}

/**
 * The whole live demo: check the real name, then let a brand-new Mallory try
 * both tricks. Mallory's checks fetch the same proof and parent transactions
 * as the real name's, so those are fetched once and shared.
 */
export async function runAttackDemo(victimHandle: string, network: BchNetwork, live: ResolveDeps = liveDeps(network)): Promise<AttackRun> {
  const started = performance.now();
  const txCache = new Map<string, ReturnType<ResolveDeps["getTransaction"]>>();
  const deps: ResolveDeps = {
    ...live,
    getTransaction: (txid: string) => {
      if (!txCache.has(txid)) txCache.set(txid, live.getTransaction(txid));
      return txCache.get(txid)!;
    },
  };
  const victim = await resolveHandle(victimHandle, network, deps);
  if (victim.status !== "verified") return { victim, ms: performance.now() - started };
  const mallory = makeMallory(network);
  const fake = await runFakeClaim(victim, mallory, network, deps);
  return { victim, fake, link: tamperLink(victimHandle, victim, mallory), ms: performance.now() - started };
}
