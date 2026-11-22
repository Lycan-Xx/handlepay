/**
 * /tour: the guided walkthrough, kept apart from the real app.
 *
 *   1. A fake name gets caught   real checks, live chain, nothing published
 *   2. A real name passes        the same run's real result for the demo name
 *   3. Paying it                 SIMULATED wallet and receipt: no wallet, no money
 *   4. Getting your own name     the four steps explained; the name check is real
 *                                and read-only, nothing is claimed
 *   5. Your turn                 hand-off to the real app: practice coins first
 *
 * Steps 1, 2 and the name check read real data. Steps 3 and 4 never touch a
 * wallet, a key, or the name service's write side, and say so on screen. The
 * tour always reads the demo name's network, whatever the app is set to, and
 * leaves the app's network alone until the visitor picks a button in step 5.
 */
import { useEffect, useRef, useState } from "react";
import { Journey } from "../components/Journey";
import { VerifyCard } from "../components/VerifyCard";
import { DEMO_PAYEE } from "../config";
import { useTone } from "../hooks/useTone";
import { DEMO_HANDLES, MALLORY_HANDLE, runAttackDemo, type AttackRun } from "../lib/attack";
import { HOSTED_DOMAIN, lookupName, type Availability } from "../lib/hosted";
import { navigate, payPath } from "../lib/router";

const STEPS = ["Fake caught", "Real passes", "Pay", "Your name", "Your turn"];
const FAUCET = "https://tbch.googol.cash/";

const short = (s: string) => (s.length > 30 ? `${s.slice(0, 18)}…${s.slice(-8)}` : s);
const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

type PayState = "form" | "asking" | "rejected" | "sent";

export function TourPage() {
  const network = DEMO_PAYEE.network;
  const victimHandle = DEMO_HANDLES[network];
  const victimName = DEMO_PAYEE.name;

  const [step, setStep] = useState(0);
  const [run, setRun] = useState<AttackRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [pay, setPay] = useState<PayState>("form");
  const [stage, setStage] = useState(0);
  const [simTxid, setSimTxid] = useState("");

  const [nameInput, setNameInput] = useState("");
  const [avail, setAvail] = useState<Availability | null>(null);
  const [checking, setChecking] = useState(false);

  const top = useRef<HTMLDivElement>(null);
  useTone(step === 0 && run?.fake ? "amber" : step === 2 && pay !== "sent" ? "blue" : "ok");

  // One live run feeds steps 1 and 2.
  useEffect(() => {
    let cancelled = false;
    runAttackDemo(victimHandle, network)
      .then((r) => !cancelled && setRun(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [victimHandle, network, attempt]);

  // The simulated receipt walks Submitted → Seen → Confirmed on a timer.
  useEffect(() => {
    if (pay !== "sent") return;
    const a = setTimeout(() => setStage(1), 1200);
    const b = setTimeout(() => setStage(2), 3600);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [pay]);

  const goStep = (n: number) => {
    setStep(n);
    top.current?.scrollIntoView({ block: "start" });
    window.scrollTo(0, 0);
  };
  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };
  const retry = () => {
    setRun(null);
    setError(null);
    setAttempt((n) => n + 1);
  };

  const checkName = async () => {
    setChecking(true);
    setAvail(await lookupName(nameInput));
    setChecking(false);
  };

  const verified = run?.victim.status === "verified";
  const address = run?.victim.address ?? "";

  const hints = [
    `Mallory, an attacker, tries to pass as ${victimName}. These are the real checks, run live in your browser. Nothing is published and no money moves.`,
    `The same checks, on the real ${victimName}. This is what a payer sees before their wallet is involved.`,
    "A simulation: no wallet is connected and no money moves. It shows what paying feels like.",
    "How you'd get a name of your own. Nothing is claimed in the tour.",
    "You've seen it work. Now try it yourself, with practice coins first.",
  ];

  const loading = !run && !error && (
    <section className="card">
      <p className="muted" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
        <span className="spinner" aria-hidden /> Running the real checks against the {network} chain…
      </p>
    </section>
  );
  const failed = (error || (run && !verified)) && (
    <section className="card">
      <p className="warn" style={{ marginTop: 0 }}>
        {error
          ? `We couldn't finish the live check (${error}).`
          : `${victimHandle} didn't come out Verified just now, so there's nothing real to copy.`}{" "}
        This usually means a relay or chain server was slow.
      </p>
      <button className="ghost" onClick={retry}>
        Try again
      </button>
    </section>
  );

  return (
    <>
      <div ref={top} />
      <Journey label="The tour" steps={STEPS} current={step} hint={hints[step]} />

      {/* ---------- 1. A fake name gets caught ---------- */}
      {step === 0 && (
        <>
          {loading}
          {failed}
          {run?.fake && run.link && (
            <>
              <h3 className="section">Trick 1: Mallory claims {victimName}'s address</h3>
              <p className="muted">
                She signs a claim saying {victimName}'s address is hers, and even gets a domain to vouch for her. It
                isn't enough: only someone who can spend from an address can make the proof for it.
              </p>
              <VerifyCard handle={MALLORY_HANDLE} network={network} resolution={run.fake.noProof} wash={false} />

              <h3 className="section">Trick 2: Mallory edits {victimName}'s pay link</h3>
              <section className="card">
                <p className="muted" style={{ marginTop: 0 }}>
                  She adds her own address to the link and sends it round:
                </p>
                <code className="addr">
                  {run.link.href.split("&to=")[0]}
                  <span className="strike">&to={run.link.href.split("&to=")[1]}</span>
                </code>
                <dl className="facts">
                  <dt>Her address</dt>
                  <dd>
                    Ignored, never paid:
                    <code>{short(run.link.malloryAddress)}</code>
                  </dd>
                  <dt>Who gets paid</dt>
                  <dd>
                    Only {victimName}'s proven address:
                    <code>{short(run.link.recipient ?? "")}</code>
                  </dd>
                </dl>
              </section>
              <p className="note green">
                <strong>Both tricks caught</strong>, in {(run.ms / 1000).toFixed(1)} s, by the checks the real pay page
                uses.
              </p>
            </>
          )}
        </>
      )}

      {/* ---------- 2. A real name passes ---------- */}
      {step === 1 && (
        <>
          {loading}
          {error && failed}
          {run && (
            <>
              <VerifyCard handle={victimHandle} network={network} resolution={run.victim} onRetry={retry} />
              {verified && (
                <p className="note green">
                  <strong>Why this one passes:</strong> {victimName}'s domain names a key, that key names an address,
                  and a real payment <em>spent from that address</em> names the key back. Mallory could copy the first
                  two. She couldn't make the third.
                </p>
              )}
            </>
          )}
        </>
      )}

      {/* ---------- 3. Paying it (simulated) ---------- */}
      {step === 2 && (
        <>
          <p className="sim-flag" role="note">
            Simulation · no wallet · no money
          </p>
          <section className="card">
            <h2>Pay {victimHandle}</h2>
            <dl className="facts">
              <dt>To</dt>
              <dd>
                {victimHandle} <span className="badge good small-badge">✓ Verified</span>
              </dd>
              <dt>Address</dt>
              <dd>
                <code>{address ? short(address) : "from the check in step 2"}</code>
              </dd>
              <dt>Amount</dt>
              <dd>${DEMO_PAYEE.amountUsd} in BCH</dd>
            </dl>
            {pay === "form" && (
              <button onClick={() => setPay("asking")}>Pay with my wallet</button>
            )}
            {pay === "rejected" && (
              <>
                <p className="note amber">
                  <strong>You said no, so nothing was sent.</strong> In the real app your wallet always has the final
                  say; HandlePay can't move money without it.
                </p>
                <button className="ghost" onClick={() => setPay("asking")}>
                  Try again
                </button>
              </>
            )}
          </section>

          {pay === "asking" && (
            <section className="mockwallet" aria-label="Simulated wallet">
              <p className="mockwallet-bar">
                <span>Your wallet</span>
                <span className="sim-chip">Simulated</span>
              </p>
              <p className="mockwallet-title">HandlePay asks you to send</p>
              <p className="mockwallet-amount">${DEMO_PAYEE.amountUsd}</p>
              <p className="muted small" style={{ margin: "0 0 4px" }}>
                to
              </p>
              <code className="addr">{address || "the verified address"}</code>
              <p className="muted small">
                A real wallet shows this same address. It came from the check, never from the link, so a tampered link
                can't change it.
              </p>
              <div className="strip-actions">
                <button
                  onClick={() => {
                    setSimTxid(randomHex(32));
                    setStage(0);
                    setPay("sent");
                  }}
                >
                  Approve
                </button>
                <button className="ghost" onClick={() => setPay("rejected")}>
                  Reject
                </button>
              </div>
            </section>
          )}

          {pay === "sent" && (
            <section className="card receipt" aria-live="polite">
              <div className="tick" aria-hidden>
                ✓
              </div>
              <h2>Payment sent <span className="sim-chip">Simulated</span></h2>
              <ol className="stages">
                {["Submitted", "Seen", "Confirmed"].map((label, i) => (
                  <li key={label} className={i < stage ? "done" : i === stage ? "now" : ""}>
                    <span aria-hidden>{i <= stage ? "●" : "○"}</span> {label}
                  </li>
                ))}
              </ol>
              <p className="muted">
                {
                  [
                    "Your wallet signed it and HandlePay sent it to the network.",
                    "The network has it. The recipient's wallet can see it now.",
                    "It's in a block. In the real app, this is final.",
                  ][stage]
                }
              </p>
              <dl className="facts">
                <dt>To</dt>
                <dd>{victimHandle}</dd>
                <dt>Amount</dt>
                <dd>${DEMO_PAYEE.amountUsd}</dd>
                <dt>Transaction</dt>
                <dd>
                  <code>
                    {simTxid.slice(0, 12)}…{simTxid.slice(-10)}
                  </code>{" "}
                  <span className="muted">(made up for the tour; not on any chain)</span>
                </dd>
              </dl>
              <p className="muted small">
                A real receipt follows the transaction on the chain and links to its details.
              </p>
            </section>
          )}
        </>
      )}

      {/* ---------- 4. Getting your own name ---------- */}
      {step === 3 && (
        <>
          <section className="card">
            <h2>Try a name</h2>
            <p className="muted">
              This checks the real name list but claims nothing. You'd claim it in the real app.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (nameInput.trim()) void checkName();
              }}
            >
              <label>
                Your name
                <span className="name-row">
                  <input
                    value={nameInput}
                    onChange={(e) => {
                      setNameInput(e.target.value);
                      setAvail(null);
                    }}
                    placeholder="yourname"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <span className="muted">@{HOSTED_DOMAIN}</span>
                </span>
              </label>
              <button type="submit" className="ghost" disabled={!nameInput.trim() || checking}>
                {checking ? "Checking…" : "Is it free?"}
              </button>
            </form>
            {avail && (
              <p className={avail.state === "available" ? "note green" : "note amber"}>
                {avail.state === "available"
                  ? `${avail.name}@${HOSTED_DOMAIN} is free. Nothing is claimed yet.`
                  : avail.state === "yours"
                    ? "That name is already yours."
                    : avail.message}
              </p>
            )}
          </section>

          <h3 className="section">Then, in the real app</h3>
          <ol className="tour-steps">
            <li>
              <b>Name &amp; key.</b> Claim the name. Your browser makes the key that proves it's yours, and you back it
              up. No domain, no extension.
            </li>
            <li>
              <b>Wallet.</b> Connect the wallet that should receive the money.
            </li>
            <li>
              <b>Proof.</b> Your wallet sends one tiny payment from that address with your key in its note. Only the
              address's owner can do this; it's the step Mallory couldn't fake.
            </li>
            <li>
              <b>Publish.</b> Your name now shows <strong>Verified</strong>, like {victimName}'s, and you get one pay link
              to share instead of an address.
            </li>
          </ol>
          <p className="muted small">About ten minutes the first time. Practice coins are free, so the first run costs nothing.</p>
        </>
      )}

      {/* ---------- 5. Your turn ---------- */}
      {step === 4 && (
        <>
          <section className="card next">
            <p className="journey-kicker">Recommended first</p>
            <h2>Practice with free coins</h2>
            <p className="muted">
              Practice coins (chipnet) work exactly like the real thing but are worth nothing, so mistakes cost nothing.
            </p>
            <ol className="tour-steps">
              <li>
                Get free practice coins from{" "}
                <a href={FAUCET} target="_blank" rel="noreferrer">
                  the faucet
                </a>{" "}
                (pick <b>chipnet</b> there), into a wallet set to chipnet such as Cashonize or Paytaca.
              </li>
              <li>Claim your free name and link it to that wallet.</li>
              <li>Pay a name, yours or the practice demo name.</li>
            </ol>
            <div className="strip-actions">
              <a className="button" href="/identity?network=chipnet" onClick={go("/identity?network=chipnet")}>
                Get my free name (practice)
              </a>
              <a
                className="button ghost"
                href={payPath(DEMO_HANDLES.chipnet, { amount: "0.10", network: "chipnet" })}
                onClick={go(payPath(DEMO_HANDLES.chipnet, { amount: "0.10", network: "chipnet" }))}
              >
                Pay the practice name
              </a>
            </div>
          </section>

          <section className="card">
            <p className="journey-kicker">When you're ready</p>
            <h2>Use real money</h2>
            <p className="muted">Real BCH, real payments. They're final, so keep amounts tiny.</p>
            <div className="strip-actions">
              <a
                className="button ghost"
                href={payPath(DEMO_PAYEE.handle, { amount: DEMO_PAYEE.amountUsd, network: "mainnet" })}
                onClick={go(payPath(DEMO_PAYEE.handle, { amount: DEMO_PAYEE.amountUsd, network: "mainnet" }))}
              >
                Pay {victimName} ${DEMO_PAYEE.amountUsd}
              </a>
              <a className="button ghost" href="/identity?network=mainnet" onClick={go("/identity?network=mainnet")}>
                Get paid by name
              </a>
            </div>
          </section>

          <p className="muted small why">
            <button className="link" onClick={() => {
              setPay("form");
              goStep(0);
            }}>
              Watch the tour again
            </button>
          </p>
        </>
      )}

      <div className="tour-nav">
        {step > 0 ? (
          <button className="ghost" onClick={() => goStep(step - 1)}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 && (
          <button onClick={() => goStep(step + 1)}>
            {step === 2 && pay !== "sent" ? "Skip →" : `Next: ${STEPS[step + 1].toLowerCase()} →`}
          </button>
        )}
      </div>
    </>
  );
}
