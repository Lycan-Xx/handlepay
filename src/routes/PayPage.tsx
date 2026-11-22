/**
 * /pay/<handle>: check the name, then pay it.
 *
 * Order matters. The name is resolved first and the badge decides whether a
 * payment is allowed at all (paymentGate). Verified pays straight away;
 * Claimed needs an explicit "pay anyway"; Changed needs the payer to
 * acknowledge the new address; Not found cannot be paid. The address paid is
 * always the one the resolver returned, never anything from the URL.
 */
import { useEffect, useMemo, useState } from "react";
import { Journey } from "../components/Journey";
import { PayPanel } from "../components/PayPanel";
import { VerifyCard } from "../components/VerifyCard";
import type { Wallet } from "../hooks/useWallet";
import type { BchNetwork } from "../lib/network";
import { parseHandle } from "../lib/nostr";
import { parsePayParams } from "../lib/paylink";
import { navigate } from "../lib/router";
import { getPin, pinResolution } from "../lib/pins";
import { liveDeps, paymentGate, resolveHandle, type Resolution } from "../lib/resolve";

export function PayPage(props: { handle: string; search: URLSearchParams; wallet: Wallet; network: BchNetwork }) {
  const { handle, search, network } = props;
  const params = useMemo(() => parsePayParams(search), [search]);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** The payer accepted a Claimed or Changed result. */
  const [accepted, setAccepted] = useState(false);
  /** The payment has gone out and the receipt is showing. */
  const [sent, setSent] = useState(false);

  useEffect(() => {
    // App remounts this page per handle and network, so state starts fresh here.
    let cancelled = false;
    const parsed = parseHandle(handle);
    const pin = parsed ? getPin(network, parsed.full) : null;
    resolveHandle(handle, network, liveDeps(network), pin)
      .then((r) => {
        if (cancelled) return;
        // Trust on first use: remember a Verified result so a later change is caught.
        if (r.status === "verified") pinResolution(network, r);
        setResolution(r);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [handle, network, attempt]);

  const gate = resolution ? paymentGate(resolution) : "blocked";
  const canPay = gate === "allowed" || (accepted && (gate === "confirm_unverified" || gate === "acknowledge_change"));

  const acknowledgeChange = () => {
    if (!resolution) return;
    pinResolution(network, resolution);
    setAccepted(true);
  };

  // Name was step 1 on /pay; here we are on Check until the name is cleared to pay, then Pay, then Receipt.
  const stage = sent ? 3 : canPay && resolution?.address ? 2 : 1;
  const hint = sent
    ? "Your payment is on its way. This page follows it until it confirms."
    : stage === 2
      ? "The name checked out. Enter the amount, connect your wallet, review, then approve in the wallet."
      : !resolution
        ? error
          ? "We couldn't finish the check."
          : "Checking the name. Nothing is sent until you approve in your wallet."
        : gate === "blocked"
          ? "Nothing can be paid from this result. If the name looks right, try again, or ask them to check their setup."
          : "Read the result, then decide whether to go on.";

  return (
    <>
      <Journey label="Pay someone" steps={["Name", "Check", "Pay", "Receipt"]} current={stage} hint={hint} />

      {params.ignored.length > 0 && (
        <p className="warn alert" role="alert">
          <strong>This link tried to change who gets paid.</strong> It set a recipient ({params.ignored.join(", ")}).
          HandlePay ignores that: it only pays the address the name proves, shown below.
        </p>
      )}

      <VerifyCard
        handle={handle}
        network={network}
        resolution={resolution}
        error={error}
        onRetry={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      />

      {gate === "confirm_unverified" && !accepted && (
        <section className="card gate amber">
          <p>
            <strong>We don't recommend paying this name.</strong> The proof that is missing is the one a scammer can't
            fake: a real payment sent from the address. If you know and trust the person another way, you can still go
            ahead.
          </p>
          <button className="ghost" onClick={() => setAccepted(true)}>
            Pay anyway
          </button>
        </section>
      )}

      {gate === "acknowledge_change" && !accepted && (
        <section className="card gate amber">
          <p>
            <strong>Check before you pay.</strong> This name pointed somewhere else last time. If you weren't expecting
            that, ask the person through another channel first.
          </p>
          <button className="ghost" onClick={acknowledgeChange}>
            I've checked, use the new address
          </button>
        </section>
      )}

      {canPay && resolution?.address && (
        <PayPanel
          wallet={props.wallet}
          network={network}
          handle={resolution.handle?.full ?? handle}
          address={resolution.address}
          params={params}
          onSent={() => setSent(true)}
        />
      )}

      {!sent && resolution && (
        <p className="muted small quiet-link">
          Want people to pay you like this?{" "}
          <a
            href="/identity"
            onClick={(e) => {
              e.preventDefault();
              navigate("/identity");
            }}
          >
            Get your own free name
          </a>
        </p>
      )}
    </>
  );
}
