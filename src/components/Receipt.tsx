/**
 * The receipt after a payment: a plain document, with honest progress
 * (Submitted → Seen → Confirmed). It asks the network server about the
 * transaction every few seconds and only says "Payment successful" once the
 * transaction is in a block.
 *
 * The txid is the reference. There is no HandlePay receipt number and no
 * copy kept anywhere but this page: the QR and link point to the public
 * /tx page, which re-reads the transaction from the chain and re-checks that
 * the name still resolves to the address paid.
 *
 * Print and Download both open the browser's print dialog ("Save as PDF");
 * the print stylesheet shows only this receipt, the full txid, and the
 * payer's own input addresses, which never appear on screen or on /tx.
 */
import { useEffect, useMemo, useState } from "react";
import { NETWORK_LABEL } from "../lib/labels";
import { getTransaction, type BchNetwork } from "../lib/network";
import { paymentStage, receiptText, type PaymentStage, type Receipt as ReceiptData } from "../lib/paylink";
import { qrSvg } from "../lib/qr";
import { navigate, txPath } from "../lib/router";
import { formatBch } from "../lib/wallet";
import { CopyButton } from "./CopyButton";

const POLL_MS = 5_000;
/** Stop asking after this long; the explorer link still works. */
const POLL_LIMIT_MS = 30 * 60_000;

const STEPS: { id: PaymentStage; label: string; hint: string }[] = [
  { id: "submitted", label: "Submitted", hint: "Your wallet signed it and HandlePay sent it to the network." },
  { id: "seen", label: "Seen", hint: "The BCH network has it. The recipient's wallet can see it." },
  { id: "confirmed", label: "Confirmed", hint: "It's in a block. This is final." },
];

export function Receipt({ receipt, network }: { receipt: ReceiptData; network: BchNetwork }) {
  const [seen, setSeen] = useState(false);
  const [confirmations, setConfirmations] = useState(0);
  const stage = paymentStage(seen, confirmations);

  useEffect(() => {
    if (stage === "confirmed") return;
    let stopped = false;
    const started = Date.now();
    const check = async () => {
      try {
        const tx = await getTransaction(network, receipt.txid);
        if (stopped) return;
        setSeen(true);
        setConfirmations(tx.confirmations);
      } catch {
        /* not visible yet */
      }
    };
    check();
    const timer = setInterval(() => {
      if (Date.now() - started > POLL_LIMIT_MS) clearInterval(timer);
      else check();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [network, receipt.txid, stage]);

  const verifyPath = txPath(receipt.txid, network, receipt.handle);
  const verifyUrl = `${window.location.origin}${verifyPath}`;
  // Built from our own origin, a hex txid, the network and a name already checked by the resolver.
  const qr = useMemo(() => qrSvg(verifyUrl), [verifyUrl]);
  const currentIndex = STEPS.findIndex((s) => s.id === stage);
  const confirmed = stage === "confirmed";
  const unit = network === "chipnet" ? "tBCH" : "BCH";
  const net = NETWORK_LABEL[network];

  return (
    <section className="card receipt" aria-live="polite">
      <div className="receipt-head">
        <div className={`tick ${confirmed ? "" : "pending"}`} aria-hidden>
          {confirmed ? "✓" : "…"}
        </div>
        <div>
          <h2>{confirmed ? "Payment successful" : "Payment pending"}</h2>
          <p className="muted small">
            {confirmed
              ? `Confirmed · ${confirmations} confirmation${confirmations === 1 ? "" : "s"}`
              : `${STEPS[currentIndex].label} · not confirmed yet`}
          </p>
        </div>
      </div>

      <ol className="stages no-print">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < currentIndex ? "done" : i === currentIndex ? "now" : ""}>
            <span aria-hidden>{i <= currentIndex ? "●" : "○"}</span> {s.label}
          </li>
        ))}
      </ol>
      <p className="muted no-print">{STEPS[currentIndex].hint}</p>
      {receipt.broadcast?.status === "replaced" && (
        <p className="muted">Your wallet sent its own version of this payment. This receipt shows the one that is on the network.</p>
      )}
      {receipt.broadcast?.status === "unverified" && stage === "submitted" && (
        <p className="warn">
          Your wallet approved this, but HandlePay can't see it on the network yet
          {receipt.broadcast.detail ? ` (the server said: ${receipt.broadcast.detail.split("\n").pop()})` : ""}. Check your
          wallet's history; this receipt updates if it appears.
        </p>
      )}

      <dl className="facts">
        <dt>Paid to</dt>
        <dd>
          <strong>{receipt.handle}</strong>
        </dd>
        <dt>Address</dt>
        <dd>
          <code>{receipt.address}</code>
        </dd>
        <dt>Amount</dt>
        <dd>
          {formatBch(receipt.sats)} {unit}
          {receipt.usd !== undefined && <span className="muted"> · about ${receipt.usd.toFixed(2)}</span>}
        </dd>
        {receipt.memo && (
          <>
            <dt>Memo</dt>
            <dd>
              {receipt.memo} <span className="muted small">(kept on this receipt only, not on the chain)</span>
            </dd>
          </>
        )}
        <dt>Network</dt>
        <dd>
          {net.name} · {net.detail}
        </dd>
        <dt>Date</dt>
        <dd>{new Date(receipt.at).toLocaleString()}</dd>
        {receipt.fee !== undefined && (
          <>
            <dt>Network fee</dt>
            <dd>{receipt.fee.toString()} sats</dd>
          </>
        )}
        <dt>Transaction</dt>
        <dd>
          <a className="no-print" href={receipt.explorerUrl} target="_blank" rel="noreferrer">
            <code>
              {receipt.txid.slice(0, 12)}…{receipt.txid.slice(-10)}
            </code>
          </a>
          <code className="print-only">{receipt.txid}</code>
        </dd>
        {receipt.payerAddresses && receipt.payerAddresses.length > 0 && (
          <>
            <dt className="print-only">Paid from</dt>
            <dd className="print-only">
              {receipt.payerAddresses.map((a) => (
                <code key={a}>{a}</code>
              ))}
            </dd>
          </>
        )}
      </dl>

      <div className="receipt-verify">
        <div className="qr receipt-qr" role="img" aria-label="QR code to verify this payment" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="muted small">
          Scan or open the link to check this payment on the chain. The chain proves the address was paid; the page also
          checks whether {receipt.handle} still points to it today.
          <span className="print-only"> {verifyUrl}</span>
        </p>
      </div>

      <div className="strip-actions no-print">
        <button onClick={() => window.print()}>Print receipt</button>
        <button className="ghost" onClick={() => window.print()} title="Choose “Save as PDF” in the print dialog">
          Download receipt
        </button>
        <a
          className="button ghost"
          href={verifyPath}
          onClick={(e) => {
            e.preventDefault();
            navigate(verifyPath);
          }}
        >
          View on the chain
        </a>
        <CopyButton text={receiptText(receipt, formatBch)} label="Copy as text" />
      </div>
      <p className="muted small no-print">Download opens your browser's print dialog: choose "Save as PDF". Nothing is uploaded.</p>
    </section>
  );
}
