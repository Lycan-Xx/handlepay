/**
 * /identity: set up a name to be paid at, one step at a time, then manage it.
 *
 *   Name     a free name on HandlePay's domain, or one on your own domain.
 *   Key      make a key in this browser, use a Nostr extension, or restore a backup.
 *   Backup   browser keys only: reveal, copy or download it, then tick "I have
 *            backed up". Claim (or the domain file) stays disabled until then.
 *            Extension users skip it: the extension holds the key.
 *   Wallet   the shared wallet; its first receive address is the one bound.
 *   Proof    a transaction from that address to itself carrying the Nostr key.
 *   Publish  the signed binding on relays.
 *   Done     the name as payers see it, the pay link, and Manage.
 *
 * Only the step in progress is shown. Each step's "done" is read from the same
 * values as before (name check, coins at the address, proof, publish), so the
 * flow and its order of effects are unchanged; the page just shows it in
 * smaller pieces.
 *
 * Progress is kept in localStorage per network (it's all public data: name,
 * key, address, txid), so a reload or a long wait for a confirmation doesn't
 * lose anything. A name is the same on both networks, so a network with no
 * progress yet starts from the other network's name and key; its binding is
 * its own.
 */
import { useEffect, useMemo, useState } from "react";
import { decodeTransaction, hexToBin } from "@bitauth/libauth";
import { CopyButton } from "../components/CopyButton";
import { FundAddress } from "../components/FundAddress";
import { Journey } from "../components/Journey";
import { KeyBackup } from "../components/KeyBackup";
import { RestoreKey } from "../components/RestoreKey";
import { VerifyCard } from "../components/VerifyCard";
import { useNetworkLock } from "../hooks/useNetworkLock";
import type { Wallet } from "../hooks/useWallet";
import { buildBindingEvent, buildPaytoEvent, buildRevokeEvent, proofOpReturnChunks } from "../lib/binding";
import { HOSTED_DOMAIN, hostedHandle, isHostedHandle, lookupName, claimName, releaseName, HostedError, type Availability } from "../lib/hosted";
import { checkLocalName } from "../lib/hostedRules";
import { NETWORK_LABEL, walletMustBeOn } from "../lib/labels";
import { explorerTx, getTransaction, type BchNetwork } from "../lib/network";
import { DEFAULT_RELAYS, fetchNip05, hasSigner, parseHandle, publishEvent } from "../lib/nostr";
import { browserKeyPubkey, createBrowserKey, hasBrowserKey, signerFor, type SignerKind } from "../lib/signer";
import { diagnoseNip05, type Nip05Diagnosis } from "../lib/nip05diagnose";
import { paymentErrorMessage } from "../lib/paylink";
import { liveDeps, resolveHandle, type Resolution } from "../lib/resolve";
import { navigate, payPath } from "../lib/router";
import { buildSignRequest, formatBch, selectCoins, sendBch } from "../lib/wallet";

/** Enough for the proof's fee with room to spare; the coin comes back as change. */
const PROOF_MIN_SATS = 2_000n;

/** Official pages for the two common Nostr extensions. Linked only: never bundled or installed by HandlePay. */
const EXTENSIONS = [
  { name: "nos2x", url: "https://github.com/fiatjaf/nos2x" },
  { name: "Alby", url: "https://getalby.com" },
];

interface Progress {
  name: string;
  pubkey?: string;
  /** Which signer holds `pubkey`: a Nostr extension or the key kept in this browser. Older saves have none, meaning extension. */
  signer?: SignerKind;
  /** A browser key the person has said they backed up (or restored from a backup). */
  backedUp?: boolean;
  proof?: { address: string; pubkey: string; txid: string };
  /** Set once the binding for `proof` is on relays. */
  publishedTxid?: string;
}

const storageKey = (network: BchNetwork) => `handlepay-identity-${network}`;

function read(network: BchNetwork): Progress | null {
  try {
    const p = JSON.parse(localStorage.getItem(storageKey(network)) ?? "null");
    if (p && typeof p.name === "string") return p;
  } catch {
    /* fall through */
  }
  return null;
}

function load(network: BchNetwork): Progress {
  const here = read(network);
  if (here) return here;
  // Names don't belong to a network, bindings do: carry the name and key over, never the proof.
  const other = read(network === "mainnet" ? "chipnet" : "mainnet");
  if (other?.name) return { name: other.name, pubkey: other.pubkey, signer: other.signer, backedUp: other.backedUp };
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

type Stage = "name" | "key" | "backup" | "wallet" | "proof" | "publish" | "done";

const STEP_LABEL: Record<Stage, string> = {
  name: "Name",
  key: "Key",
  backup: "Backup",
  wallet: "Wallet",
  proof: "Proof",
  publish: "Publish",
  done: "Done",
};

const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`;

/** Worded for the Nostr and name steps; paymentErrorMessage's "Payment cancelled in your wallet" would be wrong here. */
function nostrErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (!(e instanceof HostedError) && /reject|denied|declin|cancel/i.test(message)) return "Cancelled in your Nostr extension. Nothing changed.";
  return message;
}

export function IdentityPage({ wallet, network }: { wallet: Wallet; network: BchNetwork }) {
  const { wc, connected, restoring, connect, switchWallet, receiveAddress, coins, refresh } = wallet;
  const [progress, setProgressState] = useState<Progress>(() => load(network));
  const [nameInput, setNameInput] = useState(progress.name);
  const [nameCheck, setNameCheck] = useState<NameCheck>({ state: "idle" });
  const [confirmations, setConfirmations] = useState<number | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [lookups, setLookups] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  // "free": a name on HandlePay's domain. "domain": the person's own. A name set up before decides which one to show.
  const [mode, setMode] = useState<"free" | "domain">(!progress.name || isHostedHandle(progress.name) ? "free" : "domain");
  const [localInput, setLocalInput] = useState(isHostedHandle(progress.name) ? progress.name.split("@")[0] : "");
  const [avail, setAvail] = useState<Availability | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [editingName, setEditingName] = useState(false);
  /** Manage → Change address: walk the wallet, proof and publish steps again for a new address. */
  const [changing, setChanging] = useState(false);
  const [showExport, setShowExport] = useState(false);
  // Nostr extensions inject window.nostr late, so the Key step looks again a moment after it opens.
  const [extension, setExtension] = useState(hasSigner);

  const setProgress = (next: Progress) => {
    setProgressState(next);
    save(network, next);
  };

  const handle = parseHandle(progress.name);
  const { pubkey, proof } = progress;

  // Does the name's domain list this key?
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
  const signerKind: SignerKind = progress.signer ?? "extension";
  // A key restored before the name is typed (new device) makes the name show "already yours".
  const lookupKey = pubkey ?? browserKeyPubkey() ?? undefined;

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
      lookupName(checked.name, lookupKey).then((r) => !cancelled && setAvail(r));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, localInput, lookupKey, nameCheck.state]);

  const step1Done = nameCheck.state === "ok";
  const bindAddress = receiveAddress;
  const proofHere = proof && proof.address === bindAddress && proof.pubkey === pubkey ? proof : undefined;
  const atAddress = bindAddress ? coins.filter((c) => c.owner.address === bindAddress).reduce((s, c) => s + c.satoshis, 0n) : 0n;
  const step2Done = step1Done && !!bindAddress && (!!proofHere || atAddress >= PROOF_MIN_SATS);
  const published = !!proofHere && progress.publishedTxid === proofHere.txid;
  /** The binding this browser published for this key, whichever wallet is connected now. */
  const live = proof && proof.pubkey === pubkey && progress.publishedTxid === proof.txid ? proof : undefined;

  const needsBackup = signerKind === "browser";
  const nameSet = !!handle && !editingName;
  const stage: Stage = !nameSet
    ? "name"
    : !pubkey
      ? "key"
      : !step1Done
        ? needsBackup
          ? "backup"
          : "key"
        : live && !changing
          ? "done"
          : !bindAddress || (changing && bindAddress === live?.address) || !step2Done
            ? "wallet"
            : !proofHere
              ? "proof"
              : !published
                ? "publish"
                : "done";

  // A proof sent on this network must be published on it, so the network stays put from sending it until publishing.
  useNetworkLock(busy === "proof" || busy === "publish" || stage === "publish");

  useEffect(() => {
    if (stage !== "key") return;
    const timer = setTimeout(() => setExtension(hasSigner()), 1_000);
    return () => clearTimeout(timer);
  }, [stage]);

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
  const watched = proofHere ?? live;
  useEffect(() => {
    if (!watched) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const tx = await getTransaction(network, watched.txid);
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
  }, [watched?.txid, network]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once published, show the name the way a payer sees it.
  useEffect(() => {
    if (!live || !handle) return;
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
  }, [live?.txid, progress.name, network, confirmations === 0 ? 0 : 1, lookups]);

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

  /** Name step: keep the name. A new name needs a new binding, so the old "published" mark is dropped. */
  const continueName = () => {
    const changed = wantedName !== progress.name;
    setProgress({ ...progress, name: wantedName, ...(changed ? { publishedTxid: undefined } : {}) });
    setEditingName(false);
    setError(null);
  };

  /** Key step: make or reuse the browser key, or ask the extension. A browser key starts not backed up. */
  const chooseKey = (kind: SignerKind) =>
    run(
      "key",
      async () => {
        if (kind === "browser" && !hasBrowserKey()) createBrowserKey();
        const key = await signerFor(kind).pubkey();
        setProgress({ ...progress, pubkey: key, signer: kind, backedUp: kind === "browser" ? false : undefined });
      },
      "nostr",
    );

  /** A key restored from a backup is, by definition, backed up. */
  const restored = (key: string) => setProgress({ ...progress, pubkey: key, signer: "browser", backedUp: true });

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
        setProgress({ name: "", pubkey, signer: progress.signer, backedUp: progress.backedUp });
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
      setChanging(false);
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

  const payHref = handle ? payPath(handle.full, { network }) : "";
  const payLink = handle ? `${window.location.origin}${payHref}` : "";
  const nostrLine = handle && pubkey ? `"${handle.local}": "${pubkey}"` : "";
  const nostrFile = handle && pubkey ? JSON.stringify({ names: { [handle.local]: pubkey } }, null, 2) : "";
  const net = NETWORK_LABEL[network];

  // Extension users never see Backup: the extension holds the key.
  const steps: Stage[] = needsBackup || stage === "name"
    ? ["name", "key", "backup", "wallet", "proof", "publish", "done"]
    : ["name", "key", "wallet", "proof", "publish", "done"];
  const HINT: Record<Stage, string> = {
    name: "Pick the name people will pay. Next you'll choose the key that proves it's yours.",
    key: "The key proves the name is yours. It never holds money. Next: back it up, then claim the name.",
    backup: "Save your key somewhere safe. Next: connect the wallet you want to be paid in.",
    wallet: "Choose the wallet that receives the money. Next: a tiny proof payment from it.",
    proof: "A small payment from your address proves it's yours. Next: publish.",
    publish: "Sign the record that links your name to your address. Then you're done.",
    done: "Your name is set up. Share your pay link.",
  };

  const errorLine = error && (
    <p className="err" role="alert">
      {error}
    </p>
  );

  const keyLine = pubkey && (
    <p className="muted small">
      Key: <code>{short(pubkey)}</code> · {signerKind === "browser" ? "kept in this browser" : "held by your Nostr extension"}
    </p>
  );

  const nameLine = handle && stage !== "name" && stage !== "done" && (
    <p className="current-name">
      <span className="muted small">Your name</span>
      <strong>{handle.full}</strong>
      {(stage === "key" || stage === "backup") && (
        <button className="link small" onClick={() => setEditingName(true)} disabled={!!busy}>
          Change
        </button>
      )}
    </p>
  );

  /** After the key: claim a free name, or put the file on your own domain. Waits for the backup tick. */
  const gated = needsBackup && !progress.backedUp;
  const register = handle && pubkey && (
    <div className="subpanel">
      <p className="label">{mode === "free" ? "Claim your name" : "Put your name on your domain"}</p>
      {nameCheck.state === "checking" && <p className="muted">Checking {handle.domain}…</p>}
      {mode === "free" && (nameCheck.state === "missing" || nameCheck.state === "other_key") && (
        <>
          {nameCheck.state === "missing" && avail?.state === "yours" && (
            <p className="muted">Claimed. It can take a few seconds to show up everywhere. Press Check again.</p>
          )}
          {nameCheck.state === "missing" && avail?.state !== "yours" && (!avail || avail.state === "available") && (
            <>
              <p className="muted">Nobody has this name yet. Claiming it ties it to your key.</p>
              <button onClick={claim} disabled={!!busy || gated || avail?.state !== "available"}>
                {busy === "claim" ? "Claiming…" : `Claim ${handle.full}`}
              </button>
              {gated && <p className="muted small">Tick "I have backed up my identity key" above to claim.</p>}
            </>
          )}
          {nameCheck.state === "missing" && avail?.state === "taken" && (
            <p className="warn">
              Someone else has {handle.local}. If it's yours, restore the key you claimed it with; if not, change the name.
            </p>
          )}
          {nameCheck.state === "missing" && avail && (avail.state === "invalid" || avail.state === "unavailable") && (
            <p className="warn">{avail.message}</p>
          )}
          {nameCheck.state === "other_key" && (
            <>
              <p className="warn">
                {handle.local} belongs to a different key. If it's your name, use the key you made it with; if not, change
                the name.
              </p>
              <button className="ghost" onClick={() => setProgress({ ...progress, pubkey: undefined })} disabled={!!busy}>
                Use a different key
              </button>
            </>
          )}
        </>
      )}
      {mode === "domain" && (nameCheck.state === "missing" || nameCheck.state === "other_key") && (
        <fieldset className="plain" disabled={gated}>
          <p className="warn">
            {nameCheck.state === "missing"
              ? `${handle.domain} doesn't list ${handle.local} yet.`
              : `${handle.domain} lists a different key for ${handle.local} (${short(nameCheck.listed)}). Replace it with yours.`}{" "}
            Put this file on your domain, then check again. This is how the domain vouches that the name is yours.
          </p>
          {gated ? (
            <p className="muted small">Tick "I have backed up my identity key" above to see the file.</p>
          ) : (
            <>
              <p className="label">Host this file at</p>
              <div className="copyrow">
                <code className="addr">{`https://${handle.domain}/.well-known/nostr.json`}</code>
                <CopyButton text={`https://${handle.domain}/.well-known/nostr.json`} />
              </div>
              <p className="label">With exactly this inside</p>
              <div className="copyrow">
                <pre className="addr">{nostrFile}</pre>
                <CopyButton text={nostrFile} />
              </div>
              <p className="muted small">
                File already there? Add just this line inside "names": <code>{nostrLine}</code>
              </p>
              <p className="muted small">Serve it as JSON, with no redirects, and with the header Access-Control-Allow-Origin: *.</p>
              <details className="how">
                <summary>No domain? Host it free on GitHub Pages</summary>
                <ol className="small">
                  <li>
                    Make a free GitHub account. Create a <strong>public</strong> repository named{" "}
                    <code>your-username.github.io</code>.
                  </li>
                  <li>
                    In it, choose <strong>Add file → Create new file</strong>. For the file name type{" "}
                    <code>.well-known/nostr.json</code> (typing the slash makes the folder) and paste the JSON above. Commit.
                  </li>
                  <li>
                    Add a second, empty file named <code>.nojekyll</code> and commit it. Without it GitHub hides folders that
                    start with a dot.
                  </li>
                  <li>
                    In Settings → Pages, set the source to your main branch. Wait a minute, then open{" "}
                    <code>https://your-username.github.io/.well-known/nostr.json</code> to see the file.
                  </li>
                  <li>
                    Change your name to <code>{handle.local}@your-username.github.io</code> and check again. GitHub already
                    sends the Access-Control-Allow-Origin header for you.
                  </li>
                </ol>
                <p className="muted small">
                  The name is still yours to control, but GitHub is the one hosting it, so a payer is trusting your GitHub
                  account for the name.
                </p>
              </details>
              {diagnosis && diagnosis.problem !== "ok" && (
                <p className="warn">
                  <strong>What we found:</strong> {diagnosis.message}
                </p>
              )}
            </>
          )}
        </fieldset>
      )}
      {nameCheck.state === "error" && (
        <>
          <p className="err">{diagnosis && diagnosis.problem !== "ok" ? diagnosis.message : nameCheck.message}</p>
          {!diagnosis && <p className="muted small">Working out what went wrong…</p>}
        </>
      )}
      {nameCheck.state !== "ok" && nameCheck.state !== "checking" && (
        <p>
          <button className="ghost" onClick={() => setLookups((n) => n + 1)}>
            Check again
          </button>
        </p>
      )}
    </div>
  );

  const nameReady = !!parseHandle(wantedName) && (mode === "domain" || avail?.state === "available" || avail?.state === "yours");

  return (
    <>
      <h2 className="page-title">{stage === "done" ? "Your payment name" : "Get your payment name"}</h2>
      <p className="page-lead">
        People pay your name instead of a long address. Your coins stay in your wallet, and your name's key stays on this
        device.
      </p>

      <Journey
        label="Get paid"
        steps={steps.map((s) => STEP_LABEL[s])}
        current={steps.indexOf(stage)}
        hint={HINT[stage]}
      />

      {stage === "name" && (
        <section className="card step">
          <h2>Choose your name</h2>
          <div className="net" role="group" aria-label="Where your name lives">
            <button className={mode === "free" ? "on" : ""} aria-pressed={mode === "free"} onClick={() => setMode("free")}>
              Free name
            </button>
            <button className={mode === "domain" ? "on" : ""} aria-pressed={mode === "domain"} onClick={() => setMode("domain")}>
              My own domain
            </button>
          </div>

          {mode === "free" ? (
            <>
              <label className="spaced">
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
              <p className="full-name">
                {localInput.trim() && checkLocalName(localInput).ok ? (
                  <>
                    Your full name: <strong>{hostedHandle(localInput)}</strong>
                  </>
                ) : (
                  <span className="muted small">
                    It will end in @{HOSTED_DOMAIN}. Use 3 to 24 lowercase letters, numbers, - or _.
                  </span>
                )}
              </p>
              {localInput.trim() && avail?.state === "available" && (
                <p className="note green">
                  <strong>{hostedHandle(localInput)}</strong> is free.
                </p>
              )}
              {localInput.trim() && avail?.state === "yours" && <p className="note green">This name is already yours.</p>}
              {localInput.trim() && avail && "message" in avail && <p className="warn">{avail.message}</p>}
            </>
          ) : (
            <>
              <label className="spaced">
                Your full name
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="you@yourdomain.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <p className="muted small">
                You'll need to add one small file to that domain (we show you the file). Payers see the domain, so it's part
                of what they trust.
              </p>
            </>
          )}

          <div className="strip-actions">
            <button onClick={continueName} disabled={!nameReady || !!busy}>
              Continue
            </button>
            {editingName && (
              <button className="ghost" onClick={() => setEditingName(false)}>
                Keep {progress.name}
              </button>
            )}
          </div>

          <details className="how">
            <summary>Setting up on a new device? Restore your key first</summary>
            <p className="muted small">
              Restore the key you claimed your name with, then type the name above: it will show as already yours.
            </p>
            {pubkey && signerKind === "browser" ? (
              <p className="note green small">This browser has your key. Now type your name above.</p>
            ) : (
              <RestoreKey onRestored={restored} />
            )}
          </details>
        </section>
      )}

      {stage === "key" && (
        <section className="card step">
          <h2>Your name's key</h2>
          {nameLine}
          {!pubkey ? (
            <>
              <p className="muted">
                A key proves this name is yours. It signs your name's records; it never holds or moves money.
              </p>
              {extension ? (
                <p className="note green small">
                  <strong>Nostr extension found.</strong> We recommend using it: the extension keeps the key, so there's
                  nothing to back up here.
                </p>
              ) : (
                <p className="note small">
                  No Nostr extension found in this browser, so we'll make a key for you. If you'd rather use one, get{" "}
                  {EXTENSIONS.map((x, i) => (
                    <span key={x.name}>
                      {i > 0 && " or "}
                      <a href={x.url} target="_blank" rel="noreferrer">
                        {x.name}
                      </a>
                    </span>
                  ))}{" "}
                  from its official page and reload. On a phone, a key in this browser plus a backup is the usual choice.
                </p>
              )}
              <div className="keychoices">
                {extension && (
                  <button onClick={() => chooseKey("extension")} disabled={!!busy}>
                    Use my Nostr extension
                  </button>
                )}
                <button className={extension ? "ghost" : ""} onClick={() => chooseKey("browser")} disabled={!!busy}>
                  {busy === "key" ? "Working…" : hasBrowserKey() ? "Use the key saved in this browser" : "Make a key for me"}
                </button>
              </div>
              <p className="muted small">
                <strong>Key in this browser:</strong> made and kept on this device only; you'll back it up next.{" "}
                <strong>Extension:</strong> the extension holds the key and signs for you.
              </p>
              <details className="how">
                <summary>I have a backed-up key</summary>
                <RestoreKey onRestored={restored} disabled={!!busy} />
              </details>
            </>
          ) : (
            <>
              {keyLine}
              {register}
            </>
          )}
          {errorLine}
        </section>
      )}

      {stage === "backup" && (
        <section className="card step">
          <h2>Back up your key</h2>
          {nameLine}
          <p className="muted">
            This key is kept in this browser only. Clear this site's data or lose the device, and without a backup you can't
            manage this name. Keep it somewhere private, like a password manager. Anyone with it can act as your name.
          </p>
          {handle && <KeyBackup name={handle.full} />}
          <label className="checkrow tick-required">
            <input
              type="checkbox"
              checked={!!progress.backedUp}
              onChange={(e) => setProgress({ ...progress, backedUp: e.target.checked })}
            />
            <span>
              I have backed up my identity key. I understand that losing it without a backup means I can't manage this name.
              My money stays in my wallet either way.
            </span>
          </label>
          {register}
          {errorLine}
        </section>
      )}

      {stage === "wallet" && (
        <section className="card step">
          <h2>{changing ? "Change the address" : "The wallet you'll be paid in"}</h2>
          {nameLine}
          <p className="muted">{walletMustBeOn(network)}</p>
          {!connected && !restoring ? (
            <>
              <button onClick={connect}>
                {wc.state === "connecting" || wc.state === "reconnecting" ? "Show QR" : "Connect wallet"}
              </button>
              <p className="need">
                <b>Use a wallet that works with WizardConnect:</b> Cashonize, Paytaca or Selene. Scan the code with it. Your
                wallet only signs; it never hands over its keys. Connecting a wallet doesn't prove you own a name: the proof
                step does.
              </p>
            </>
          ) : !bindAddress ? (
            <p className="muted">Waiting for your wallet to share its address…</p>
          ) : changing && bindAddress === live?.address ? (
            <>
              <p className="label">Your name already points to</p>
              <code className="addr">{bindAddress}</code>
              <p className="muted">Connect a different wallet to point your name somewhere else.</p>
              <div className="strip-actions">
                <button onClick={switchWallet}>Use a different wallet</button>
              </div>
            </>
          ) : (
            <>
              <p className="label">Your name will point to this address</p>
              {atAddress < PROOF_MIN_SATS ? (
                <FundAddress address={bindAddress} network={network} minSats={PROOF_MIN_SATS} />
              ) : (
                <code className="addr">{bindAddress}</code>
              )}
              <p className={atAddress >= PROOF_MIN_SATS ? "muted" : "warn"}>
                {formatBch(atAddress)} {network === "chipnet" ? "tBCH" : "BCH"} at this address.{" "}
                {atAddress >= PROOF_MIN_SATS
                  ? "Enough for the proof."
                  : `The proof needs at least ${PROOF_MIN_SATS.toLocaleString()} sats at exactly this address. Coins at your wallet's other addresses don't count. Send some, then press Refresh.`}
              </p>
              <div className="strip-actions">
                <button className="ghost" onClick={refresh}>
                  Refresh
                </button>
                <button className="ghost" onClick={switchWallet}>
                  Use a different wallet
                </button>
              </div>
            </>
          )}
          {changing && (
            <p>
              <button className="link" onClick={() => setChanging(false)}>
                Cancel, keep the current address
              </button>
            </p>
          )}
          {errorLine}
        </section>
      )}

      {stage === "proof" && bindAddress && (
        <section className="card step">
          <h2>Prove the address is yours</h2>
          {nameLine}
          <p>
            Your wallet sends a small payment <strong>from this address</strong> back to itself, with your name's key written
            in it. Only the owner of the address can make it, so it's what lets payers see your name as Verified.
          </p>
          <p className="label">From and back to</p>
          <code className="addr">{bindAddress}</code>
          <dl className="facts">
            <dt>Network</dt>
            <dd>
              {net.name} · {net.detail}
            </dd>
            <dt>Network fee</dt>
            <dd>{proofFee !== null ? `${proofFee.toString()} sats` : "a few hundred sats"}; the rest comes straight back</dd>
          </dl>
          <p className="muted small">{walletMustBeOn(network)}</p>
          <div className="strip-actions">
            <button onClick={sendProof} disabled={!connected || !!busy}>
              {busy === "proof" ? "Approve in your wallet…" : "Send proof"}
            </button>
            <button className="ghost" onClick={switchWallet} disabled={!!busy}>
              Use a different wallet
            </button>
          </div>
          {restoring && <p className="muted small">Open {wc.walletName ?? "your wallet"} so it can answer.</p>}
          {errorLine}
        </section>
      )}

      {stage === "publish" && proofHere && (
        <section className="card step">
          <h2>Publish</h2>
          {nameLine}
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
          <p className="muted">
            Publishing signs two short records with your {signerKind === "browser" ? "key" : "Nostr extension"}: which address
            is yours, and where to pay you. You can publish now; your name shows Verified once the proof is confirmed.
          </p>
          <button onClick={publish} disabled={!!busy}>
            {busy === "publish"
              ? signerKind === "browser"
                ? "Publishing…"
                : "Approve twice in your Nostr extension…"
              : "Sign and publish"}
          </button>
          {errorLine}
        </section>
      )}

      {stage === "done" && handle && live && (
        <>
          <VerifyCard handle={handle.full} network={network} resolution={resolution} onRetry={() => setLookups((n) => n + 1)} />

          <section className="card">
            <h2>Your pay link</h2>
            <p className="muted small">
              Bound on {net.name} · {net.detail}
            </p>
            <div className="copyrow">
              <code className="addr">{payLink}</code>
              <CopyButton text={payLink} label="Copy link" />
            </div>
            <p className="muted small">Add ?amount=5 to ask for $5, or &amp;memo=Invoice 7 for a note.</p>
            <div className="strip-actions">
              <a
                className="button"
                href={payHref}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(payHref);
                }}
              >
                Open my pay link
              </a>
              <button className="ghost" onClick={() => setLookups((n) => n + 1)}>
                Check again
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Manage</h2>
            <dl className="facts">
              <dt>Name</dt>
              <dd>{handle.full}</dd>
              <dt>Address</dt>
              <dd>
                <code>{live.address}</code>
              </dd>
              <dt>Network</dt>
              <dd>
                {net.name} · {net.detail}
              </dd>
              <dt>Key</dt>
              <dd>{signerKind === "browser" ? "Kept in this browser" : "Held by your Nostr extension"}</dd>
            </dl>
            <p className="note small">
              Your name is the same on every network, but each network has its own binding. It can be Verified on Mainnet and
              Claimed on Chipnet. Switching the network never moves your name.
            </p>

            <div className="strip-actions">
              <button className="ghost" onClick={() => setChanging(true)} disabled={!!busy}>
                Change address
              </button>
              {signerKind === "browser" && (
                <button className="ghost" onClick={() => setShowExport((v) => !v)} aria-expanded={showExport}>
                  {showExport ? "Hide key export" : "Export key"}
                </button>
              )}
            </div>
            {showExport && signerKind === "browser" && <KeyBackup name={handle.full} />}

            <hr />
            {!confirmRevoke ? (
              <button className="ghost" onClick={() => setConfirmRevoke(true)} disabled={!!busy}>
                Remove binding
              </button>
            ) : (
              <>
                <p className="warn">
                  People won't be able to pay {handle.full} on {net.name} until you publish again. Remove it?
                </p>
                <div className="strip-actions">
                  <button onClick={revoke} disabled={!!busy}>
                    {busy === "revoke" ? "Removing…" : "Yes, remove it"}
                  </button>
                  <button className="ghost" onClick={() => setConfirmRevoke(false)} disabled={!!busy}>
                    Keep it
                  </button>
                </div>
              </>
            )}
            {isHostedHandle(handle.full) && (
              <>
                <p className="muted small">
                  A free name you don't want any more can be given back so someone else can use it. Payments to it stop
                  working, on every network.
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
            {errorLine}
          </section>
        </>
      )}

      <details className="card how-card">
        <summary>Why is each step needed?</summary>
        <p className="muted">
          A name is only trusted when two proofs point at each other. The <strong>name</strong> step makes a domain vouch
          for your key (for a free name, ours does). The <strong>proof</strong> is a tiny payment from your address with
          your key in it, which only the address's owner can make, and <strong>publish</strong> signs the matching claim.
          Anyone can name an address; only its owner can spend from it.
        </p>
      </details>
    </>
  );
}
