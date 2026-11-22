/**
 * /identity: set up a name to be paid at, in three steps, then manage it.
 *
 * 1. Name and key. Two ways to get a name: a free one on HandlePay's domain
 *    (pick a name, make or connect a key, claim it, no domain needed), or one on
 *    your own domain (the page shows the nostr.json file to host). The key is
 *    either a Nostr extension or one kept in this browser. Either way the page
 *    then checks that the name's domain lists that key.
 * 2. Wallet: connect the wallet to be paid in; its first receive address is
 *    the one that gets bound, and it needs a few thousand sats for the proof.
 * 3. Proof and publish: a transaction from that address to itself carrying
 *    the Nostr key, then the signed binding on relays.
 *
 * Progress is kept in localStorage per network (it's all public data: name,
 * key, address, txid), so a reload or a long wait for a confirmation doesn't
 * lose anything.
 */
import { useEffect, useMemo, useState } from "react";
import { decodeTransaction, hexToBin } from "@bitauth/libauth";
import { CopyButton } from "../components/CopyButton";
import { Journey } from "../components/Journey";
import { VerifyCard } from "../components/VerifyCard";
import type { Wallet } from "../hooks/useWallet";
import { buildBindingEvent, buildPaytoEvent, buildRevokeEvent, proofOpReturnChunks } from "../lib/binding";
import { explorerTx, getTransaction, type BchNetwork } from "../lib/network";
import { HOSTED_DOMAIN, hostedHandle, isHostedHandle, lookupName, claimName, releaseName, HostedError, type Availability } from "../lib/hosted";
import { checkLocalName } from "../lib/hostedRules";
import { DEFAULT_RELAYS, fetchNip05, hasSigner, parseHandle, publishEvent } from "../lib/nostr";
import {
  createBrowserKey,
  exportBrowserKey,
  hasBrowserKey,
  importBrowserKey,
  signerFor,
  type SignerKind,
} from "../lib/signer";
import { diagnoseNip05, type Nip05Diagnosis } from "../lib/nip05diagnose";
import { paymentErrorMessage } from "../lib/paylink";
import { liveDeps, resolveHandle, type Resolution } from "../lib/resolve";
import { navigate, payPath } from "../lib/router";
import { buildSignRequest, formatBch, selectCoins, sendBch } from "../lib/wallet";

/** Enough for the proof's fee with room to spare; the coin comes back as change. */
const PROOF_MIN_SATS = 2_000n;

interface Progress {
  name: string;
  pubkey?: string;
  /** Which signer holds `pubkey`: a Nostr extension or the key kept in this browser. Older saves have none, meaning extension. */
  signer?: SignerKind;
  proof?: { address: string; pubkey: string; txid: string };
  /** Set once the binding for `proof` is on relays. */
  publishedTxid?: string;
}

const storageKey = (network: BchNetwork) => `handlepay-identity-${network}`;

function load(network: BchNetwork): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(storageKey(network)) ?? "null");
    if (p && typeof p.name === "string") return p;
  } catch {
    /* fall through */
  }
  return { name: "" };
}

function save(network: BchNetwork, p: Progress) {
  try {
    localStorage.setItem(storageKey(network), JSON.stringify(p));
  } catch {
    /* keep in memory */
  }
}

type NameCheck =
  | { state: "idle" | "checking" }
  | { state: "ok" }
  | { state: "missing" }
  | { state: "other_key"; listed: string }
  | { state: "error"; message: string };

const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`;

/** Worded for the Nostr and name steps; paymentErrorMessage's "Payment cancelled in your wallet" would be wrong here. */
function nostrErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (!(e instanceof HostedError) && /reject|denied|declin|cancel/i.test(message)) return "Cancelled in your Nostr extension. Nothing changed.";
  return message;
}

export function IdentityPage({ wallet, network }: { wallet: Wallet; network: BchNetwork }) {
  const { wc, connected, restoring, connect, receiveAddress, coins, refresh } = wallet;
  const [progress, setProgressState] = useState<Progress>(() => load(network));
  const [nameInput, setNameInput] = useState(progress.name);
  const [nameCheck, setNameCheck] = useState<NameCheck>({ state: "idle" });
  const [confirmations, setConfirmations] = useState<number | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [lookups, setLookups] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);
  // "free": a name on HandlePay's domain. "domain": the person's own. A name set up before decides which one to show.
  const [mode, setMode] = useState<"free" | "domain">(!progress.name || isHostedHandle(progress.name) ? "free" : "domain");
  const [localInput, setLocalInput] = useState(isHostedHandle(progress.name) ? progress.name.split("@")[0] : "");
  const [avail, setAvail] = useState<Availability | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [replaceOk, setReplaceOk] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);

  const setProgress = (next: Progress) => {
    setProgressState(next);
    save(network, next);
  };

  const handle = parseHandle(progress.name);
  const { pubkey, proof } = progress;

  // Step 1: does the name's domain list this key?
  useEffect(() => {
    if (!handle || !pubkey) return;
    let cancelled = false;
    setNameCheck({ state: "checking" });
    fetchNip05(handle)
      .then((r) => {
        if (cancelled) return;
        if (!r) setNameCheck({ state: "missing" });
        else if (r.pubkey !== pubkey) setNameCheck({ state: "other_key", listed: r.pubkey });
        else setNameCheck({ state: "ok" });
      })
      .catch((e: Error) => !cancelled && setNameCheck({ state: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
    // handle is derived from progress.name
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.name, pubkey, lookups]);

  // When the check fails, probe the same URL once more so the page can say why (advice only; it decides nothing).
  const [diagnosis, setDiagnosis] = useState<Nip05Diagnosis | null>(null);
  useEffect(() => {
    setDiagnosis(null);
    if (!handle || (nameCheck.state !== "missing" && nameCheck.state !== "error")) return;
    let cancelled = false;
    diagnoseNip05(handle)
      .then((d) => !cancelled && setDiagnosis(d))
      .catch(() => !cancelled && setDiagnosis(null));
    return () => {
      cancelled = true;
    };
    // handle is derived from progress.name
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameCheck.state, progress.name, lookups]);

  // The name the form currently describes: a free one is built from the short name typed.
  const wantedName = mode === "free" ? (checkLocalName(localInput).ok ? hostedHandle(localInput) : "") : nameInput.trim().toLowerCase();
  const wantedHosted = mode === "free";
  const signerKind: SignerKind = progress.signer ?? "extension";

  // Free names: is the one being typed free? (Debounced; cheap, and it's the same data the NIP-05 file shows.)
  useEffect(() => {
    setAvail(null);
    if (mode !== "free" || !localInput.trim()) return;
    const checked = checkLocalName(localInput);
    if (!checked.ok) {
      setAvail({ state: "invalid", message: checked.message });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      lookupName(checked.name, pubkey).then((r) => !cancelled && setAvail(r));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, localInput, pubkey, nameCheck.state]);

  const step1Done = nameCheck.state === "ok";
  const bindAddress = receiveAddress;
  const proofHere = proof && proof.address === bindAddress && proof.pubkey === pubkey ? proof : undefined;
  const atAddress = bindAddress ? coins.filter((c) => c.owner.address === bindAddress).reduce((s, c) => s + c.satoshis, 0n) : 0n;
  const step2Done = step1Done && !!bindAddress && (!!proofHere || atAddress >= PROOF_MIN_SATS);
  const published = !!proofHere && progress.publishedTxid === proofHere.txid;

  // A name set up before (on /dev, or in another browser) is picked up from the relays instead of proven again.
  useEffect(() => {
    if (!step1Done || !bindAddress || proofHere || !handle || !pubkey) return;
    let cancelled = false;
    resolveHandle(handle.full, network, liveDeps(network))
      .then((r) => {
        if (cancelled || r.status !== "verified" || r.pubkey !== pubkey || r.address !== bindAddress || !r.proofTxid) return;
        const txid = r.proofTxid;
        setProgressState((p) => {
          const next = { ...p, proof: { address: bindAddress, pubkey, txid }, publishedTxid: txid };
          save(network, next);
          return next;
        });
      })
      .catch(() => {
        /* no existing binding found: the steps continue as normal */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step1Done, bindAddress, pubkey, progress.name, network]);

  // The proof's fee, shown before signing.
  const proofFee = useMemo(() => {
    if (!bindAddress || !pubkey || atAddress < PROOF_MIN_SATS) return null;
    try {
      const picked = selectCoins(coins, 0n, bindAddress);
      const request = buildSignRequest({
        network,
        coins: picked,
        amount: 0n,
        changeAddress: bindAddress,
        opReturn: proofOpReturnChunks(pubkey),
      });
      const tx = decodeTransaction(hexToBin(request.transaction.transaction));
      if (typeof tx === "string") return null;
      const out = tx.outputs.reduce((s, o) => s + o.valueSatoshis, 0n);
      return picked.reduce((s, c) => s + c.satoshis, 0n) - out;
    } catch {
      return null;
    }
  }, [bindAddress, pubkey, atAddress, coins, network]);

  // Watch the proof until it has a confirmation.
  useEffect(() => {
    if (!proofHere) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const tx = await getTransaction(network, proofHere.txid);
        if (cancelled) return;
        setConfirmations(tx.confirmations);
        if (tx.confirmations > 0) return;
      } catch {
        /* not visible yet, or the server didn't answer: try again */
      }
      if (!cancelled) timer = setTimeout(poll, 20_000);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [proofHere?.txid, network]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once published, show the name the way a payer sees it.
  useEffect(() => {
    if (!published || !handle) return;
    let cancelled = false;
    setResolution(null);
    resolveHandle(handle.full, network, liveDeps(network))
      .then((r) => !cancelled && setResolution(r))
      .catch(() => {
        /* VerifyCard keeps showing "checking"; Check again retries */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published, progress.name, network, confirmations === 0 ? 0 : 1, lookups]);

  const run = async (label: string, fn: () => Promise<void>, kind: "pay" | "nostr" = "pay") => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(kind === "pay" ? paymentErrorMessage(e, false, network) : nostrErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** Pick the key for this name: make or reuse the browser key, or ask the extension. */
  const chooseKey = (kind: SignerKind) =>
    run(
      "key",
      async () => {
        if (!parseHandle(wantedName)) throw new Error("Pick a name first.");
        if (kind === "browser" && !hasBrowserKey()) createBrowserKey();
        const key = await signerFor(kind).pubkey();
        setProgress({ ...progress, name: wantedName, pubkey: key, signer: kind });
      },
      "nostr",
    );

  /** Put a backed-up browser key back, then use it. */
  const restoreKey = () =>
    run(
      "key",
      async () => {
        importBrowserKey(importText, { replace: replaceOk });
        setImportText("");
        setReplaceOk(false);
        const key = await signerFor("browser").pubkey();
        setProgress({ ...progress, name: wantedName, pubkey: key, signer: "browser" });
      },
      "nostr",
    );

  /** Claim the free name for this key; the page then re-checks the name like any other. */
  const claim = () =>
    run(
      "claim",
      async () => {
        if (!handle || !pubkey) return;
        await claimName(handle.local, signerFor(signerKind));
        setLookups((n) => n + 1);
      },
      "nostr",
    );

  /** Give the free name back so anyone can claim it. Clears the name here too. */
  const release = () =>
    run(
      "release",
      async () => {
        if (!handle) return;
        await releaseName(handle.local, signerFor(signerKind));
        setConfirmRelease(false);
        setLocalInput("");
        setProgress({ name: "", pubkey, signer: progress.signer });
      },
      "nostr",
    );

  const sendProof = () =>
    run("proof", async () => {
      if (!pubkey || !bindAddress || !wc.manager) return;
      // The proof writes the key on chain for good; make sure it's still the key that holds this name.
      if ((await signerFor(signerKind).pubkey()) !== pubkey) {
        setProgress({ ...progress, pubkey: undefined });
        throw new Error(
          signerKind === "browser"
            ? "The key saved in this browser isn't the one for this name. Restore your backup, then try again."
            : "Your Nostr extension now holds a different key. Connect it again.",
        );
      }
      const { txid } = await sendBch({
        manager: wc.manager,
        network,
        coins,
        amount: 0n,
        changeAddress: bindAddress,
        onlyFrom: bindAddress,
        opReturn: proofOpReturnChunks(pubkey),
        userPrompt: "HandlePay: prove this address is yours",
      });
      setConfirmations(0);
      setProgress({ ...progress, proof: { address: bindAddress, pubkey, txid } });
      setTimeout(refresh, 3000);
    });

  const publish = () =>
    run("publish", async () => {
      if (!proofHere || !handle) return;
      const templates = [
        buildBindingEvent({ address: proofHere.address, proofTxid: proofHere.txid, network, nip05: handle.full }),
        buildPaytoEvent(proofHere.address),
      ];
      for (const t of templates) {
        const event = await signerFor(signerKind).sign(t, proofHere.pubkey);
        const result = await publishEvent(event, DEFAULT_RELAYS);
        if (result.ok.length === 0) throw new Error("No relay accepted it. Check your connection and try again.");
      }
      setProgress({ ...progress, publishedTxid: proofHere.txid });
    }, "nostr");

  const revoke = () =>
    run("revoke", async () => {
      if (!pubkey) return;
      const event = await signerFor(signerKind).sign(buildRevokeEvent(), pubkey);
      const result = await publishEvent(event, DEFAULT_RELAYS);
      if (result.ok.length === 0) throw new Error("No relay accepted it. Check your connection and try again.");
      setConfirmRevoke(false);
      setProgress({ ...progress, publishedTxid: undefined });
    }, "nostr");

  const payLink = handle ? `${window.location.origin}${payPath(handle.full, { network })}` : "";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(payLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is on screen */
    }
  };

  const nostrLine = handle && pubkey ? `"${handle.local}": "${pubkey}"` : "";
  const nostrFile = handle && pubkey ? JSON.stringify({ names: { [handle.local]: pubkey } }, null, 2) : "";

  // Progress is read from the same values the steps already use; nothing here changes the flow.
  const stages: [string, boolean][] = [
    ["Name & key", step1Done],
    ["Wallet", step2Done],
    ["Proof", !!proofHere],
    ["Publish", published],
  ];
  const currentStage = stages.findIndex(([, done]) => !done);
  const currentStep = !step1Done ? 1 : !step2Done ? 2 : 3;

  return (
    <>
      <section className="card">
        <h2>Get paid by name</h2>
        <p className="muted">
          Link your name to your wallet, so people can pay <strong>{handle?.full ?? "you@yourdomain.com"}</strong> instead
          of an address. Your keys never leave your wallet or your Nostr extension.
        </p>
        {!step1Done && (
          <div className="need">
            <strong>{mode === "free" ? "All you need is a wallet:" : "Before you start, have these ready:"}</strong>
            <ul className="needlist">
              {mode === "domain" && (
                <li>
                  <strong>A domain</strong> you can add one small file to (we show you the file).
                </li>
              )}
              {mode === "domain" && (
                <li>
                  <strong>A Nostr key</strong>: a browser extension like nos2x or Alby, or we can make one for you.
                </li>
              )}
              <li>
                <strong>A BCH wallet</strong> (Paytaca, Cashonize or Selene) with a few cents on{" "}
                {network === "mainnet" ? "mainnet (real money)" : "chipnet (practice coins)"}. You'll use it at step 2.
              </li>
            </ul>
            {mode === "free" && (
              <p className="small">
                No domain and no extension needed. We give you a free name and make the key that goes with it.
              </p>
            )}
            <p className="small">
              Not ready? Switch to practice coins with the network button at the top, or{" "}
              <a
                href="/security"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/security?network=${network}`);
                }}
              >
                see how a name is proven first
              </a>
              .
            </p>
          </div>
        )}
      </section>

      <Journey
        label="Get paid by name"
        steps={stages.map(([label]) => label)}
        current={currentStage === -1 ? stages.length : currentStage}
        hint={
          published
            ? "Your name is live. Share the pay link below."
            : currentStep === 1
              ? mode === "free"
                ? "Pick a free name, make your key, and claim it. About a minute."
                : "Choose your name and connect your Nostr key, then put the file on your domain."
              : currentStep === 2
                ? "Connect the wallet that should receive the money."
                : "Send the small proof payment, then publish. This is what makes the name trustworthy."
        }
      />

      {/* Step 1 */}
      <section className={`card step ${currentStep === 1 ? "current" : ""} ${step1Done ? "finished" : ""}`}>
        <h2>
          <span className="step-no">1</span> Your name and key {step1Done && <span className="done">✓</span>}
        </h2>

        {!step1Done && (
          <div className="net" role="group" aria-label="Where your name lives" style={{ marginBottom: 12 }}>
            <button className={mode === "free" ? "on" : ""} aria-pressed={mode === "free"} onClick={() => setMode("free")}>
              Free name
            </button>
            <button className={mode === "domain" ? "on" : ""} aria-pressed={mode === "domain"} onClick={() => setMode("domain")}>
              My own domain
            </button>
          </div>
        )}

        {mode === "free" ? (
          <>
            <label>
              Pick your name
              <input
                value={localInput}
                onChange={(e) => setLocalInput(e.target.value)}
                placeholder="yourname"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={30}
              />
            </label>
            <p className="muted small">
              {localInput.trim() && checkLocalName(localInput).ok ? (
                <>
                  Your name will be <strong>{hostedHandle(localInput)}</strong>
                </>
              ) : (
                <>It will end in @{HOSTED_DOMAIN}. Use 3 to 24 lowercase letters, numbers, - or _.</>
              )}
            </p>
            {localInput.trim() && avail?.state === "available" && (
              <p className="note green">
                <strong>{hostedHandle(localInput)}</strong> is free.
              </p>
            )}
            {localInput.trim() && avail?.state === "yours" && <p className="note green">This name is already yours.</p>}
            {localInput.trim() && avail && "message" in avail && (
              <p className="warn">{avail.message}</p>
            )}
          </>
        ) : (
          <label>
            Your name
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="you@yourdomain.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        )}

        {!pubkey || wantedName !== progress.name ? (
          pubkey && wantedName !== progress.name ? (
            <button onClick={() => chooseKey(signerKind)} disabled={!parseHandle(wantedName) || !!busy || (wantedHosted && avail?.state === "invalid")}>
              Use this name
            </button>
          ) : (
            <div className="keychoice">
              <p className="label">Your name's key</p>
              <p className="muted small">
                A key is what proves a name is yours. We can make one in this browser, or you can use one you already have.
              </p>
              <div className="strip-actions">
                <button
                  onClick={() => chooseKey("browser")}
                  disabled={!parseHandle(wantedName) || !!busy || (wantedHosted && avail?.state === "invalid")}
                >
                  {busy === "key" ? "Working…" : hasBrowserKey() ? "Use the key saved in this browser" : "Make a key for me"}
                </button>
                {hasSigner() && (
                  <button
                    className="ghost"
                    onClick={() => chooseKey("extension")}
                    disabled={!parseHandle(wantedName) || !!busy || (wantedHosted && avail?.state === "invalid")}
                  >
                    Use my Nostr extension
                  </button>
                )}
              </div>
              <details className="how">
                <summary>I have a backed-up key</summary>
                <label>
                  Secret key (starts with nsec1)
                  <input
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="nsec1…"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    type="password"
                  />
                </label>
                {hasBrowserKey() && (
                  <label className="checkrow">
                    <input type="checkbox" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} />
                    <span>Replace the key already saved in this browser. I've backed it up.</span>
                  </label>
                )}
                <button className="ghost" onClick={restoreKey} disabled={!importText.trim() || !parseHandle(wantedName) || !!busy}>
                  Restore and use this key
                </button>
              </details>
            </div>
          )
        ) : (
          <>
            <p className="label">Your key {progress.signer === "browser" ? "(saved in this browser)" : "(Nostr extension)"}</p>
            <div className="copyrow">
              <code className="addr">{pubkey}</code>
              <CopyButton text={pubkey} />
            </div>
            {progress.signer === "browser" && (
              <details className="how" open={!step1Done}>
                <summary>Back up your key</summary>
                <p className="small">
                  This key is kept in this browser only. If you clear this site's data or switch devices, you lose control of
                  the name and it can't be recovered. Copy the secret key somewhere safe, like a password manager. Anyone who
                  has it can act as your name, so don't share it.
                </p>
                {backup ? (
                  <div className="copyrow">
                    <code className="addr">{backup}</code>
                    <CopyButton text={backup} />
                  </div>
                ) : (
                  <button className="ghost" onClick={() => setBackup(exportBrowserKey())}>
                    Show my secret key
                  </button>
                )}
              </details>
            )}
            {nameCheck.state === "checking" && <p className="muted">Checking {handle?.domain}…</p>}
            {nameCheck.state === "ok" && (
              <p className="note green">
                <strong>Found it.</strong> {handle?.domain} lists this key for {handle?.local}.
              </p>
            )}
            {mode === "free" && (nameCheck.state === "missing" || nameCheck.state === "other_key") && (
              <>
                {nameCheck.state === "missing" && avail?.state === "yours" && (
                  <p className="muted">
                    Claimed. It can take a few seconds to show up everywhere. Press Check again.
                  </p>
                )}
                {nameCheck.state === "missing" && avail?.state !== "yours" && (!avail || avail.state === "available") && (
                  <>
                    <p className="muted">Nobody has this name yet. Claiming it ties it to the key above.</p>
                    <button onClick={claim} disabled={!!busy || avail?.state !== "available"}>
                      {busy === "claim" ? "Claiming…" : `Claim ${handle?.full}`}
                    </button>
                  </>
                )}
                {nameCheck.state === "missing" && avail?.state === "taken" && (
                  <p className="warn">Someone else has {handle?.local}. Pick a different name above.</p>
                )}
                {nameCheck.state === "missing" && avail && (avail.state === "invalid" || avail.state === "unavailable") && (
                  <p className="warn">{avail.message}</p>
                )}
                {nameCheck.state === "other_key" && (
                  <>
                    <p className="warn">
                      {handle?.local} belongs to a different key than the one above. If it's your name, use the key you made it
                      with; if not, pick another name above.
                    </p>
                    <button className="ghost" onClick={() => setProgress({ ...progress, pubkey: undefined })} disabled={!!busy}>
                      Use a different key
                    </button>
                  </>
                )}
              </>
            )}
            {mode === "domain" && (nameCheck.state === "missing" || nameCheck.state === "other_key") && (
              <>
                <p className="warn">
                  {nameCheck.state === "missing"
                    ? `${handle?.domain} doesn't list ${handle?.local} yet.`
                    : `${handle?.domain} lists a different key for ${handle?.local} (${short(nameCheck.listed)}). Replace it with the key above.`}{" "}
                  Put this file on your domain, then check again. This is how the domain vouches that the name is yours.
                </p>
                <p className="label">Host this file at</p>
                <div className="copyrow">
                  <code className="addr">{`https://${handle?.domain}/.well-known/nostr.json`}</code>
                  <CopyButton text={`https://${handle?.domain}/.well-known/nostr.json`} />
                </div>
                <p className="label">With exactly this inside</p>
                <div className="copyrow">
                  <pre className="addr">{nostrFile}</pre>
                  <CopyButton text={nostrFile} />
                </div>
                <p className="muted small">
                  File already there? Add just this line inside "names": <code>{nostrLine}</code>
                </p>
                <p className="muted small">
                  Serve it as JSON, with no redirects, and with the header Access-Control-Allow-Origin: *.
                </p>
                <details className="how">
                  <summary>No domain? Host it free on GitHub Pages</summary>
                  <ol className="small">
                    <li>
                      Make a free GitHub account. Create a <strong>public</strong> repository named{" "}
                      <code>your-username.github.io</code>.
                    </li>
                    <li>
                      In it, choose <strong>Add file → Create new file</strong>. For the file name type{" "}
                      <code>.well-known/nostr.json</code> (typing the slash makes the folder) and paste the JSON above.
                      Commit.
                    </li>
                    <li>
                      Add a second, empty file named <code>.nojekyll</code> and commit it. Without it GitHub hides folders
                      that start with a dot.
                    </li>
                    <li>
                      In Settings → Pages, set the source to your main branch. Wait a minute, then open{" "}
                      <code>https://your-username.github.io/.well-known/nostr.json</code> to see the file.
                    </li>
                    <li>
                      Change your name above to <code>{handle?.local ?? "you"}@your-username.github.io</code> and check
                      again. GitHub already sends the Access-Control-Allow-Origin header for you.
                    </li>
                  </ol>
                  <p className="muted small">
                    The name is still yours to control, but GitHub is the one hosting it, so a payer is trusting your
                    GitHub account for the name.
                  </p>
                </details>
                {diagnosis && diagnosis.problem !== "ok" && (
                  <p className="warn">
                    <strong>What we found:</strong> {diagnosis.message}
                  </p>
                )}
              </>
            )}
            {nameCheck.state === "error" && (
              <>
                <p className="err">{diagnosis && diagnosis.problem !== "ok" ? diagnosis.message : nameCheck.message}</p>
                {!diagnosis && <p className="muted small">Working out what went wrong…</p>}
              </>
            )}
            {nameCheck.state !== "ok" && nameCheck.state !== "checking" && (
              <button className="ghost" onClick={() => setLookups((n) => n + 1)}>
                Check again
              </button>
            )}
          </>
        )}
        {error && currentStep === 1 && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </section>

      {/* Step 2 */}
      <section
        className={`card step ${step1Done ? "" : "locked"} ${currentStep === 2 ? "current" : ""} ${step2Done ? "finished" : ""}`}
        aria-disabled={!step1Done}
      >
        <h2>
          <span className="step-no">2</span> The wallet you'll be paid in {step2Done && <span className="done">✓</span>}
        </h2>
        {!step1Done ? (
          <p className="muted">Finish step 1 first.</p>
        ) : !connected && !restoring ? (
          <>
            <button onClick={connect}>
              {wc.state === "connecting" || wc.state === "reconnecting" ? "Show QR" : "Connect wallet"}
            </button>
            <p className="need">
              <b>Use a wallet that works with WizardConnect:</b> Cashonize, Paytaca or Selene. Scan the code with it, and set
              it to {network === "mainnet" ? "mainnet (real money)" : "chipnet (practice coins)"}. Your wallet only signs; it
              never hands over its keys.
            </p>
          </>
        ) : (
          <>
            <p className="wallet-chip">
              <strong>{wc.walletName ?? "Your wallet"}</strong>
              {restoring && <span className="muted"> · reconnecting…</span>}{" "}
              <button className="link" onClick={() => wc.disconnect()} disabled={!!busy}>
                Disconnect
              </button>
            </p>
            {!bindAddress ? (
              <p className="muted">Waiting for your wallet to share its keys…</p>
            ) : (
              <>
                <p className="label">You'll be paid at</p>
                <code className="addr">{bindAddress}</code>
                {!proofHere && (
                  <p className={atAddress >= PROOF_MIN_SATS ? "muted" : "warn"}>
                    {formatBch(atAddress)} {network === "chipnet" ? "tBCH" : "BCH"} at this address.{" "}
                    {atAddress >= PROOF_MIN_SATS
                      ? "Enough for the proof."
                      : `Send at least ${PROOF_MIN_SATS.toLocaleString()} sats to exactly this address, then press Refresh. Coins at your wallet's other addresses don't count.`}
                  </p>
                )}
                {!proofHere && atAddress < PROOF_MIN_SATS && (
                  <button className="ghost" onClick={refresh}>
                    Refresh
                  </button>
                )}
              </>
            )}
          </>
        )}
      </section>

      {/* Step 3 */}
      <section
        className={`card step ${step2Done ? "" : "locked"} ${currentStep === 3 ? "current" : ""} ${published ? "finished" : ""}`}
        aria-disabled={!step2Done}
      >
        <h2>
          <span className="step-no">3</span> Prove it and publish {published && <span className="done">✓</span>}
        </h2>
        {!step2Done ? (
          <p className="muted">Finish step 2 first.</p>
        ) : !proofHere ? (
          <>
            <p className="muted">
              Your wallet sends a tiny transaction from this address back to itself, carrying your Nostr key. Only
              someone who controls the address can make it, which is what makes your name Verified.
            </p>
            <p className="muted small">
              Network fee: {proofFee !== null ? `${proofFee.toString()} sats` : "a few hundred sats"}. The rest comes
              straight back to the same address.
            </p>
            <button onClick={sendProof} disabled={!connected || !!busy}>
              {busy === "proof" ? "Approve in your wallet…" : "Send proof"}
            </button>
            {restoring && <p className="muted small">Open {wc.walletName ?? "your wallet"} so it can answer.</p>}
          </>
        ) : (
          <>
            <p>
              Proof sent:{" "}
              <a href={explorerTx(network, proofHere.txid)} target="_blank" rel="noreferrer">
                {short(proofHere.txid)}
              </a>{" "}
              <span className="muted">
                {confirmations && confirmations > 0
                  ? "· confirmed"
                  : "· waiting for 1 confirmation, about 10 minutes. You can leave this page; your progress is saved."}
              </span>
            </p>
            {!published ? (
              <>
                <p className="muted small">
                  Publishing signs two short records with your Nostr extension: which address is yours, and where to pay
                  you. You can publish now; your name shows Verified once the proof is confirmed.
                </p>
                <button onClick={publish} disabled={!!busy}>
                  {busy === "publish" ? "Approve twice in your Nostr extension…" : "Sign and publish"}
                </button>
              </>
            ) : (
              <p className="muted">Published.</p>
            )}
          </>
        )}
      </section>

      {error && currentStep !== 1 && <p className="err">{error}</p>}

      <details className="card how">
        <summary>Why is each step needed?</summary>
        <p className="muted">
          A name is only trusted when two proofs point at each other. <strong>Step 1</strong> makes your domain vouch for
          your Nostr key. <strong>Step 2</strong> picks the address people will pay. <strong>Step 3</strong> sends a tiny
          payment from that address with your key in its note, which only the address's owner can do, and then publishes
          the signed claim. Anyone can name an address; only its owner can spend from it.
        </p>
      </details>

      {published && handle && (
        <>
          <h3 className="section">How payers see your name</h3>
          <VerifyCard handle={handle.full} network={network} resolution={resolution} onRetry={() => setLookups((n) => n + 1)} />

          <section className="card">
            <h2>Your pay link</h2>
            <code className="addr">{payLink}</code>
            <div className="strip-actions">
              <button onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
              <button className="ghost" onClick={() => setLookups((n) => n + 1)}>
                Check again
              </button>
            </div>
            <p className="muted small">Add ?amount=5 to ask for $5, or &memo=Invoice 7 for a note.</p>
          </section>

          <section className="card">
            <h2>What next?</h2>
            <p className="muted small">
              Share the link above to be paid. You can also use the same name to log in to sites with no password.
            </p>
            <div className="strip-actions">
              <button className="ghost" onClick={() => navigate("/auth")}>
                Sign in with your name
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Change or remove</h2>
            <p className="muted small">
              To be paid at a different address, connect that wallet and repeat steps 2 and 3. Removing your name stops
              HandlePay from showing an address for it until you publish again.
            </p>
            {!confirmRevoke ? (
              <button className="ghost" onClick={() => setConfirmRevoke(true)} disabled={!!busy}>
                Remove my name
              </button>
            ) : (
              <>
                <p className="warn">People won't be able to pay {handle.full} until you publish again. Remove it?</p>
                <div className="strip-actions">
                  <button onClick={revoke} disabled={!!busy}>
                    {busy === "revoke" ? "Approve in your Nostr extension…" : "Yes, remove it"}
                  </button>
                  <button className="ghost" onClick={() => setConfirmRevoke(false)} disabled={!!busy}>
                    Keep it
                  </button>
                </div>
              </>
            )}
            {isHostedHandle(handle.full) && (
              <>
                <hr />
                <p className="muted small">
                  Your name is a free HandlePay name. If you don't want it any more, give it back so someone else can use it.
                  Payments to it stop working.
                </p>
                {!confirmRelease ? (
                  <button className="ghost" onClick={() => setConfirmRelease(true)} disabled={!!busy}>
                    Give up this name
                  </button>
                ) : (
                  <>
                    <p className="warn">{handle.full} will be free for anyone to claim. Give it up?</p>
                    <div className="strip-actions">
                      <button onClick={release} disabled={!!busy}>
                        {busy === "release" ? "Giving it up…" : "Yes, give it up"}
                      </button>
                      <button className="ghost" onClick={() => setConfirmRelease(false)} disabled={!!busy}>
                        Keep it
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
