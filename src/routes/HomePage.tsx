/**
 * The front page: say what HandlePay is in one line, then offer the tour.
 * The tour (/tour) is kept apart from the real app: it shows the product
 * working with no wallet, then hands the visitor to the real app to practise.
 * People who already know what they came for use the nav.
 */
import { DEMO_PAYEE } from "../config";
import { useTone } from "../hooks/useTone";
import { navigate } from "../lib/router";

export function HomePage() {
  useTone("ok");

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };

  return (
    <>
      <section className="hero">
        <h2 className="hero-title">Pay people, not addresses.</h2>
        <p className="muted">
          Send Bitcoin Cash to a name like <strong>{DEMO_PAYEE.handle}</strong>. Before any money moves, HandlePay proves
          the name really owns the address, so a copied or swapped address gets caught.
        </p>
        <div className="hero-cta">
          <a className="button big-cta" href="/tour" onClick={go("/tour")}>
            Watch it work
          </a>
          <span className="muted small">A two-minute tour · no wallet · no money moves</span>
        </div>
      </section>

      <h3 className="section">In the tour</h3>
      <ol className="tour-preview">
        <li>An attacker's fake name gets caught, live</li>
        <li>A real name passes the same checks</li>
        <li>
          You pay it, with a pretend wallet <span className="sim-chip">Simulated</span>
        </li>
        <li>How to get your own free name</li>
        <li>Then you try it yourself, with free practice coins</li>
      </ol>

      <p className="muted small home-direct">
        Know what you came for?{" "}
        <a href="/pay" onClick={go("/pay")}>
          Pay someone
        </a>{" "}
        or{" "}
        <a href="/identity" onClick={go("/identity")}>
          get paid by name
        </a>
        .
      </p>

      <p className="muted small home-foot">
        Your name can also be your login.{" "}
        <a href="/auth" onClick={go("/auth")}>
          See it work
        </a>
        . No account anywhere: a name lives on a domain (yours, or a free one we host) and on Nostr, and proofs and
        payments live on the Bitcoin Cash chain. Your coins never leave your wallet.
      </p>
    </>
  );
}
