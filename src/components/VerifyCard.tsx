/**
 * The badge that tells the truth about a name: Checking, Verified, Claimed,
 * Changed or Not found, with the reason and a "How we checked" list.
 * Colour is always paired with an icon and words, so it reads without colour.
 */
import { explorerTx, type BchNetwork } from "../lib/network";
import type { Resolution } from "../lib/resolve";

const LOOK: Record<Resolution["status"], { icon: string; title: string; tone: string }> = {
  verified: { icon: "✓", title: "Verified", tone: "ok" },
  claimed: { icon: "!", title: "Claimed, not proven", tone: "amber" },
  changed: { icon: "🔒", title: "Changed since your last visit", tone: "amber" },
  not_found: { icon: "–", title: "Not found", tone: "neutral" },
};

const short = (s: string, head = 10, tail = 8) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

export function VerifyCard(props: {
  handle: string;
  network: BchNetwork;
  resolution: Resolution | null;
  /** Set when the lookup itself failed (network down, etc.). */
  error?: string | null;
  onRetry?: () => void;
}) {
  const { handle, network, resolution, error, onRetry } = props;
  const [local, domain] = splitHandle(resolution?.handle?.full ?? handle);

  if (!resolution) {
    return (
      <section className="card verify tone-checking" aria-live="polite" aria-busy={!error}>
        <p className="handle">
          {local}
          <span className="domain">@{domain}</span>
        </p>
        {error ? (
          <>
            <p className="badge">
              <span aria-hidden>✗</span> Couldn't check this name
            </p>
            <p className="muted">{error}</p>
            {onRetry && (
              <button className="ghost" onClick={onRetry}>
                Try again
              </button>
            )}
          </>
        ) : (
          <>
            <p className="badge">
              <span className="spinner" aria-hidden /> Checking {local}@{domain}…
            </p>
            <ul className="checks pending">
              <li>Name listed by {domain}</li>
              <li>Signed by the name's Nostr key</li>
              <li>BCH proof paid from the address</li>
              <li>Proof confirmed on chain</li>
            </ul>
          </>
        )}
      </section>
    );
  }

  const look = LOOK[resolution.status];
  const summary =
    resolution.status === "verified"
      ? "Nostr signature ✓ · BCH proof ✓ (confirmed)"
      : resolution.status === "not_found"
        ? resolution.reason ?? "No HandlePay identity for this name"
        : resolution.reason;

  return (
    <section className={`card verify tone-${look.tone}`} aria-live="polite">
      <p className="handle">
        {local}
        <span className="domain">@{domain}</span>
      </p>
      <p className="badge">
        <span aria-hidden>{look.icon}</span> {look.title}
      </p>
      {summary && <p className="muted">{summary}</p>}

      {resolution.handle?.nonAscii && (
        <p className="warn">
          This name uses letters outside plain English. Check it isn't a look-alike of a name you know.
        </p>
      )}

      {resolution.address && resolution.status !== "not_found" && (
        <>
          <p className="label">Pays to</p>
          <code className="addr">{resolution.address}</code>
        </>
      )}

      {resolution.status === "changed" && resolution.previous && (
        <>
          <p className="label">Last time you saw</p>
          <code className="addr old">{resolution.previous.address}</code>
          {resolution.previous.pubkey !== resolution.pubkey && (
            <p className="muted">The name is also signed by a different Nostr key than before.</p>
          )}
        </>
      )}

      {resolution.status === "not_found" && (
        <p className="muted">
          If this is your name, you can set it up from the{" "}
          <a href="/">developer page</a>.
        </p>
      )}

      {resolution.checks.length > 0 && (
        <details className="how">
          <summary>How we checked</summary>
          <ul className="checks">
            {resolution.checks.map((c) => (
              <li key={c.id} className={c.ok ? "ok" : "bad"}>
                <span aria-hidden>{c.ok ? "✓" : "✗"}</span> {c.label}
                {c.detail && <span className="muted"> · {c.detail}</span>}
              </li>
            ))}
          </ul>
          {resolution.pubkey && (
            <p className="muted">
              Nostr key: <code>{short(resolution.pubkey, 8, 8)}</code>
            </p>
          )}
          {resolution.proofTxid && (
            <p className="muted">
              Proof transaction:{" "}
              <a href={explorerTx(network, resolution.proofTxid)} target="_blank" rel="noreferrer">
                {short(resolution.proofTxid)}
              </a>
            </p>
          )}
        </details>
      )}
    </section>
  );
}

function splitHandle(handle: string): [string, string] {
  const at = handle.lastIndexOf("@");
  return at > 0 ? [handle.slice(0, at), handle.slice(at + 1)] : [handle, ""];
}
