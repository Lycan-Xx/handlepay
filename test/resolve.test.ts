import { MockNetworkProvider } from "cashscript";
import { finalizeEvent, type NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  PAYTACA_D,
  PAYTACA_KIND,
  buildBindingEvent,
  buildPaytoEvent,
  buildRevokeEvent,
  proofOpReturnChunks,
} from "../src/lib/binding";
import type { ChainTx } from "../src/lib/network";
import type { Nip05Result } from "../src/lib/nostr";
import { paymentGate, resolveHandle, type ResolveDeps } from "../src/lib/resolve";
import { buildSignRequest, txidOf } from "../src/lib/wallet";
import { fundingTx, nostrKey, owner } from "./helpers";

const provider = new MockNetworkProvider();
const HANDLE = "sani@lycanforge.com.ng";

/** An in-memory internet: NIP-05 files, relay events, chain transactions. */
function world() {
  const names = new Map<string, Nip05Result>();
  const events: NostrEvent[] = [];
  const txs = new Map<string, ChainTx>();
  const deps: ResolveDeps = {
    fetchNip05: async (h) => names.get(h.full) ?? null,
    queryEvents: async (pubkey) => events.filter((e) => e.pubkey === pubkey),
    getTransaction: async (txid) => {
      const tx = txs.get(txid);
      if (!tx) throw new Error("not found");
      return tx;
    },
  };
  return { names, events, txs, deps };
}

/** Sani with a confirmed proof and a published binding. */
function seedSani(w: ReturnType<typeof world>, opts: { confirmations?: number; createdAt?: number } = {}) {
  const key = nostrKey("sani");
  const addr = owner("sani");
  const funding = fundingTx([{ owner: addr, satoshis: 10_000n }], "sani");
  const request = buildSignRequest({
    network: "chipnet",
    coins: funding.coins,
    amount: 0n,
    changeAddress: addr.address,
    opReturn: proofOpReturnChunks(key.pubkey),
    provider,
  });
  const proofHex = request.transaction.transaction;
  const proofTxid = txidOf(proofHex);
  w.txs.set(funding.txid, { hex: funding.hex, confirmations: 5 });
  w.txs.set(proofTxid, { hex: proofHex, confirmations: opts.confirmations ?? 1 });
  w.names.set(HANDLE, { pubkey: key.pubkey, relays: [] });
  const binding = finalizeEvent(
    buildBindingEvent({ address: addr.address, proofTxid, network: "chipnet", nip05: HANDLE, createdAt: opts.createdAt ?? 1_000 }),
    key.secretKey,
  );
  w.events.push(binding);
  return { key, addr, proofTxid, binding };
}

describe("resolveHandle", () => {
  it("returns Verified when NIP-05, signature and BCH proof all check out", async () => {
    const w = world();
    const { addr, key, proofTxid } = seedSani(w);
    const r = await resolveHandle(HANDLE, "chipnet", w.deps);
    expect(r.status).toBe("verified");
    expect(r.address).toBe(addr.address);
    expect(r.pubkey).toBe(key.pubkey);
    expect(r.proofTxid).toBe(proofTxid);
    expect(r.checks.map((c) => [c.id, c.ok])).toEqual([
      ["nip05", true],
      ["signature", true],
      ["spends", true],
      ["commits", true],
      ["confirmed", true],
      ["network", true],
    ]);
    expect(paymentGate(r)).toBe("allowed");
  });

  it("is case-insensitive on the handle", async () => {
    const w = world();
    seedSani(w);
    expect((await resolveHandle("  Sani@LycanForge.com.ng ", "chipnet", w.deps)).status).toBe("verified");
  });

  it("returns Not found for an unlisted name", async () => {
    const r = await resolveHandle("nobody@example.com", "chipnet", world().deps);
    expect(r.status).toBe("not_found");
    expect(paymentGate(r)).toBe("blocked");
  });

  it("returns Not found for garbage input", async () => {
    expect((await resolveHandle("not a handle", "chipnet", world().deps)).status).toBe("not_found");
  });

  it("returns Not found when the domain is unreachable", async () => {
    const w = world();
    w.deps.fetchNip05 = async () => {
      throw new Error("Couldn't reach example.com to look up this name.");
    };
    const r = await resolveHandle("x@example.com", "chipnet", w.deps);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/Couldn't reach/);
  });

  it("returns Not found when the newest binding is a revocation", async () => {
    const w = world();
    const { key } = seedSani(w);
    w.events.push(finalizeEvent(buildRevokeEvent(2_000), key.secretKey));
    const r = await resolveHandle(HANDLE, "chipnet", w.deps);
    expect(r.status).toBe("not_found");
    expect(r.reason).toBe("Binding revoked");
  });

  it("uses the newest binding: a rebind after revocation is Verified again", async () => {
    const w = world();
    const { key, binding } = seedSani(w);
    w.events.push(finalizeEvent(buildRevokeEvent(2_000), key.secretKey));
    w.events.push(finalizeEvent({ ...binding, created_at: 3_000 }, key.secretKey));
    expect((await resolveHandle(HANDLE, "chipnet", w.deps)).status).toBe("verified");
  });

  it("returns Claimed with a waiting reason when the proof is unconfirmed", async () => {
    const w = world();
    seedSani(w, { confirmations: 0 });
    const r = await resolveHandle(HANDLE, "chipnet", w.deps);
    expect(r.status).toBe("claimed");
    expect(r.reason).toBe("Waiting for confirmation");
    expect(paymentGate(r)).toBe("confirm_unverified");
  });

  it("returns Claimed when the proof transaction doesn't exist", async () => {
    const w = world();
    const { proofTxid } = seedSani(w);
    w.txs.delete(proofTxid);
    const r = await resolveHandle(HANDLE, "chipnet", w.deps);
    expect(r.status).toBe("claimed");
    expect(r.reason).toBe("Proof transaction not found");
  });

  it("security demo: Mallory claims Sani's address and replays Sani's proof → Claimed", async () => {
    const w = world();
    const sani = seedSani(w);
    const mallory = nostrKey("mallory");
    w.names.set("mallory@evil.example", { pubkey: mallory.pubkey, relays: [] });
    w.events.push(
      finalizeEvent(
        buildBindingEvent({ address: sani.addr.address, proofTxid: sani.proofTxid, network: "chipnet", createdAt: 5_000 }),
        mallory.secretKey,
      ),
    );
    const r = await resolveHandle("mallory@evil.example", "chipnet", w.deps);
    expect(r.status).toBe("claimed");
    expect(r.reason).toBe("Proof names a different Nostr key");
  });

  it("ignores events with bad signatures even if deps return them", async () => {
    const w = world();
    const { binding, key } = seedSani(w);
    const forged = finalizeEvent(buildRevokeEvent(9_000), key.secretKey);
    w.events.push({ ...forged, sig: binding.sig }); // signature from another event
    expect((await resolveHandle(HANDLE, "chipnet", w.deps)).status).toBe("verified");
  });

  it("returns Claimed from a NIP-A3 payto event with no binding", async () => {
    const w = world();
    const key = nostrKey("payto-only");
    const addr = owner("payto-only");
    w.names.set("p@example.com", { pubkey: key.pubkey, relays: [] });
    w.events.push(finalizeEvent(buildPaytoEvent(addr.address, 1), key.secretKey));
    const r = await resolveHandle("p@example.com", "chipnet", w.deps);
    expect(r).toMatchObject({ status: "claimed", address: addr.address, source: "payto", reason: "No BCH proof from this address" });
  });

  it("returns Claimed from Paytaca's 30078 event", async () => {
    const w = world();
    const key = nostrKey("paytaca-user");
    const addr = owner("paytaca-user");
    w.names.set("t@example.com", { pubkey: key.pubkey, relays: [] });
    w.events.push(
      finalizeEvent({ kind: PAYTACA_KIND, created_at: 1, tags: [["d", PAYTACA_D]], content: addr.address }, key.secretKey),
    );
    expect(await resolveHandle("t@example.com", "chipnet", w.deps)).toMatchObject({ status: "claimed", source: "paytaca" });
  });

  it("returns Claimed when a mainnet binding is resolved on chipnet", async () => {
    const w = world();
    const key = nostrKey("mainnet-user");
    const addr = owner("mainnet-user", "receive", 0, "mainnet");
    w.names.set("m@example.com", { pubkey: key.pubkey, relays: [] });
    w.events.push(
      finalizeEvent(buildBindingEvent({ address: addr.address, proofTxid: "ab".repeat(32), network: "mainnet", createdAt: 1 }), key.secretKey),
    );
    const r = await resolveHandle("m@example.com", "chipnet", w.deps);
    expect(r.status).toBe("claimed");
    expect(r.address).toBeUndefined(); // never pay a mainnet address from chipnet
    expect(paymentGate(r)).toBe("blocked");
  });

  describe("trust on first use", () => {
    it("is Verified when the pin matches", async () => {
      const w = world();
      const { key, addr } = seedSani(w);
      const r = await resolveHandle(HANDLE, "chipnet", w.deps, { pubkey: key.pubkey, address: addr.address });
      expect(r.status).toBe("verified");
    });

    it("is Changed when nostr.json now points at a different (also proven) key", async () => {
      const w = world();
      const { key, addr } = seedSani(w);
      const pin = { pubkey: "cd".repeat(32), address: addr.address };
      const r = await resolveHandle(HANDLE, "chipnet", w.deps, pin);
      expect(r.status).toBe("changed");
      expect(r.previous).toEqual(pin);
      expect(r.pubkey).toBe(key.pubkey);
      expect(paymentGate(r)).toBe("acknowledge_change");
    });
  });
});
