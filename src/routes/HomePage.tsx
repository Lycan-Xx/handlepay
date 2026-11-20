/**
 * The front page: what HandlePay does in one line, a name box, and the two
 * things a first-time visitor (or judge) should try.
 */
import { useState } from "react";
import { DEMO_PAYEE } from "../config";
import { navigate, payPath } from "../lib/router";

const LOOKS_LIKE_NAME = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function HomePage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };

  const demoPay = payPath(DEMO_PAYEE.handle, { amount: DEMO_PAYEE.amountUsd, network: DEMO_PAYEE.network });

  return (
    <>
      <section className="hero">
        <h2 className="hero-title">Pay people, not addresses.</h2>
        <p className="muted">
          Send Bitcoin Cash to a name like <strong>{DEMO_PAYEE.handle}</strong>. Before you pay, HandlePay checks that the
          name really owns the address, so a copied or swapped address gets caught.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const handle = name.trim();
            if (!LOOKS_LIKE_NAME.test(handle)) {
              setError(`Enter a name with an @ and a domain, like ${DEMO_PAYEE.handle}.`);
              return;
            }
            navigate(payPath(handle));
          }}
        >
          <label>
            Who are you paying?
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
              aria-describedby={error ? "name-error" : undefined}
            />
          </label>
          {error && (
            <p id="name-error" className="err">
              {error}
            </p>
          )}
          <button type="submit">Check name</button>
        </form>
      </section>

      <section className="card strip">
        <h2>Try it in a minute</h2>
        <div className="strip-actions">
          <a className="button ghost" href="/security" onClick={go("/security")}>
            Try the attack
          </a>
          <a className="button" href={demoPay} onClick={go(demoPay)}>
            Pay {DEMO_PAYEE.name} ${DEMO_PAYEE.amountUsd}
          </a>
        </div>
        <p className="muted small">
          {`The attack runs in your browser and moves no money. Paying ${DEMO_PAYEE.name} sends real BCH on ${DEMO_PAYEE.network}, about $${DEMO_PAYEE.amountUsd}, from your own wallet.`}
        </p>
      </section>

      <section className="entries">
        <a className="card entry" href="/identity" onClick={go("/identity")}>
          <h2>Get paid by name</h2>
          <p className="muted">Link your wallet to your name, then share a pay link instead of an address.</p>
        </a>
        <a className="card entry" href="/auth" onClick={go("/auth")}>
          <h2>Sign in with your name</h2>
          <p className="muted">Log in to a site with your name and no password. Try the demo.</p>
        </a>
      </section>

      <p className="muted small">
        No account, and no HandlePay server: names live on your own domain and on Nostr, and proofs and payments live on
        the Bitcoin Cash chain. Your keys never leave your wallet.
      </p>
    </>
  );
}
