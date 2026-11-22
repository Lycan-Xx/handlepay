/**
 * /pay: type the name you were given; the next screen checks it before any
 * money can move. A shared /pay?amount=&memo=&network= link keeps its
 * amount and memo on the way to /pay/<name> (the network is already applied
 * by App).
 */
import { useState } from "react";
import { DEMO_PAYEE } from "../config";
import { navigate, payPath } from "../lib/router";
import type { BchNetwork } from "../lib/network";

const LOOKS_LIKE_NAME = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PayStartPage({ search }: { search: URLSearchParams }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const linkNetwork = search.get("network");
  const carry = {
    amount: search.get("amount") ?? undefined,
    memo: search.get("memo") ?? undefined,
    network: linkNetwork === "mainnet" || linkNetwork === "chipnet" ? (linkNetwork as BchNetwork) : undefined,
  };

  return (
    <>
      <h2 className="page-title">Pay someone</h2>
      <p className="page-lead">Enter their payment name. We check it against the blockchain before your wallet is asked anything.</p>

      <section className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const handle = name.trim();
            if (!LOOKS_LIKE_NAME.test(handle)) {
              setError(`A payment name has an @ and a domain, like ${DEMO_PAYEE.handle}.`);
              return;
            }
            navigate(payPath(handle, carry));
          }}
        >
          <label>
            Their full payment name
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
              inputMode="email"
              aria-describedby={error ? "name-error" : undefined}
            />
          </label>
          {error && (
            <p id="name-error" className="err">
              {error}
            </p>
          )}
          <button type="submit" className="block">
            Continue
          </button>
        </form>
        <p className="chips">
          No name handy? Try
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

      <p className="muted small">
        You don't need an account or a name to pay. You'll need a Bitcoin Cash wallet that works with WizardConnect
        (Paytaca, Cashonize or Selene) when it's time to approve.
      </p>
    </>
  );
}
