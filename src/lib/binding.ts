/**
 * HPAY-BIND v1: a name is Verified when two proofs point at each other.
 *
 * - A BCH proof transaction, spent only from the bound address, carries
 *   `OP_RETURN "HPAY" 0x01 <32-byte x-only Nostr pubkey>`.
 * - A Nostr event signed by that pubkey names the address and the proof txid.
 *
 * This module is pure: building events, parsing them, and checking a proof
 * transaction from raw bytes. Fetching lives in nostr.ts and resolve.ts.
 */
import {
  binToHex,
  cashAddressToLockingBytecode,
  decodeCashAddress,
  decodeTransaction,
  hashTransaction,
  hexToBin,
  type TransactionCommon,
} from "@bitauth/libauth";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { PREFIX, type BchNetwork } from "./network";

/** Binding event kind. Placeholder until Paytaca confirms a number. */
export const BINDING_KIND = 30145;
export const BINDING_D = "bch-bind";
/** NIP-A3 public payment target. */
export const PAYTO_KIND = 10133;
/** Paytaca's existing app-data format; read-only, never Verified. */
export const PAYTACA_KIND = 30078;
export const PAYTACA_D = "paytaca:bch-address";

export const PROOF_MAGIC = "48504159"; // "HPAY"
export const PROOF_VERSION = 1;

const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/** Strip the `bitcoincash:` / `bchtest:` prefix (tags store addresses bare). */
export function bareAddress(address: string): string {
  const i = address.indexOf(":");
  return (i >= 0 ? address.slice(i + 1) : address).toLowerCase();
}

/**
 * Normalise an address (with or without prefix) to the full P2PKH cashaddr for
 * `network`. Returns null if it doesn't decode, belongs to another network, or
 * isn't P2PKH (bindings are P2PKH only).
 */
export function normalizeAddress(address: string, network: BchNetwork): string | null {
  const full = `${PREFIX[network]}:${bareAddress(address)}`;
  if (address.includes(":") && !address.toLowerCase().startsWith(`${PREFIX[network]}:`)) return null;
  const decoded = decodeCashAddress(full);
  if (typeof decoded === "string") return null;
  if (decoded.type !== "p2pkh") return null;
  return full;
}

function lockingBytecodeHex(address: string): string {
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === "string") throw new Error(decoded);
  return binToHex(decoded.bytecode);
}

// ---------------------------------------------------------------------------
// Proof transaction
// ---------------------------------------------------------------------------

/** OP_RETURN chunks for `sendBch({ opReturn })`, in CashScript's "0x…" hex form. */
export function proofOpReturnChunks(pubkeyHex: string): string[] {
  const pubkey = pubkeyHex.toLowerCase();
  if (!HEX64.test(pubkey)) throw new Error("Nostr pubkey must be 32 bytes of hex.");
  return [`0x${PROOF_MAGIC}`, `0x0${PROOF_VERSION}`, `0x${pubkey}`];
}

/**
 * Read the committed pubkey from one output's locking bytecode. Only the exact
 * canonical form is accepted:
 * `6a 04 48504159 01 01 20 <32 bytes>` (41 bytes).
 */
export function parseProofOutput(lockingBytecode: Uint8Array): string | null {
  const hex = binToHex(lockingBytecode);
  const head = `6a04${PROOF_MAGIC}010${PROOF_VERSION}20`;
  if (hex.length !== head.length + 64 || !hex.startsWith(head)) return null;
  return hex.slice(head.length);
}

/** Every pubkey a transaction commits to via an HPAY output. */
export function proofCommitments(tx: TransactionCommon): string[] {
  return tx.outputs.map((o) => parseProofOutput(o.lockingBytecode)).filter((p): p is string => p !== null);
}

export type ProofCheckId = "spends" | "commits" | "confirmed" | "network";

export interface Check {
  id: ProofCheckId | "nip05" | "signature";
  ok: boolean;
  /** Plain-language line for the "How we checked" list. */
  label: string;
  /** Why it failed, when it did. */
  detail?: string;
}

export interface ProofInput {
  /** Raw hex of the proof transaction, as served by Fulcrum. */
  proofHex: string;
  /** The txid the binding event names. */
  proofTxid: string;
  confirmations: number;
  /** Raw hex of each parent transaction, keyed by txid. */
  parents: Map<string, string>;
  /** Address the event claims, normalised for `network`. */
  address: string;
  /** Author of the binding event. */
  pubkey: string;
  /** Network the event says it's on. */
  eventNetwork: string;
  /** Network this page is resolving on. */
  network: BchNetwork;
}

function decodeHex(hex: string): TransactionCommon | null {
  try {
    const tx = decodeTransaction(hexToBin(hex));
    return typeof tx === "string" ? null : tx;
  } catch {
    return null;
  }
}

/**
 * The four BCH-side checks, all re-derived from raw bytes so a server can't
 * fake them beyond withholding data:
 *
 * a. every input spends a coin locked to the claimed address;
 * b. an output is `OP_RETURN HPAY 01 <pubkey>` with the event author's pubkey;
 * c. at least one confirmation;
 * d. the event's network matches the page's.
 *
 * Spec note: v1 requires *every* input to come from the bound address (the
 * proof transaction has "no other inputs"), so a mixed-input transaction is
 * Claimed, not Verified.
 */
export function checkProof(input: ProofInput): Check[] {
  const { proofHex, proofTxid, confirmations, parents, address, pubkey, eventNetwork, network } = input;
  const checks: Check[] = [];

  const tx = decodeHex(proofHex);
  const hashOk = tx !== null && hashTransaction(hexToBin(proofHex)) === proofTxid;

  // a. spends from the address
  let spends: Check = { id: "spends", ok: false, label: "Proof was paid from this address" };
  if (!hashOk) {
    spends.detail = "Proof transaction could not be read";
  } else {
    const want = lockingBytecodeHex(address);
    let ok = tx!.inputs.length > 0;
    let detail: string | undefined;
    for (const inp of tx!.inputs) {
      const parentTxid = binToHex(inp.outpointTransactionHash);
      const parentHex = parents.get(parentTxid);
      const parent = parentHex && hashTransaction(hexToBin(parentHex)) === parentTxid ? decodeHex(parentHex) : null;
      const spent = parent?.outputs[inp.outpointIndex];
      if (!spent) {
        ok = false;
        detail = "Could not read a coin the proof spent";
        break;
      }
      if (binToHex(spent.lockingBytecode) !== want) {
        ok = false;
        detail = "Proof spends a coin from a different address";
        break;
      }
    }
    spends = { ...spends, ok, detail: ok ? undefined : detail };
  }
  checks.push(spends);

  // b. commits to the author's pubkey
  const commitments = hashOk ? proofCommitments(tx!) : [];
  const commits: Check = {
    id: "commits",
    ok: commitments.includes(pubkey.toLowerCase()),
    label: "Proof names this Nostr key",
  };
  if (!commits.ok) {
    commits.detail = commitments.length
      ? "Proof names a different Nostr key"
      : hashOk
        ? "No HandlePay proof in this transaction"
        : "Proof transaction could not be read";
  }
  checks.push(commits);

  // c. confirmed
  checks.push({
    id: "confirmed",
    ok: hashOk && confirmations >= 1,
    label: "Proof is confirmed on chain",
    detail: hashOk && confirmations < 1 ? "Waiting for confirmation" : hashOk ? undefined : "Proof not found",
  });

  // d. network
  const netOk = eventNetwork === network;
  checks.push({
    id: "network",
    ok: netOk,
    label: `Binding is for ${network}`,
    detail: netOk ? undefined : `Binding is for ${eventNetwork || "an unknown network"}`,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Nostr events
// ---------------------------------------------------------------------------

export function buildBindingEvent(opts: {
  address: string;
  proofTxid: string;
  network: BchNetwork;
  nip05?: string;
  createdAt?: number;
}): EventTemplate {
  const { address, proofTxid, network, nip05 } = opts;
  const normalized = normalizeAddress(address, network);
  if (!normalized) throw new Error(`Not a ${network} P2PKH address: ${address}`);
  if (!HEX64.test(proofTxid)) throw new Error("Proof txid must be 32 bytes of hex.");
  const bare = bareAddress(normalized);
  const tags = [
    ["d", BINDING_D],
    ["payto", "bitcoincash", bare],
    ["proof", proofTxid],
    ["network", network],
  ];
  if (nip05) tags.push(["nip05", nip05.toLowerCase()]);
  return {
    kind: BINDING_KIND,
    created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify({ v: 1, network, address: bare, proof: { type: "op_return_spend", txid: proofTxid } }),
  };
}

export function buildRevokeEvent(createdAt?: number): EventTemplate {
  return {
    kind: BINDING_KIND,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    tags: [["d", BINDING_D]],
    content: JSON.stringify({ v: 1, revoked: true }),
  };
}

/** NIP-A3 payment target so other Nostr clients can find the address. */
export function buildPaytoEvent(address: string, createdAt?: number): EventTemplate {
  return {
    kind: PAYTO_KIND,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    tags: [["payto", "bitcoincash", bareAddress(address)]],
    content: "",
  };
}

export type ParsedBinding =
  | { type: "binding"; address: string; proofTxid: string; network: string; nip05?: string }
  | { type: "revoked" }
  | { type: "invalid"; reason: string };

const tagValue = (event: NostrEvent, name: string, index = 1) => event.tags.find((t) => t[0] === name)?.[index];

/**
 * Parse a kind-30145 event. Content and tags must agree; the address is
 * returned normalised for the event's own network.
 */
export function parseBindingEvent(event: NostrEvent): ParsedBinding {
  if (event.kind !== BINDING_KIND || tagValue(event, "d") !== BINDING_D) {
    return { type: "invalid", reason: "Not a HandlePay binding" };
  }
  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    return { type: "invalid", reason: "Binding content is not JSON" };
  }
  if (typeof content !== "object" || content === null) return { type: "invalid", reason: "Binding content is empty" };
  const c = content as Record<string, unknown>;
  if (c.v !== 1) return { type: "invalid", reason: "Unsupported binding version" };
  if (c.revoked === true) return { type: "revoked" };

  const network = typeof c.network === "string" ? c.network : "";
  if (network !== "mainnet" && network !== "chipnet") return { type: "invalid", reason: "Unknown network" };
  const address = typeof c.address === "string" ? normalizeAddress(c.address, network) : null;
  if (!address) return { type: "invalid", reason: "Address does not match the network" };
  const proof = c.proof as Record<string, unknown> | undefined;
  const txid = typeof proof?.txid === "string" ? proof.txid.toLowerCase() : "";
  if (proof?.type !== "op_return_spend" || !HEX64.test(txid)) return { type: "invalid", reason: "Missing proof" };

  const payto = event.tags.find((t) => t[0] === "payto" && t[1] === "bitcoincash")?.[2];
  if (!payto || bareAddress(payto) !== bareAddress(address)) {
    return { type: "invalid", reason: "Tags and content name different addresses" };
  }
  if ((tagValue(event, "proof") ?? "").toLowerCase() !== txid) {
    return { type: "invalid", reason: "Tags and content name different proofs" };
  }
  if (tagValue(event, "network") !== network) return { type: "invalid", reason: "Tags and content disagree on network" };

  return { type: "binding", address, proofTxid: txid, network, nip05: tagValue(event, "nip05") };
}

/** Address from a NIP-A3 `payto` event (Claimed only). */
export function parsePaytoEvent(event: NostrEvent, network: BchNetwork): string | null {
  if (event.kind !== PAYTO_KIND) return null;
  for (const t of event.tags) {
    if (t[0] === "payto" && t[1] === "bitcoincash" && t[2]) {
      const a = normalizeAddress(t[2], network);
      if (a) return a;
    }
  }
  return null;
}

/**
 * Address from Paytaca's kind-30078 `paytaca:bch-address` event (Claimed only).
 * The exact content format is unconfirmed, so this accepts either a bare
 * address string or a JSON object with an `address` field.
 */
export function parsePaytacaEvent(event: NostrEvent, network: BchNetwork): string | null {
  if (event.kind !== PAYTACA_KIND || tagValue(event, "d") !== PAYTACA_D) return null;
  let candidate = event.content.trim();
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed.address === "string") candidate = parsed.address;
  } catch {
    /* plain string content */
  }
  return normalizeAddress(candidate, network);
}
