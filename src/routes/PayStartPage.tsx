/**
 * /pay: step 1 of paying someone. Type the name you were given; the next
 * screen checks it before any money can move.
 */
import { useState } from "react";
import { Journey } from "../components/Journey";
import { DEMO_PAYEE } from "../config";
import { navigate, payPath } from "../lib/router";

const LOOKS_LIKE_NAME = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PayStartPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const demoPay = payPath(DEMO_PAYEE.handle, { amount: String(DEMO_PAYEE.amountUsd), network: DEMO_PAYEE.network });
  const demoAttack = `/security?network=${DEMO_PAYEE.network}`;
  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };

  return (
    <>
      <Journey
        label="Pay someone"
        steps={["Name", "Check", "Pay", "Receipt"]}
        current={0}
        hint="Type the name they gave you. We check it before your wallet is involved."
      />

      <section className="card">
        <h2>Who are you paying?</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const handle = name.trim();
            if (!LOOKS_LIKE_NAME.test(handle)) {
              setError(`A name has an @ and a domain, like ${DEMO_PAYEE.handle}.`);
              return;
            }
            navigate(payPath(handle));
          }}
        >
          <label>
            Their name
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={DEMO_PAYEE.handle}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              aria-describedby={error ? "name-error" : undefined}
            />
          </label>
          {error && (
            <p id="name-error" className="err">
              {error}
            </p>
          )}
          <button type="submit">Check this name</button>
        </form>
        <p className="chips">
          No name handy?
          <button
            type="button"
            className="chip"
            onClick={() => {
              setName(DEMO_PAYEE.handle);
              setError(null);
            }}
          >
            {DEMO_PAYEE.handle}
          </button>
        </p>
      </section>

      <p className="need">
        <strong>What you'll need:</strong> a Bitcoin Cash wallet that supports WalletConnect-style signing (Paytaca,
        Cashonize or Selene), with a little BCH in it. You only need it at step 3.
      </p>

      <p className="muted small">
        No wallet? You can still{" "}
        <a href={demoAttack} onClick={go(demoAttack)}>
          watch a fake name get caught
        </a>{" "}
        (no money moves), or{" "}
        <a href={demoPay} onClick={go(demoPay)}>
          pay {DEMO_PAYEE.name} ${DEMO_PAYEE.amountUsd}
        </a>{" "}
        to see the whole trip.
      </p>
    </>
  );
}
