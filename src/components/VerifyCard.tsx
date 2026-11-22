/**
 * The result of checking a name: who it is, one status word, one sentence on
 * what that means, and the address it pays. "How we checked" lists each check.
 *
 * The states are Checking, Verified, Claimed, Changed, Not found and
 * "Couldn't check". Colour is always paired with an icon and words, so it reads
 * without colour. A Claimed or Changed address has no Copy button: an address
 * the name hasn't proven shouldn't be easy to take somewhere else.
 */
import { explorerTx, type BchNetwork } from "../lib/network";
import type { Resolution } from "../lib/resolve";
import { navigate } from "../lib/router";
import { CopyButton } from "./CopyButton";
import { Icon, type IconName } from "./Icon";

type Tone = "ok" | "amber" | "neutral" | "checking";

const LOOK: Record<
  Resolution["status"],
  { icon: IconName; title: string; tone: Tone; verdict: string; sub?: string }
> = {
  verified: {
    icon: "check_circle",
    title: "Verified",
    tone: "ok",
    verdict: "This name proved it controls the address below.",
    sub: "Two proofs point at each other. Safe to pay.",
  },
  claimed: {
    icon: "gpp_maybe",
    title: "Claimed, not proven",
    tone: "amber",
    verdict: "Someone named this address, but hasn't proved they own it.",
  },
  changed: {
    icon: "change_circle",
    title: "Changed since your last visit",
    tone: "amber",
    verdict: "This name now points to a different address than before.",
    sub: "Maybe they changed wallets, maybe someone took over the name. Ask them another way before you pay.",
  },
  not_found: {
    icon: "search_off",
    title: "Not found",
    tone: "neutral",
    verdict: "This name hasn't been set up.",
  },
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
  // The resolver reports an unreachable domain as Not found with the reason in the first check's detail.
  // That is a failure to check, not proof the name doesn't exist, so it gets the "Couldn't check" card.
  const first = resolution?.checks[0];
  const unreachable =
    resolution?.status === "not_found" && first?.id === "nip05" && !first.ok && !!first.detail && first.detail !== "Name not listed";
  const failure = error ?? (unreachable ? (resolution?.reason ?? null) : null);
  const tone: Tone = resolution && !unreachable ? LOOK[resolution.status].tone : failure ? "neutral" : "checking";

  const nameBlock = (
    <>
      <div className="avatar" aria-hidden>
        {(local[0] ?? "?").toUpperCase()}
      </div>
      <p className="handle">
        {local}
        <span className="domain">@{domain}</span>
      </p>
    </>
  );

  if (!resolution || unreachable) {
    return (
      <section className={`card verify result tone-${tone}`} aria-live="polite" aria-busy={!failure}>
        {nameBlock}
        {failure ? (
          <>
            <p className="badge">
              <Icon name="cloud_off" /> Couldn't check this name
            </p>
            <p className="verdict">We couldn't reach what we need to check it.</p>
            <p className="subverdict">{failure} We can't tell either way, so we won't call it Verified.</p>
            {onRetry && (
              <p>
                <button className="ghost" onClick={onRetry}>
                  Try again
                </button>
              </p>
            )}
          </>
        ) : (
          <>
            <p className="badge">
              <span className="spinner" aria-hidden /> Checking…
            </p>
            <ul className="checks pending">
              {[`Name listed by ${domain}`, "Signed by the name's Nostr key", "BCH proof paid from the address", "Proof confirmed on chain"].map(
                (label) => (
                  <li key={label}>
                    <Icon name="radio_button_unchecked" /> {label}
                  </li>
                ),
              )}
            </ul>
          </>
        )}
      </section>
    );
  }

  const look = LOOK[resolution.status];
  const sub =
    resolution.status === "verified" || resolution.status === "changed"
      ? look.sub
      : resolution.status === "not_found"
        ? resolution.reason
        : (resolution.reason ?? "Anyone can write any address into a profile.");
  const showAddress = !!resolution.address && resolution.status !== "not_found";
  const canCopy = resolution.status === "verified";

  return (
    <section className={`card verify result tone-${look.tone}`} aria-live="polite">
      {nameBlock}
      <p className="badge">
        <Icon name={look.icon} /> {look.title}
      </p>
      <p className="verdict">{look.verdict}</p>
      {sub && <p className="subverdict">{sub}</p>}

      {resolution.handle?.nonAscii && (
        <p className="warn">
          This name uses letters outside plain English. Check it isn't a look-alike of a name you know.
        </p>
      )}

      {showAddress && (
        <div className="addrbox">
          <p className="label">Pays to</p>
          <div className="addrline">
            <code className="addr">{resolution.address}</code>
            {canCopy && <CopyButton text={resolution.address!} />}
          </div>
        </div>
      )}

      {resolution.status === "changed" && resolution.previous && (
        <div className="addrbox">
          <p className="label">Last time you saw</p>
          <code className="addr old">{resolution.previous.address}</code>
          {resolution.previous.pubkey !== resolution.pubkey && (
            <p className="muted">The name is also signed by a different Nostr key than before.</p>
          )}
        </div>
      )}

      {resolution.status === "not_found" && (
        <p className="muted">
          If this is your name, you can{" "}
          <a
            href="/identity"
            onClick={(e) => {
              e.preventDefault();
              navigate("/identity");
            }}
          >
            set it up here
          </a>
          .
        </p>
      )}

      {resolution.checks.length > 0 && (
        <details className="how">
          <summary>How we checked</summary>
          <ul className="checks">
            {resolution.checks.map((c) => (
              <li key={c.id} className={c.ok ? "ok" : "bad"}>
                <Icon name={c.ok ? "check" : "close"} />
                <span>
                  {c.label}
                  {c.detail && <span className="muted"> · {c.detail}</span>}
                </span>
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
