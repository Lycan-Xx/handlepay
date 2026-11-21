/**
 * The front page: what HandlePay does in one line, the two things a first-time
 * visitor (or judge) should try, and a box to check any name.
 */
import { useState } from "react";
import { DEMO_PAYEE } from "../config";
import { useTone } from "../hooks/useTone";
import { navigate, payPath } from "../lib/router";

const LOOKS_LIKE_NAME = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function HomePage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useTone("ok");

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };

  const demoPay = payPath(DEMO_PAYEE.handle, { amount: DEMO_PAYEE.amountUsd, network: DEMO_PAYEE.network });
  // Open the attack on the same network as the demo payment, so it attacks the same name.
  const demoAttack = `/security?network=${DEMO_PAYEE.network}`;

  return (
    <>
      <section className="hero">
        <h2 className="hero-title">Pay people, not addresses.</h2>
        <p className="muted">
          Send Bitcoin Cash to a name like <strong>{DEMO_PAYEE.handle}</strong>. Before you pay, HandlePay checks that the
          name really owns the address, so a copied or swapped address gets caught.
        </p>
      </section>

      <section className="card strip">
        <h2>Try it in a minute</h2>
        <div className="strip-actions">
          <a className="button ghost" href={demoAttack} onClick={go(demoAttack)}>
            Try the attack
          </a>
          <a className="button" href={demoPay} onClick={go(demoPay)}>
            Pay {DEMO_PAYEE.name} ${DEMO_PAYEE.amountUsd}
          </a>
        </div>
        <p className="muted small">
          {`The attack runs in your browser and moves no money. Paying ${DEMO_PAYEE.name} sends about $${DEMO_PAYEE.amountUsd} of ${DEMO_PAYEE.network === "mainnet" ? "real" : "practice"} BCH from your own wallet.`}
        </p>
      </section>

      <section className="card">
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
            Or pay any name
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
        <p className="chips">
          Try one:
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
