/**
 * The front page: one question, two doors. A first-time visitor picks what
 * they came to do and is walked through it; the demo shortcuts for people who
 * just want to look sit quietly underneath.
 */
import { DEMO_PAYEE } from "../config";
import { useTone } from "../hooks/useTone";
import { navigate, payPath } from "../lib/router";

export function HomePage() {
  useTone("ok");

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };

  const demoPay = payPath(DEMO_PAYEE.handle, { amount: String(DEMO_PAYEE.amountUsd), network: DEMO_PAYEE.network });
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

      <h3 className="section">What brings you here?</h3>
      <section className="doors">
        <a className="card door" href="/pay" onClick={go("/pay")}>
          <span className="door-no" aria-hidden>
            →
          </span>
          <h2>I want to pay someone</h2>
          <p className="muted">They gave you a name like {DEMO_PAYEE.handle}. We check it, then your wallet pays.</p>
          <p className="door-steps">Name · Check · Pay · Receipt</p>
        </a>
        <a className="card door" href="/identity" onClick={go("/identity")}>
          <span className="door-no" aria-hidden>
            ←
          </span>
          <h2>I want to get paid by name</h2>
          <p className="muted">Get a free name (no domain needed), link it to your wallet, then share one pay link instead of an address.</p>
          <p className="door-steps">Name &amp; key · Wallet · Proof · Publish</p>
        </a>
      </section>

      <section className="card quiet">
        <p>
          <strong>Just looking?</strong> No wallet needed for the first one.
        </p>
        <div className="strip-actions">
          <a className="button ghost" href={demoAttack} onClick={go(demoAttack)}>
            Watch a fake name get caught
          </a>
          <a className="button ghost" href={demoPay} onClick={go(demoPay)}>
            Pay {DEMO_PAYEE.name} ${DEMO_PAYEE.amountUsd}
          </a>
        </div>
        <p className="muted small">
          {`The first runs in your browser and moves no money. The second sends about $${DEMO_PAYEE.amountUsd} of ${DEMO_PAYEE.network === "mainnet" ? "real" : "practice"} BCH from your own wallet.`}
        </p>
      </section>

      <p className="muted small">
        Already have a name?{" "}
        <a href="/auth" onClick={go("/auth")}>
          Sign in with it
        </a>{" "}
        to a site, no password. No account. A name lives on a domain (yours, or a free one we host) and on Nostr; proofs and
        payments live on the Bitcoin Cash chain. Your coins never leave your wallet.
      </p>
    </>
  );
}
