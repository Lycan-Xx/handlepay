/**
 * The guided tour: three stops that explain HandlePay by doing it.
 *
 *   1. See a fake name get caught   (no wallet, no money)
 *   2. Pay a verified name          (real money, about $0.25)
 *   3. Get your own free name       (a wallet, nothing else)
 *
 * Home shows the whole strip. Each stop's page ends with a NextStep card
 * pointing at the following stop, so a visitor never hits a dead end. The
 * card only appears once a page's own job is done (attack results shown,
 * receipt showing, name published), never beside a button the visitor still
 * needs to press.
 */
import { DEMO_PAYEE } from "../config";
import { navigate, payPath } from "../lib/router";

interface TourStop {
  no: 1 | 2 | 3;
  title: string;
  detail: string;
  href: string;
  /** Short reassurance or warning shown beside the stop. */
  tag: string;
  tagTone: "ok" | "amber";
}

const demoPay = payPath(DEMO_PAYEE.handle, { amount: DEMO_PAYEE.amountUsd, network: DEMO_PAYEE.network });
const realMoney = DEMO_PAYEE.network === "mainnet";

const TOUR: TourStop[] = [
  {
    no: 1,
    title: "See a fake name get caught",
    detail: "An attacker tries to pass as a real name and to edit a pay link. Both fail, live.",
    href: `/security?network=${DEMO_PAYEE.network}`,
    tag: "No wallet · no money",
    tagTone: "ok",
  },
  {
    no: 2,
    title: `Pay a verified name`,
    detail: `Pay ${DEMO_PAYEE.name} by name. Every check is shown before your wallet is asked.`,
    href: demoPay,
    tag: realMoney ? `Real money · about $${DEMO_PAYEE.amountUsd}` : `Practice coins · about $${DEMO_PAYEE.amountUsd}`,
    tagTone: realMoney ? "amber" : "ok",
  },
  {
    no: 3,
    title: "Get your own free name",
    detail: "Claim yourname@handlepay, link it to your wallet, share one pay link.",
    href: "/identity",
    tag: "Wallet only · no domain",
    tagTone: "ok",
  },
];

const go = (href: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  navigate(href);
};

/** The three stops, as a numbered strip. Used on home. */
export function TourStrip() {
  return (
    <ol className="tour" aria-label="The tour">
      {TOUR.map((s) => (
        <li key={s.no}>
          <a className="tour-stop" href={s.href} onClick={go(s.href)}>
            <span className="tour-no" aria-hidden>
              {s.no}
            </span>
            <span className="tour-body">
              <b>{s.title}</b>
              <span className="muted">{s.detail}</span>
              <span className={`tour-tag ${s.tagTone}`}>{s.tag}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * The card at the end of a tour stop, pointing at the next one. `done` is the
 * stop just finished. After stop 3 there is no next stop, so pages handle
 * that ending themselves (Get paid hands off to "pay yourself").
 */
export function NextStep({ done, lead }: { done: 1 | 2; lead?: string }) {
  const next = TOUR[done];
  const after = TOUR[done + 1];
  return (
    <section className="card next" aria-label="What to do next">
      <p className="journey-kicker">
        Tour · step {done} of 3 done
      </p>
      {lead && <p className="next-lead">{lead}</p>}
      <h2>
        Next: {next.title.charAt(0).toLowerCase() + next.title.slice(1)}
      </h2>
      <p className="muted">{next.detail}</p>
      <p className={`tour-tag ${next.tagTone}`}>{next.tag}</p>
      <div className="strip-actions">
        <a className="button" href={next.href} onClick={go(next.href)}>
          {done === 1 ? `Pay ${DEMO_PAYEE.name} →` : "Get my free name →"}
        </a>
        {after && (
          <a className="button ghost" href={after.href} onClick={go(after.href)}>
            Skip to: {after.title.charAt(0).toLowerCase() + after.title.slice(1)}
          </a>
        )}
      </div>
    </section>
  );
}
