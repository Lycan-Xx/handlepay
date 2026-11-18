/**
 * resolveHandle: name → Verified / Claimed / Changed / Not found, with the
 * reasons. All fetching goes through `ResolveDeps`, so the same logic runs
 * against live relays and Fulcrum or against test fixtures.
 */
import { binToHex, decodeTransaction, hexToBin } from "@bitauth/libauth";
import type { NostrEvent } from "nostr-tools/pure";
import {
  BINDING_KIND,
  PAYTACA_KIND,
  PAYTO_KIND,
  checkProof,
  normalizeAddress,
  parseBindingEvent,
  parsePaytacaEvent,
  parsePaytoEvent,
  type Check,
} from "./binding";
import { getTransaction, type BchNetwork, type ChainTx } from "./network";
import {
  dedupeVerified,
  fetchNip05,
  newest,
  parseHandle,
  queryIdentityEvents,
  relaysFor,
  type Handle,
  type Nip05Result,
} from "./nostr";

export type Status = "verified" | "claimed" | "changed" | "not_found";

export interface Pin {
  pubkey: string;
  address: string;
}

export interface Resolution {
  status: Status;
  /** Canonical handle, when the input parsed. */
  handle?: Handle;
  pubkey?: string;
  /** Payable address on this page's network. Absent for Not found. */
  address?: string;
  proofTxid?: string;
  /** Where the address came from. */
  source?: "binding" | "payto" | "paytaca";
  /** The "How we checked" list, in order. */
  checks: Check[];
  /** One-line reason shown when the status isn't Verified. */
  reason?: string;
  /** What this browser saw before, when the status is Changed. */
  previous?: Pin;
}

export interface ResolveDeps {
  fetchNip05(handle: Handle): Promise<Nip05Result | null>;
  queryEvents(pubkey: string, relays: string[]): Promise<NostrEvent[]>;
  getTransaction(txid: string): Promise<ChainTx>;
}

export function liveDeps(network: BchNetwork): ResolveDeps {
  return {
    fetchNip05: (h) => fetchNip05(h),
    queryEvents: (pubkey, relays) => queryIdentityEvents(pubkey, relays),
    getTransaction: (txid) => getTransaction(network, txid),
  };
}

const firstFailure = (checks: Check[]) => checks.find((c) => !c.ok);

export async function resolveHandle(
  input: string,
  network: BchNetwork,
  deps: ResolveDeps,
  pinned?: Pin | null,
): Promise<Resolution> {
  const handle = parseHandle(input) ?? undefined;
  if (!handle) return { status: "not_found", checks: [], reason: "That doesn't look like a name (name@domain)" };

  // 1. Name → Nostr key
  let nip05: Nip05Result | null;
  try {
    nip05 = await deps.fetchNip05(handle);
  } catch (e) {
    return {
      status: "not_found",
      handle,
      checks: [{ id: "nip05", ok: false, label: `${handle.domain} lists this name`, detail: (e as Error).message }],
      reason: (e as Error).message,
    };
  }
  const nip05Check: Check = { id: "nip05", ok: !!nip05, label: `${handle.domain} lists this name` };
  if (!nip05) {
    return { status: "not_found", handle, checks: [{ ...nip05Check, detail: "Name not listed" }], reason: "No HandlePay identity for this name" };
  }
  const { pubkey } = nip05;

  // 2. Key → signed events (re-verified here even if deps already did)
  const events = dedupeVerified(await deps.queryEvents(pubkey, relaysFor(nip05.relays)), pubkey);
  const binding = newest(events.filter((e) => e.kind === BINDING_KIND));
  const parsed = binding ? parseBindingEvent(binding) : undefined;

  // 3. Revoked
  if (parsed?.type === "revoked") {
    return {
      status: "not_found",
      handle,
      pubkey,
      checks: [nip05Check, { id: "signature", ok: false, label: "Signed binding found", detail: "Binding revoked" }],
      reason: "Binding revoked",
    };
  }

  // 4–5. Binding with BCH proof
  if (parsed?.type === "binding") {
    const signature: Check = { id: "signature", ok: true, label: "Signed by this name's Nostr key" };
    const proofChecks = await gatherProofChecks(parsed, pubkey, network, deps);
    const checks = [nip05Check, signature, ...proofChecks];
    const address = normalizeAddress(parsed.address, network) ?? undefined;
    const failed = firstFailure(checks);
    if (failed || !address) {
      return {
        status: "claimed",
        handle,
        pubkey,
        address,
        proofTxid: parsed.proofTxid,
        source: "binding",
        checks,
        reason: failed?.detail ?? "Address is for another network",
      };
    }
    const result: Resolution = { status: "verified", handle, pubkey, address, proofTxid: parsed.proofTxid, source: "binding", checks };
    // 6. Trust on first use
    if (pinned && (pinned.pubkey !== pubkey || pinned.address !== address)) {
      return { ...result, status: "changed", previous: pinned, reason: "This name now points to a different address than last time" };
    }
    return result;
  }

  // Fallbacks: a claim with no BCH proof
  const payto = newest(events.filter((e) => e.kind === PAYTO_KIND));
  const paytoAddress = payto ? parsePaytoEvent(payto, network) : null;
  const paytaca = newest(events.filter((e) => e.kind === PAYTACA_KIND));
  const paytacaAddress = paytaca ? parsePaytacaEvent(paytaca, network) : null;
  const claimed = paytoAddress ?? paytacaAddress;
  const bindingProblem = parsed?.type === "invalid" ? parsed.reason : undefined;

  if (claimed) {
    return {
      status: "claimed",
      handle,
      pubkey,
      address: claimed,
      source: paytoAddress ? "payto" : "paytaca",
      checks: [
        nip05Check,
        { id: "signature", ok: true, label: "Signed by this name's Nostr key" },
        { id: "spends", ok: false, label: "Proof was paid from this address", detail: "No BCH proof from this address" },
      ],
      reason: bindingProblem ?? "No BCH proof from this address",
    };
  }

  return {
    status: "not_found",
    handle,
    pubkey,
    checks: [nip05Check, { id: "signature", ok: false, label: "Signed binding found", detail: bindingProblem ?? "No binding published" }],
    reason: bindingProblem ?? "No HandlePay identity for this name",
  };
}

async function gatherProofChecks(
  parsed: { address: string; proofTxid: string; network: string },
  pubkey: string,
  network: BchNetwork,
  deps: ResolveDeps,
): Promise<Check[]> {
  let proof: ChainTx;
  try {
    proof = await deps.getTransaction(parsed.proofTxid);
  } catch {
    return [
      { id: "spends", ok: false, label: "Proof was paid from this address", detail: "Proof transaction not found" },
      { id: "commits", ok: false, label: "Proof names this Nostr key", detail: "Proof transaction not found" },
      { id: "confirmed", ok: false, label: "Proof is confirmed on chain", detail: "Proof transaction not found" },
      {
        id: "network",
        ok: parsed.network === network,
        label: `Binding is for ${network}`,
        detail: parsed.network === network ? undefined : `Binding is for ${parsed.network}`,
      },
    ];
  }

  // Fetch each parent so "spends from this address" is checked from raw bytes.
  const parents = new Map<string, string>();
  try {
    const tx = decodeTransaction(hexToBin(proof.hex));
    if (typeof tx !== "string") {
      const ids = [...new Set(tx.inputs.map((i) => binToHex(i.outpointTransactionHash)))];
      await Promise.all(
        ids.map(async (id) => {
          try {
            parents.set(id, (await deps.getTransaction(id)).hex);
          } catch {
            /* missing parent → the spends check fails with a reason */
          }
        }),
      );
    }
  } catch {
    /* undecodable → checkProof reports it */
  }

  return checkProof({
    proofHex: proof.hex,
    proofTxid: parsed.proofTxid,
    confirmations: proof.confirmations,
    parents,
    address: parsed.address,
    pubkey,
    eventNetwork: parsed.network,
    network,
  });
}

/** Whether the pay button is allowed, and what has to be confirmed first. */
export function paymentGate(r: Resolution): "allowed" | "confirm_unverified" | "acknowledge_change" | "blocked" {
  if (!r.address) return "blocked";
  switch (r.status) {
    case "verified":
      return "allowed";
    case "claimed":
      return "confirm_unverified";
    case "changed":
      return "acknowledge_change";
    default:
      return "blocked";
  }
}
