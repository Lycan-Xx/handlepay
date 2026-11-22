/**
 * The front page: one promise, then the two roles side by side. Someone who
 * wants to be paid creates a name; someone who wants to pay needs nothing but
 * the name they were given. Signing in with a name (/auth) is a demo for other
 * sites, so it lives in the footer, away from these two cards: next to "Pay"
 * it made people think they had to log in to pay.
 */
import { Icon } from "../components/Icon";
import { navigate } from "../lib/router";

export function HomePage() {
  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };

  return (
    <>
      <section className="hero">
        <h2 className="hero-title">Your name. Your money. Your control.</h2>
        <p className="hero-lead">
          A simpler way to send and receive Bitcoin Cash using human-readable payment names.
        </p>
      </section>

      <div className="roles">
        <section className="card role">
          <Icon name="alternate_email" className="role-icon" />
          <h2>Get your payment name</h2>
          <p className="muted">Create a name people can use to pay you.</p>
          <a className="button block" href="/identity" onClick={go("/identity")}>
            Create my pay name
          </a>
        </section>
        <section className="card role">
          <Icon name="send" className="role-icon" />
          <h2>Pay someone</h2>
          <p className="muted">Send BCH to someone's payment name. No account needed.</p>
          <a className="button block" href="/pay" onClick={go("/pay")}>
            Pay someone
          </a>
        </section>
      </div>

      <p className="how-link">
        <a href="/security" onClick={go("/security")}>
          How it works <Icon name="arrow_forward" />
        </a>
      </p>

      <ul className="trust" aria-label="Why it's safe">
        <li>
          <Icon name="no_accounts" /> No account needed to pay
        </li>
        <li>
          <Icon name="verified" /> Checked against the blockchain
        </li>
        <li>
          <Icon name="devices" /> Your keys stay on your device
        </li>
      </ul>
    </>
  );
}
