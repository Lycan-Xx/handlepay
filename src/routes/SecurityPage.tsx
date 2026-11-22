/**
 * /security: the two attacks HandlePay stops outright, run live.
 *
 * The real name is resolved against live relays and the chain. Mallory is
 * made fresh in this browser, and her signed claims go through the same
 * resolveHandle the pay page uses (see lib/attack.ts). Nothing is published
 * and no money moves.
 */
import { useEffect, useState } from "react";
import { VerifyCard } from "../components/VerifyCard";
import {
  DEMO_HANDLES,
  MALLORY_HANDLE,
  makeMallory,
  runFakeClaim,
  tamperLink,
  type FakeClaimResult,
  type TamperedLink,
} from "../lib/attack";
import type { BchNetwork } from "../lib/network";
import { liveDeps, resolveHandle, type Resolution } from "../lib/resolve";
import { navigate } from "../lib/router";

interface Run {
  victim: Resolution;
  fake?: FakeClaimResult;
  link?: TamperedLink;
  ms: number;
}

const short = (s: string) => (s.length > 30 ? `${s.slice(0, 18)}…${s.slice(-8)}` : s);

export function SecurityPage({ network, search }: { network: BchNetwork; search: URLSearchParams }) {
  const [target, setTarget] = useState(search.get("name") ?? DEMO_HANDLES[network]);
  const [victimHandle, setVictimHandle] = useState(target);
  const [attempt, setAttempt] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attemptView, setAttemptView] = useState<"noProof" | "replay">("noProof");

  useEffect(() => {
    let cancelled = false;
    const started = performance.now();
    (async () => {
      // Mallory's checks fetch the same proof and parents as the real name's; reuse them.
      const live = liveDeps(network);
      const txCache = new Map<string, ReturnType<typeof live.getTransaction>>();
      const deps = {
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
    })()
      .then((r) => !cancelled && setRun(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [victimHandle, network, attempt]);

  const rerun = (handle: string) => {
    setRun(null);
    setError(null);
    if (handle === victimHandle) setAttempt((n) => n + 1);
    else setVictimHandle(handle);
  };

  const victimName = victimHandle.split("@")[0];

  return (
    <>
      <h2 className="page-title">How it works</h2>
      <p className="page-lead">
        Before you pay, HandlePay checks that a name really controls its address. Here it catches a copycat, live.
      </p>
      <section className="card">
        <h2>Try the attack</h2>
        <p className="muted">
          Mallory wants to pass herself off as someone else's verified name. This page makes a brand-new Mallory in your
          browser and runs her two best tricks through the same checks the pay page uses, against the real {network}{" "}
          chain. Nothing is published and no money moves.
        </p>
        <details className="how">
        <summary>Why it can't win: the three links</summary>
        <div className="chain">
          <div className="cnode">
            <span className="n">1</span>
            <div>
              <h4>Name → Nostr key</h4>
              <p>The domain publishes a file saying which key owns the name.</p>
            </div>
          </div>
          <div className="cnode">
            <span className="n">2</span>
            <div>
              <h4>Nostr key → address</h4>
              <p>A message signed by that key names the address to pay.</p>
            </div>
          </div>
          <div className="cnode gate">
            <span className="n">3</span>
            <div>
              <h4>Address → Nostr key</h4>
              <p>
                A real payment <strong>spent from that address</strong> names the key back. Only the owner can make it, so
                this is the link a copycat can't forge.
              </p>
            </div>
          </div>
        </div>
        </details>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (target.trim()) rerun(target.trim());
          }}
        >
          <label>
            Real name to attack
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={DEMO_HANDLES[network]} />
          </label>
          <button type="submit" className="ghost" disabled={!target.trim() || (!run && !error)}>
            {!run && !error ? "Running…" : "Run again"}
          </button>
        </form>
        {run && <p className="muted small">Done in {(run.ms / 1000).toFixed(1)} s with a new Mallory.</p>}
      </section>

      <h3 className="section">The real name</h3>
      <VerifyCard handle={victimHandle} network={network} resolution={run?.victim ?? null} error={error} onRetry={() => rerun(victimHandle)} />

      {run && run.victim.status !== "verified" && (
        <p className="warn">
          The attacks need a name that is Verified on {network}, so there is something real to copy.{" "}
          {victimHandle.toLowerCase() === DEMO_HANDLES[network]
            ? `${DEMO_HANDLES[network]} isn't set up on ${network} yet; switch network to see the demo.`
            : `Try ${DEMO_HANDLES[network]} or switch network.`}
        </p>
      )}

      {run?.fake && (
        <>
          <h3 className="section">Attack 1: Mallory says {victimName}'s address is hers</h3>
          <p className="muted">
            She signs a Nostr claim naming {victimName}'s address, and we even let her own domain vouch for her.
            HandlePay still won't call her Verified, because only someone who can spend from an address can make the
            BCH proof for it.
          </p>

          <div className="net" role="group" aria-label="Mallory's try" style={{ marginTop: 14 }}>
            <button className={attemptView === "noProof" ? "on" : ""} aria-pressed={attemptView === "noProof"} onClick={() => setAttemptView("noProof")}>
              Claim with no proof
            </button>
            <button className={attemptView === "replay" ? "on" : ""} aria-pressed={attemptView === "replay"} onClick={() => setAttemptView("replay")}>
              Reuse {victimName}'s proof
            </button>
          </div>
          <VerifyCard handle={MALLORY_HANDLE} network={network} resolution={attemptView === "noProof" ? run.fake.noProof : run.fake.replay} />
          {attemptView === "replay" && (
            <p className="muted small">
              The proof really was paid from that address, but it names {victimName}'s Nostr key, not Mallory's, and she
              can't make a new one without {victimName}'s coins. Still caught.
            </p>
          )}
        </>
      )}

      {run?.link && (
        <section className="card">
          <h2>Attack 2: Mallory edits a pay link</h2>
          <p className="muted">
            She takes {victimName}'s pay link, adds her own address and raises the amount, then sends it round:
          </p>
          <code className="addr">
            {run.link.href.split("&to=")[0]}
            <span className="strike">&to={run.link.href.split("&to=")[1]}</span>
          </code>
          <dl className="facts">
            <dt>to=</dt>
            <dd>
              Ignored. Her address <code>{short(run.link.malloryAddress)}</code> is never used.
            </dd>
            <dt>Pays</dt>
            <dd>
              {victimName}'s verified address <code>{short(run.link.recipient ?? "")}</code>, which comes only from the
              check above.
            </dd>
            <dt>amount=</dt>
            <dd>
              Pre-fills ${run.link.params.amountUsd?.toFixed(2)}. You see it in the form and again in your wallet before
              you approve, so read it.
            </dd>
          </dl>
          <button className="ghost" onClick={() => navigate(run.link!.href)}>
            Open the tampered link
          </button>
          <p className="muted small">The pay page warns about the ignored address and pays only {victimName}.</p>
        </section>
      )}
    </>
  );
}
