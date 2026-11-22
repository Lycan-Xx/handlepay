/**
 * Temporary developer panel for the Nov 18 milestone: bind a wallet address to
 * a Nostr key on a real network, publish the binding, and resolve a name.
 * The real /identity and /pay routes replace this.
 */
import { useState } from "react";
import type { DappConnectionManager } from "@wizardconnect/dapp";
import { buildBindingEvent, buildPaytoEvent, buildRevokeEvent, proofOpReturnChunks } from "../lib/binding";
import { explorerTx, type BchNetwork } from "../lib/network";
import { paymentErrorMessage } from "../lib/paylink";
import { DEFAULT_RELAYS, hasSigner, publishEvent, signWithExtension, signerPubkey, type PublishResult } from "../lib/nostr";
import { liveDeps, resolveHandle, type Resolution } from "../lib/resolve";
import { sendBch, type WalletCoin } from "../lib/wallet";
import { Icon } from "./Icon";

const PROOF_KEY = "handlepay-dev-proof";
/** The Nostr key this tab connected, so a wallet reconnect doesn't make you connect it again. */
const SIGNER_KEY = "handlepay-dev-signer";

interface StoredProof {
  network: BchNetwork;
  address: string;
  pubkey: string;
  txid: string;
}

function loadSigner(): string | null {
  try {
    return sessionStorage.getItem(SIGNER_KEY);
  } catch {
    return null;
  }
}

function loadProof(): StoredProof | null {
  try {
    return JSON.parse(localStorage.getItem(PROOF_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function IdentityDev(props: {
  manager: DappConnectionManager;
  /** False while the wallet is reconnecting: everything works except asking it to sign. */
  walletReady: boolean;
  walletName: string;
  network: BchNetwork;
  coins: WalletCoin[];
  bindAddress: string;
  onSent: () => void;
}) {
  const { manager, walletReady, walletName, network, coins, bindAddress, onSent } = props;
  const [pubkey, setPubkey] = useState<string | null>(loadSigner);
  const [proof, setProof] = useState<StoredProof | null>(loadProof);
  const [nip05, setNip05] = useState("");
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [lookup, setLookup] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(paymentErrorMessage(e, false, network));
    } finally {
      setBusy(null);
    }
  };

  const currentProof = proof && proof.network === network && proof.address === bindAddress && proof.pubkey === pubkey ? proof : null;
  const fromAddress = coins.filter((c) => c.owner.address === bindAddress).reduce((s, c) => s + c.satoshis, 0n);

  const connectNostr = () =>
    run("nostr", async () => {
      const key = await signerPubkey();
      setPubkey(key);
      try {
        sessionStorage.setItem(SIGNER_KEY, key);
      } catch {
        /* keep in memory */
      }
    });

  const sendProof = () =>
    run("proof", async () => {
      if (!pubkey) return;
      // The key may have been remembered from earlier in this tab; the proof is on chain for good, so check it first.
      if ((await signerPubkey()) !== pubkey) {
        setPubkey(null);
        try {
          sessionStorage.removeItem(SIGNER_KEY);
        } catch {
          /* nothing stored */
        }
        throw new Error("Your Nostr extension now holds a different key. Press Connect Nostr signer again.");
      }
      const { txid } = await sendBch({
        manager,
        network,
        coins,
        amount: 0n,
        changeAddress: bindAddress,
        onlyFrom: bindAddress,
        opReturn: proofOpReturnChunks(pubkey),
        userPrompt: "HandlePay: prove you control this address",
      });
      const stored = { network, address: bindAddress, pubkey, txid };
      setProof(stored);
      try {
        localStorage.setItem(PROOF_KEY, JSON.stringify(stored));
      } catch {
        /* keep in memory */
      }
      setTimeout(onSent, 3000);
    });

  const publish = (kind: "bind" | "revoke") =>
    run(kind, async () => {
      if (!pubkey) return;
      const templates =
        kind === "bind" && currentProof
          ? [
              buildBindingEvent({ address: bindAddress, proofTxid: currentProof.txid, network, nip05: nip05.trim() || undefined }),
              buildPaytoEvent(bindAddress),
            ]
          : [buildRevokeEvent()];
      let first: PublishResult | null = null;
      for (const t of templates) {
        const event = await signWithExtension(t, pubkey);
        const result = await publishEvent(event, DEFAULT_RELAYS);
        first ??= result;
      }
      setPublished(first);
    });

  const resolve = () =>
    run("resolve", async () => {
      setResolution(null);
      setResolution(await resolveHandle(lookup, network, liveDeps(network)));
    });

  return (
    <section className="card">
      <h2>4. Identity (developer test)</h2>

      <p className="label">Nostr signer</p>
      {pubkey ? (
        <code className="addr">{pubkey}</code>
      ) : (
        <button onClick={connectNostr} disabled={!!busy}>
          {hasSigner() ? "Connect Nostr signer" : "No signer found (install Alby or nos2x)"}
        </button>
      )}

      <p className="label">Address to bind (receive 0)</p>
      <code className="addr">{bindAddress}</code>
      <p className="muted">Coins at this address: {fromAddress.toString()} sats (needs about 2,000)</p>

      <button onClick={sendProof} disabled={!walletReady || !pubkey || !!busy || fromAddress < 2_000n}>
        {busy === "proof" ? "Approve in your wallet…" : "1. Send proof transaction"}
      </button>
      {!walletReady && (
        <p className="muted">Reconnecting to {walletName}. Open the wallet app to send the proof.</p>
      )}
      {currentProof && (
        <p>
          Proof:{" "}
          <a href={explorerTx(network, currentProof.txid)} target="_blank" rel="noreferrer">
            {currentProof.txid.slice(0, 10)}…{currentProof.txid.slice(-8)}
          </a>{" "}
          <span className="muted">(Verified needs 1 confirmation, about 10 minutes)</span>
        </p>
      )}

      <label>
        Your name (NIP-05, optional)
        <input value={nip05} onChange={(e) => setNip05(e.target.value)} placeholder="sani@lycanforge.com.ng" />
      </label>
      <button onClick={() => publish("bind")} disabled={!currentProof || !!busy}>
        {busy === "bind" ? "Signing…" : "2. Sign and publish binding"}
      </button>{" "}
      <button className="ghost" onClick={() => publish("revoke")} disabled={!pubkey || !!busy}>
        Revoke
      </button>
      {published && (
        <p className="muted">
          Published to {published.ok.length}/{published.ok.length + published.failed.length} relays
          {published.failed.length > 0 && `; failed: ${published.failed.map((f) => f.relay).join(", ")}`}
        </p>
      )}

      <label>
        Check a name
        <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="name@domain" />
      </label>
      <button onClick={resolve} disabled={!lookup || !!busy}>
        {busy === "resolve" ? "Checking…" : "Resolve"}
      </button>
      {resolution && (
        <div aria-live="polite">
          <p>
            <strong>{resolution.status.replace("_", " ")}</strong>
            {resolution.reason && ` · ${resolution.reason}`}
          </p>
          <ul>
            {resolution.checks.map((c) => (
              <li key={c.id}>
                <Icon name={c.ok ? "check" : "close"} /> {c.label}
                {c.detail && ` (${c.detail})`}
              </li>
            ))}
          </ul>
          {resolution.address && <code className="addr">{resolution.address}</code>}
        </div>
      )}

      {error && <p className="err">{error}</p>}
    </section>
  );
}
