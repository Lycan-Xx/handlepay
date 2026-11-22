/**
 * /tx/<txid>?network=<chipnet|mainnet>[&name=<full name>]: the public page
 * for checking a payment, and the target of every receipt's QR code.
 *
 * It reads the transaction from the same Fulcrum server the app trusts for
 * payments and proofs, checks it hashes to the txid in the URL, and keeps
 * three facts apart:
 *   1. it is on this network;
 *   2. it has N confirmations;
 *   3. (only with ?name=) the name resolves to an address this transaction
 *      paid, today. The chain proves the address, never the name, so this is
 *      re-checked live and worded as "today".
 *
 * Anyone can open this page, so it doesn't feature who paid: payer input
 * addresses appear only on the payer's printed receipt. A HandlePay identity
 * proof is the exception, because naming the address it was spent from is
 * the whole point of a proof.
 */
import { useEffect, useState } from "react";
import { NETWORK_LABEL } from "../lib/labels";
import { getTransaction, externalExplorers, type BchNetwork } from "../lib/network";
import { liveDeps, resolveHandle, type Resolution } from "../lib/resolve";
import { navigate, txPath } from "../lib/router";
import { describeTransaction, type TxView } from "../lib/txview";
import { formatBch } from "../lib/wallet";
import { CopyButton } from "../components/CopyButton";

const REFRESH_MS = 15_000;
/** Parents fetched to compute the fee (and name a proof's address); bigger transactions show what fits. */
const MAX_PARENTS = 25;

type Load =
  | { state: "loading" }
  | { state: "not_found"; message: string }
  | { state: "error"; message: string }
  | { state: "ok"; view: TxView; confirmations: number; at: number };

type NameMatch = { state: "checking" } | { state: "done"; resolution: Resolution } | { state: "error"; message: string };

export function TxPage(props: { txid: string; search: URLSearchParams; network: BchNetwork }) {
  const { txid, search } = props;
  const linkNetwork = search.get("network");
  // A shared link names its network; otherwise use the page's current one.
  const network: BchNetwork = linkNetwork === "mainnet" || linkNetwork === "chipnet" ? linkNetwork : props.network;
  const other: BchNetwork = network === "chipnet" ? "mainnet" : "chipnet";
  const name = search.get("name")?.trim() || null;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [match, setMatch] = useState<NameMatch>({ state: "checking" });
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let parents: Map<string, string> | null = null;

    const run = async () => {
      try {
        const tx = await getTransaction(network, txid);
        if (!parents) {
          const ids = [...new Set(describeTransaction(txid, tx.hex, network).inputs.map((i) => i.prevTxid))].slice(0, MAX_PARENTS);
          const found = await Promise.all(ids.map((id) => getTransaction(network, id).then((p) => [id, p.hex] as const, () => null)));
          parents = new Map(found.filter((f): f is readonly [string, string] => f !== null));
        }
        const view = describeTransaction(txid, tx.hex, network, parents);
        if (stopped) return;
        setLoad({ state: "ok", view, confirmations: tx.confirmations, at: Date.now() });
        if (tx.confirmations < 1) timer = setTimeout(run, REFRESH_MS);
      } catch (e) {
        if (stopped) return;
        const message = (e as Error).message;
        setLoad(/not found|no such|missing/i.test(message) ? { state: "not_found", message } : { state: "error", message });
      }
    };
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [txid, network]);

  // The name check: what does the name resolve to on this network, right now? (No pin: this isn't the payer's browser.)
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    resolveHandle(name, network, liveDeps(network))
      .then((r) => !cancelled && setMatch({ state: "done", resolution: r }))
      .catch((e: Error) => !cancelled && setMatch({ state: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [name, network]);

  const unit = network === "chipnet" ? "tBCH" : "BCH";
  const net = NETWORK_LABEL[network];
  const view = load.state === "ok" ? load.view : null;
  const paidAddresses = new Set(view?.outputs.map((o) => o.address).filter((a): a is string => !!a) ?? []);
  const proofs = view?.outputs.filter((o) => o.hpayPubkey) ?? [];

  const submitLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const id = lookup.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(id)) {
      setLookupError("A transaction ID is 64 letters and numbers (0-9, a-f).");
      return;
    }
    setLookup("");
    setLookupError(null);
    navigate(txPath(id, network));
  };

  return (
    <>
      <h2 className="page-title">Verify a payment</h2>
      <p className="page-lead">Read straight from the Bitcoin Cash chain, and checked against this transaction ID.</p>

      <section className="card">
        <p className="label">Transaction ID</p>
        <div className="copyrow">
          <code className="addr">{txid}</code>
          <CopyButton text={txid} />
        </div>

        <ol className="proof-facts" aria-live="polite">
          <li className={load.state === "ok" ? "ok" : load.state === "loading" ? "" : "bad"}>
            <span className="pf-mark" aria-hidden>
              {load.state === "ok" ? "✓" : load.state === "loading" ? "○" : "✗"}
            </span>
            <span>
              <b>
                {load.state === "ok"
                  ? `On ${net.name}`
                  : load.state === "loading"
                    ? `Looking for it on ${net.name}…`
                    : load.state === "not_found"
                      ? `Not on ${net.name}`
                      : "Couldn't check"}
              </b>
              <span className="muted small">
                {" "}
                {load.state === "ok"
                  ? `· ${net.detail}${linkNetwork && linkNetwork !== props.network ? " (from the link)" : ""}`
                  : load.state === "not_found"
                    ? `· It may be on ${NETWORK_LABEL[other].name}, or it was never broadcast.`
                    : load.state === "error"
                      ? `· ${load.message}`
                      : ""}
              </span>
            </span>
          </li>
          <li className={load.state !== "ok" ? "" : load.confirmations > 0 ? "ok" : "wait"}>
            <span className="pf-mark" aria-hidden>
              {load.state === "ok" && load.confirmations > 0 ? "✓" : "○"}
            </span>
            <span>
              <b>
                {load.state !== "ok"
                  ? "Confirmations"
                  : load.confirmations > 0
                    ? `${load.confirmations} confirmation${load.confirmations === 1 ? "" : "s"}`
                    : "0 confirmations: waiting for a block"}
              </b>
              {load.state === "ok" && load.confirmations < 1 && <span className="muted small"> · checks again every 15 seconds</span>}
            </span>
          </li>
          {name && (
            <li className={load.state === "ok" ? nameClass(match, paidAddresses) : ""}>
              <span className="pf-mark" aria-hidden>
                {load.state === "ok" ? nameMark(match, paidAddresses) : "○"}
              </span>
              <span>
                <b>
                  {load.state === "not_found" || load.state === "error"
                    ? `Can't compare ${name} without the transaction`
                    : nameHeadline(name, match, paidAddresses, view !== null)}
                </b>
                {load.state !== "not_found" && load.state !== "error" && (
                  <span className="muted small"> · {nameDetail(match, paidAddresses, view !== null, net.name)}</span>
                )}
              </span>
            </li>
          )}
        </ol>

        {load.state === "not_found" && (
          <button className="ghost" onClick={() => navigate(txPath(txid, other, name ?? undefined))}>
            Look on {NETWORK_LABEL[other].name}
          </button>
        )}

        {view && (
          <dl className="facts">
            <dt>Sent</dt>
            <dd>
              {formatBch(view.totalOut)} {unit}
            </dd>
            <dt>Network fee</dt>
            <dd>{view.fee !== undefined ? `${view.fee.toString()} sats (${view.feeRate} sat/byte)` : "Unknown (couldn't read every input)"}</dd>
            <dt>Size</dt>
            <dd>{view.size} bytes</dd>
          </dl>
        )}
        <p className="muted small">The chain records addresses and amounts, not names, and not the memo on a receipt.</p>
      </section>

      {view && (
        <>
          {proofs.length > 0 && (
            <section className="card verify tone-ok">
              <h2>HandlePay identity proof</h2>
              <p className="muted">
                This transaction commits a Nostr key to the address it was spent from. A name is Verified only when this proof
                and a binding signed by the same key point at each other.
              </p>
              {proofs.map((o) => (
                <dl className="facts" key={o.n}>
                  <dt>Format</dt>
                  <dd>HPAY version 1</dd>
                  <dt>Nostr key</dt>
                  <dd>
                    <code>{o.hpayPubkey}</code>
                  </dd>
                  <dt>Proves control of</dt>
                  <dd>
                    {[...new Set(view.inputs.map((i) => i.address ?? "unknown"))].map((a) => (
                      <code key={a}>{a}</code>
                    ))}
                  </dd>
                </dl>
              ))}
            </section>
          )}

          <section className="card">
            <h2>Paid to ({view.outputs.length})</h2>
            <ul className="io">
              {view.outputs.map((o) => (
                <li key={o.n}>
                  {o.address ? (
                    <code>{o.address}</code>
                  ) : o.hpayPubkey ? (
                    <span>HandlePay proof (data, no value)</span>
                  ) : o.hpayMalformed ? (
                    <span className="warn">Looks like a HandlePay proof but isn't in the exact format, so it doesn't count</span>
                  ) : o.data !== undefined ? (
                    <span>
                      Data: <code>{o.data.length > 80 ? `${o.data.slice(0, 80)}…` : o.data || "(empty)"}</code>
                    </span>
                  ) : (
                    <span className="muted">Non-standard output</span>
                  )}
                  <span className="amt">
                    {formatBch(o.sats)} {unit}
                    {o.hasToken ? " + tokens" : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {view.inputs.length} input{view.inputs.length === 1 ? "" : "s"}. Who paid isn't shown here; it's on the payer's
              own printed receipt.
            </p>
          </section>
        </>
      )}

      <section className="card">
        <h2>Check another payment</h2>
        <form onSubmit={submitLookup}>
          <label>
            Paste a transaction ID
            <input
              value={lookup}
              onChange={(e) => {
                setLookup(e.target.value);
                setLookupError(null);
              }}
              placeholder="64 characters, 0-9 and a-f"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={lookupError ? "lookup-error" : undefined}
            />
          </label>
          {lookupError && (
            <p id="lookup-error" className="err">
              {lookupError}
            </p>
          )}
          <button type="submit" className="ghost">
            Check on {net.name}
          </button>
        </form>
      </section>

      <p className="muted small">
        Second opinion:{" "}
        {externalExplorers(network, txid).map((x, i) => (
          <span key={x.url}>
            {i > 0 && " · "}
            <a href={x.url} target="_blank" rel="noreferrer">
              {x.name}
            </a>
          </span>
        ))}
      </p>
    </>
  );
}

const matches = (m: NameMatch, paid: Set<string>) => m.state === "done" && !!m.resolution.address && paid.has(m.resolution.address);

function nameClass(m: NameMatch, paid: Set<string>): string {
  if (m.state !== "done") return m.state === "error" ? "bad" : "";
  if (!matches(m, paid)) return "bad";
  return m.resolution.status === "verified" ? "ok" : "wait";
}

function nameMark(m: NameMatch, paid: Set<string>): string {
  if (m.state === "checking") return "○";
  return matches(m, paid) ? (m.state === "done" && m.resolution.status === "verified" ? "✓" : "!") : "✗";
}

function nameHeadline(name: string, m: NameMatch, paid: Set<string>, loaded: boolean): string {
  if (m.state === "checking" || !loaded) return `Checking ${name}…`;
  if (m.state === "error") return `Couldn't check ${name}`;
  if (!m.resolution.address || m.resolution.status === "not_found") return `${name} doesn't point to an address today`;
  return matches(m, paid) ? `${name} matches this address today` : `${name} now points to a different address`;
}

function nameDetail(m: NameMatch, paid: Set<string>, loaded: boolean, networkName: string): string {
  if (m.state === "checking" || !loaded) return "re-checking the name live";
  if (m.state === "error") return m.message;
  const r = m.resolution;
  if (!r.address || r.status === "not_found") return `it has no binding on ${networkName} right now`;
  if (!matches(m, paid)) return "this payment went to the address the name used before, or to someone else";
  return r.status === "verified"
    ? "Verified: the name proved it controls this address"
    : "but the name is Claimed, not proven, so treat the match with care";
}
