/**
 * /auth: sign in with a name, no password and no server (spec F4).
 *
 * 1. The page checks the name, so it knows which Nostr key the name uses.
 * 2. It makes a one-time challenge (32 random bytes).
 * 3. The user signs a kind-22242 event over that challenge and this site's
 *    origin with their Nostr extension.
 * 4. The page checks the signature, the challenge, the site, the age (5
 *    minutes) and that the key is the name's key.
 *
 * A real site would make and remember the challenge on its own server; this
 * page plays both sides so the whole exchange is visible.
 */
import { useEffect, useState } from "react";
import type { NostrEvent } from "nostr-tools/pure";
import { VerifyCard } from "../components/VerifyCard";
import { DEMO_HANDLES } from "../lib/attack";
import { AUTH_MAX_AGE_SEC, buildAuthTemplate, createChallenge, verifyAuthEvent, type AuthResult } from "../lib/auth";
import type { BchNetwork } from "../lib/network";
import { hasSigner } from "../lib/nostr";
import { hasBrowserKey, signerFor, signerHolding } from "../lib/signer";
import { liveDeps, resolveHandle, type Resolution } from "../lib/resolve";

const STATUS_WORDS: Record<Resolution["status"], string> = {
  verified: "Verified",
  claimed: "Claimed, not proven",
  changed: "Changed since your last visit",
  not_found: "Not found",
};

interface Attempt {
  event: NostrEvent;
  challenge: string;
  result: AuthResult;
  /** Set after "try replaying it": the same event checked against a new challenge. */
  replay?: AuthResult;
}

export function AuthPage({ network, search }: { network: BchNetwork; search: URLSearchParams }) {
  const [input, setInput] = useState(search.get("name") ?? DEMO_HANDLES[network]);
  const [handle, setHandle] = useState<string | null>(null);
  /** Bumped by "Check name" so checking the same name again re-runs the lookup. */
  const [lookups, setLookups] = useState(0);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(createChallenge);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    resolveHandle(handle, network, liveDeps(network))
      .then((r) => !cancelled && setResolution(r))
      .catch((e: Error) => !cancelled && setLookupError(e.message));
    return () => {
      cancelled = true;
    };
  }, [handle, network, lookups]);

  const check = (name: string) => {
    setResolution(null);
    setLookupError(null);
    setAttempt(null);
    setError(null);
    setHandle(name);
    setLookups((n) => n + 1);
  };

  const signIn = async () => {
    if (!resolution?.pubkey) return;
    setSigning(true);
    setError(null);
    setAttempt(null);
    const used = challenge;
    try {
      // Sign with whichever key holds this name. If none does, still ask the extension, so signing with the
      // wrong key shows up as a failed check rather than being silently refused here.
      const signer = (await signerHolding(resolution.pubkey)) ?? signerFor("extension");
      const event = await signer.sign(buildAuthTemplate(used, window.location.origin));
      const result = verifyAuthEvent(event, { challenge: used, origin: window.location.origin, pubkey: resolution.pubkey });
      setAttempt({ event, challenge: used, result });
    } catch (e) {
      const message = (e as Error).message;
      setError(/reject|denied|cancel/i.test(message) ? "Sign-in cancelled in your Nostr extension." : message);
    } finally {
      // A challenge is good for one try, whatever happened.
      setChallenge(createChallenge());
      setSigning(false);
    }
  };

  const replay = () => {
    if (!attempt || !resolution?.pubkey) return;
    const result = verifyAuthEvent(attempt.event, { challenge, origin: window.location.origin, pubkey: resolution.pubkey });
    setAttempt({ ...attempt, replay: result });
  };

  const canSign = !!resolution?.pubkey && resolution.status !== "not_found";

  return (
    <>
      <p className="journey-kicker page-kicker">A demo of a site's login</p>
      <h2 className="page-title">Your name as a login</h2>
      <section className="card">
        <p className="muted">
          No password and no account. The site checks your name, gives you a one-time code, and you sign it with your
          name's key (kept in this browser or in a Nostr extension). If the signature comes from the key your name points
          to, you're in.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) check(input.trim());
          }}
        >
          <label>
            Your name
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={DEMO_HANDLES[network]} />
          </label>
          <button type="submit" disabled={!input.trim()}>
            Check name
          </button>
        </form>
      </section>

      {handle && (
        <VerifyCard handle={handle} network={network} resolution={resolution} error={lookupError} onRetry={() => check(handle)} />
      )}

      {resolution && resolution.status === "not_found" && (
        <p className="warn">This name has no HandlePay identity, so there's no key to sign in with.</p>
      )}

      {canSign && (
        <section className="card">
          <h2>Sign the challenge</h2>
          <p className="label">This site's one-time code</p>
          <code className="addr">{challenge}</code>
          <p className="muted small">
            Your key signs this code together with this site's address ({window.location.origin}), so a signature
            made here can't be used on another site. It expires after {AUTH_MAX_AGE_SEC / 60} minutes.
          </p>
          {hasSigner() || hasBrowserKey() ? (
            <button onClick={signIn} disabled={signing}>
              {signing ? "Signing…" : `Sign in as ${resolution.handle?.full ?? handle}`}
            </button>
          ) : (
            <p className="warn">
              No key found in this browser. Set up a free name on Get paid (it makes one), or install a Nostr extension like
              nos2x or Alby, then reload this page.
            </p>
          )}
          {error && <p className="err">{error}</p>}
        </section>
      )}

      {attempt && resolution && (
        <section className={`card verify ${attempt.result.ok ? "tone-ok" : "tone-amber"}`} aria-live="polite">
          {attempt.result.ok ? (
            <>
              <p className="badge">
                <span aria-hidden>✓</span> Signed in as {resolution.handle?.full}
              </p>
              <p className="muted">
                Name: {STATUS_WORDS[resolution.status]}
                {resolution.status !== "verified" && resolution.reason ? ` (${resolution.reason})` : ""}
              </p>
              <ul className="checks">
                {[
                  "Signature is valid",
                  "Signed this page's one-time code",
                  `Signed for ${window.location.origin}`,
                  `Signed within the last ${AUTH_MAX_AGE_SEC / 60} minutes`,
                  "Signed with the key this name points to",
                ].map((label) => (
                  <li key={label} className="ok">
                    <span aria-hidden>✓</span> {label}
                  </li>
                ))}
              </ul>
              {attempt.replay ? (
                <p className={attempt.replay.ok ? "err" : "muted"}>
                  Replaying the same signature against the next code:{" "}
                  <strong>{attempt.replay.ok ? "accepted (this would be a bug)" : `refused · ${attempt.replay.reason}`}</strong>
                </p>
              ) : (
                <button className="ghost" onClick={replay}>
                  Try replaying this signature
                </button>
              )}
            </>
          ) : (
            <>
              <p className="badge">
                <span aria-hidden>✗</span> Not signed in
              </p>
              <p className="muted">
                {attempt.result.reason}.{" "}
                {attempt.result.reason.startsWith("Signed with a key")
                  ? `Your extension signed with a different key than ${resolution.handle?.full} uses. Switch keys in the extension and try again.`
                  : "Press sign in again for a new code."}
              </p>
            </>
          )}
          <details className="how">
            <summary>The signed message</summary>
            <pre className="addr">{JSON.stringify(attempt.event, null, 2)}</pre>
          </details>
        </section>
      )}

      <p className="muted small">
        On a real site the server makes and remembers the code, and checks the answer. This page does both sides so you
        can watch the whole exchange.
      </p>
    </>
  );
}
