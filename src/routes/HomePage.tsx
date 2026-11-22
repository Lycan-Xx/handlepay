/**
 * The front page: say what HandlePay is in one line, then show it working.
 * One primary button starts the tour at the attack demo, which needs no
 * wallet; the three-stop strip underneath shows where the tour goes. People
 * who already know what they came for use the nav.
 */
import { TourStrip } from "../components/Tour";
import { DEMO_PAYEE } from "../config";
import { useTone } from "../hooks/useTone";
import { navigate } from "../lib/router";

export function HomePage() {
  useTone("ok");

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };
  // The tour's first stop: the attack demo, on the demo name's network.
  const start = `/security?network=${DEMO_PAYEE.network}`;

  return (
    <>
      <section className="hero">
        <h2 className="hero-title">Pay people, not addresses.</h2>
        <p className="muted">
          Send Bitcoin Cash to a name like <strong>{DEMO_PAYEE.handle}</strong>. Before any money moves, HandlePay proves
          the name really owns the address, so a copied or swapped address gets caught.
        </p>
        <div className="hero-cta">
          <a className="button big-cta" href={start} onClick={go(start)}>
            Watch it work
          </a>
          <span className="muted small">About a minute · no wallet · no money moves</span>
        </div>
      </section>

      <h3 className="section">The tour</h3>
      <TourStrip />

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
