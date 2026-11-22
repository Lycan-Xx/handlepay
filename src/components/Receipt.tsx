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
 * Print and Download both open the browser's print dialog ("Save as PDF").
 * The printed copy is the payer's record, so it holds every detail: status
 * and when it was checked, name, address, BCH and USD, memo, network, date
 * with time zone, fee, the full txid, the payer's own input addresses (never
 * shown on screen or on /tx), and the QR with its URL written out. A detail
 * that isn't known is printed as unknown rather than left out.
 */
import { useEffect, useMemo, useState } from "react";
import { NETWORK_LABEL } from "../lib/labels";
import { getTransaction, type BchNetwork } from "../lib/network";
import { paymentStage, receiptText, type PaymentStage, type Receipt as ReceiptData } from "../lib/paylink";
import { qrSvg } from "../lib/qr";
import { navigate, txPath } from "../lib/router";
import { formatBch } from "../lib/wallet";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";

const POLL_MS = 5_000;
/** Stop asking after this long; the explorer link still works. */
const POLL_LIMIT_MS = 30 * 60_000;

const STEPS: { id: PaymentStage; label: string; hint: string }[] = [
  { id: "submitted", label: "Submitted", hint: "Your wallet signed it and HandlePay sent it to the network." },
  { id: "seen", label: "Seen", hint: "The BCH network has it. The recipient's wallet can see it." },
  { id: "confirmed", label: "Confirmed", hint: "It's in a block. This is final." },
];

/** A date a reader in any country can't misread: long month, time and time zone. */
const fullDate = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "long", timeStyle: "long" });

export function Receipt({ receipt, network }: { receipt: ReceiptData; network: BchNetwork }) {
  const [seen, setSeen] = useState(false);
  const [confirmations, setConfirmations] = useState(0);
  /** When the status above was last read from the network; printed so a paper copy says how fresh it is. */
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const stage = paymentStage(seen, confirmations);

  const check = async (): Promise<void> => {
    try {
      const tx = await getTransaction(network, receipt.txid);
      setSeen(true);
      setConfirmations(tx.confirmations);
    } catch {
      /* not visible yet */
    }
    setCheckedAt(Date.now());
  };

  useEffect(() => {
    if (stage === "confirmed") return;
    let stopped = false;
    const started = Date.now();
    const poll = async () => {
      try {
        const tx = await getTransaction(network, receipt.txid);
        if (stopped) return;
        setSeen(true);
        setConfirmations(tx.confirmations);
      } catch {
        /* not visible yet */
      }
      if (!stopped) setCheckedAt(Date.now());
    };
    poll();
    const timer = setInterval(() => {
      if (Date.now() - started > POLL_LIMIT_MS) clearInterval(timer);
      else poll();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [network, receipt.txid, stage]);

  /** Read the status once more so the printed copy is current, then open the print dialog. */
  const print = async () => {
    setPrinting(true);
    await check();
    setPrinting(false);
    // Let React paint the fresh status before the dialog snapshots the page.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  const verifyPath = txPath(receipt.txid, network, receipt.handle);
  const verifyUrl = `${window.location.origin}${verifyPath}`;
  // Built from our own origin, a hex txid, the network and a name already checked by the resolver.
  const qr = useMemo(() => qrSvg(verifyUrl), [verifyUrl]);
  const currentIndex = STEPS.findIndex((s) => s.id === stage);
  const confirmed = stage === "confirmed";
  const unit = network === "chipnet" ? "tBCH" : "BCH";
  const net = NETWORK_LABEL[network];
  const replaced = receipt.broadcast?.status === "replaced";
  const statusLine = confirmed
    ? `Confirmed · ${confirmations} confirmation${confirmations === 1 ? "" : "s"}`
    : `Pending · ${STEPS[currentIndex].label} · 0 confirmations`;

  return (
    <section className="card receipt" aria-live="polite">
      <p className="print-only receipt-doc-title">
        <img src="/brand/logo-64.png" width="20" height="20" alt="" /> HandlePay · Payment receipt
      </p>
      <div className="receipt-head">
        <div className={`tick ${confirmed ? "" : "pending"}`}>
          <Icon name={confirmed ? "check" : "hourglass_top"} />
        </div>
        <div>
          <h2>{confirmed ? "Payment successful" : "Payment pending"}</h2>
          <p className="muted small">{statusLine}</p>
        </div>
      </div>

      <ol className="stages no-print">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < currentIndex ? "done" : i === currentIndex ? "now" : ""}>
            <Icon name={i <= currentIndex ? "check" : "radio_button_unchecked"} /> {s.label}
          </li>
        ))}
      </ol>
      <p className="muted no-print">{STEPS[currentIndex].hint}</p>
      {replaced && (
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
        <dt>Status</dt>
        <dd>
          {statusLine}
          {checkedAt !== null && <span className="muted small"> (checked {fullDate(checkedAt)})</span>}
        </dd>
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
          <span className="muted">
            {receipt.usd !== undefined ? ` · about $${receipt.usd.toFixed(2)} USD at the time of paying` : " · no USD price was available"}
          </span>
        </dd>
        <dt>Memo</dt>
        <dd>
          {receipt.memo ?? <span className="muted">None</span>}
          {receipt.memo && <span className="muted small"> (kept on this receipt only, not on the chain)</span>}
        </dd>
        <dt>Network</dt>
        <dd>
          {net.name} · {net.detail}
        </dd>
        <dt>Date</dt>
        <dd>{fullDate(receipt.at)}</dd>
        <dt>Network fee</dt>
        <dd>
          {receipt.fee !== undefined ? (
            `${receipt.fee.toString()} sats (${formatBch(receipt.fee)} ${unit})`
          ) : (
            <span className="muted">Unknown{replaced ? ": your wallet sent its own version of this payment" : ""}</span>
          )}
        </dd>
        <dt>Transaction ID</dt>
        <dd>
          <a className="no-print" href={receipt.explorerUrl} target="_blank" rel="noreferrer">
            <code>
              {receipt.txid.slice(0, 12)}…{receipt.txid.slice(-10)}
            </code>{" "}
            <Icon name="open_in_new" label="opens in a new tab" />
          </a>
          <code className="print-only">{receipt.txid}</code>
        </dd>
        <dt className="print-only">Paid from</dt>
        <dd className="print-only">
          {receipt.payerAddresses && receipt.payerAddresses.length > 0 ? (
            receipt.payerAddresses.map((a) => <code key={a}>{a}</code>)
          ) : (
            <span>Not recorded{replaced ? ": your wallet sent its own version of this payment" : ""}</span>
          )}
        </dd>
      </dl>

      <div className="receipt-verify">
        <div className="qr receipt-qr" role="img" aria-label="QR code to verify this payment" dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="receipt-verify-text">
          <p className="muted small">
            Scan or open the link to check this payment on the chain. The chain proves the address was paid; the page also
            checks whether {receipt.handle} still points to it today.
          </p>
          <p className="print-only receipt-url">{verifyUrl}</p>
        </div>
      </div>
      <p className="print-only small receipt-foot">
        HandlePay keeps no copy of this receipt. The transaction ID above is the reference; anyone can check it on the
        chain.
      </p>

      <div className="strip-actions no-print">
        <button onClick={print} disabled={printing}>
          <Icon name="print" /> Print receipt
        </button>
        <button className="ghost" onClick={print} disabled={printing}>
          <Icon name="download" /> Download receipt
        </button>
        <a
          className="button ghost"
          href={verifyPath}
          onClick={(e) => {
            e.preventDefault();
            navigate(verifyPath);
          }}
        >
          <Icon name="verified" /> View on the chain
        </a>
        <CopyButton text={receiptText(receipt, formatBch)} label="Copy as text" />
      </div>
      <p className="muted small no-print">Download opens your browser's print dialog: choose "Save as PDF". Nothing is uploaded.</p>
    </section>
  );
}
