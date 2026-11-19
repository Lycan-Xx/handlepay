/**
 * /tx/<txid>?network=<chipnet|mainnet>: HandlePay's own transaction page.
 *
 * Reads the transaction from the same Fulcrum server the app trusts for
 * payments and proofs, checks it hashes to the txid in the URL, and shows it
 * in plain terms: confirmations, who paid, who got paid, the fee, and any
 * HandlePay proof it carries. It refreshes until the transaction is confirmed.
 */
import { useEffect, useState } from "react";
import { getTransaction, externalExplorers, type BchNetwork } from "../lib/network";
import { navigate } from "../lib/router";
import { describeTransaction, type TxView } from "../lib/txview";
import { formatBch } from "../lib/wallet";

const REFRESH_MS = 15_000;
/** Parents fetched to show input addresses and the fee; bigger transactions show what fits. */
const MAX_PARENTS = 25;

type Load =
  | { state: "loading" }
  | { state: "not_found"; message: string }
  | { state: "error"; message: string }
  | { state: "ok"; view: TxView; confirmations: number; at: number };

export function TxPage(props: { txid: string; search: URLSearchParams; network: BchNetwork }) {
  const { txid, search } = props;
  const linkNetwork = search.get("network");
  // A shared link names its network; otherwise use the page's current one.
  const network: BchNetwork = linkNetwork === "mainnet" || linkNetwork === "chipnet" ? linkNetwork : props.network;
  const other: BchNetwork = network === "chipnet" ? "mainnet" : "chipnet";
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [copied, setCopied] = useState(false);

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
        setLoad(
          /not found|no such|missing/i.test(message)
            ? { state: "not_found", message }
            : { state: "error", message },
        );
      }
    };
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [txid, network]);

  const unit = network === "chipnet" ? "tBCH" : "BCH";
  const copyTxid = async () => {
    try {
      await navigator.clipboard.writeText(txid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* clipboard blocked: the id is on screen */
    }
  };

  return (
    <>
      <section className="card">
        <h2>Transaction</h2>
        <p className="mono-wrap">
          <code>{txid}</code>{" "}
          <button className="link" onClick={copyTxid}>
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
        <p className="muted small">
          On {network}
          {linkNetwork && linkNetwork !== props.network ? " (from the link)" : ""} · read from the BCH network server and
          checked against this id
        </p>

        {load.state === "loading" && (
          <p className="badge" aria-live="polite">
            <span className="spinner" aria-hidden /> Looking it up…
          </p>
        )}

        {load.state === "not_found" && (
          <div aria-live="polite">
            <p className="badge">
              <span aria-hidden>–</span> Not on {network}
            </p>
            <p className="muted">
              The {network} server doesn't know this transaction. It may be on {other}, or it was never broadcast.
            </p>
            <button className="ghost" onClick={() => navigate(`/tx/${txid}?network=${other}`)}>
              Look on {other}
            </button>
          </div>
        )}

        {load.state === "error" && (
          <p className="err" aria-live="polite">
            Couldn't load it: {load.message}
          </p>
        )}

        {load.state === "ok" && (
          <div aria-live="polite">
            <p className={`badge ${load.confirmations > 0 ? "good" : "amber"}`}>
              {load.confirmations > 0 ? (
                <>
                  <span aria-hidden>✓</span> Confirmed · {load.confirmations} confirmation{load.confirmations === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  <span aria-hidden>…</span> Waiting for a block (in the mempool)
                </>
              )}
            </p>
            {load.confirmations < 1 && <p className="muted small">This page checks again every 15 seconds.</p>}

            <dl className="facts">
              <dt>Sent</dt>
              <dd>
                {formatBch(load.view.totalOut)} {unit}
              </dd>
              <dt>Fee</dt>
              <dd>
                {load.view.fee !== undefined
                  ? `${load.view.fee.toString()} sats (${load.view.feeRate} sat/byte)`
                  : "Unknown (couldn't read every input)"}
              </dd>
              <dt>Size</dt>
              <dd>{load.view.size} bytes</dd>
            </dl>
          </div>
        )}
      </section>

      {load.state === "ok" && (
        <>
          {load.view.outputs.some((o) => o.hpayPubkey) && (
            <section className="card verify tone-ok">
              <h2>HandlePay identity proof</h2>
              <p className="muted">
                This transaction commits a Nostr key to the address it was paid from. A name is Verified only when this
                proof and a binding signed by the same key point at each other.
              </p>
              {load.view.outputs
                .filter((o) => o.hpayPubkey)
                .map((o) => (
                  <dl className="facts" key={o.n}>
                    <dt>Format</dt>
                    <dd>HPAY version 1</dd>
                    <dt>Nostr key</dt>
                    <dd>
                      <code>{o.hpayPubkey}</code>
                    </dd>
                    <dt>Proves control of</dt>
                    <dd>
                      {[...new Set(load.view.inputs.map((i) => i.address ?? "unknown"))].map((a) => (
                        <code key={a}>{a}</code>
                      ))}
                    </dd>
                  </dl>
                ))}
            </section>
          )}

          <section className="card">
            <h2>From ({load.view.inputs.length})</h2>
            <ul className="io">
              {load.view.inputs.map((i, k) => (
                <li key={k}>
                  {i.address ? <code>{i.address}</code> : <span className="muted">Unknown address</span>}
                  <span className="amt">
                    {i.sats !== undefined ? `${formatBch(i.sats)} ${unit}` : ""}
                  </span>
                  <a
                    className="small"
                    href={`/tx/${i.prevTxid}?network=${network}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/tx/${i.prevTxid}?network=${network}`);
                    }}
                  >
                    from {i.prevTxid.slice(0, 8)}…:{i.vout}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>To ({load.view.outputs.length})</h2>
            <ul className="io">
              {load.view.outputs.map((o) => (
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
          </section>
        </>
      )}

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
