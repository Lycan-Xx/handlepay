/**
 * Receipt after a payment, with honest progress: Submitted → Seen → Confirmed.
 * It asks the network server about the transaction every few seconds and only
 * says "confirmed" once the transaction is in a block.
 */
import { useEffect, useState } from "react";
import { getTransaction, type BchNetwork } from "../lib/network";
import { paymentStage, receiptText, type PaymentStage, type Receipt as ReceiptData } from "../lib/paylink";
import { formatBch } from "../lib/wallet";

const POLL_MS = 5_000;
/** Stop asking after this long; the explorer link still works. */
const POLL_LIMIT_MS = 30 * 60_000;

const STEPS: { id: PaymentStage; label: string; hint: string }[] = [
  { id: "submitted", label: "Submitted", hint: "Your wallet signed it and it was sent." },
  { id: "seen", label: "Seen", hint: "The BCH network has it. The recipient's wallet can see it." },
  { id: "confirmed", label: "Confirmed", hint: "It's in a block. This is final." },
];

export function Receipt({ receipt, network }: { receipt: ReceiptData; network: BchNetwork }) {
  const [seen, setSeen] = useState(false);
  const [confirmations, setConfirmations] = useState(0);
  const [copied, setCopied] = useState(false);
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(receiptText(receipt, formatBch));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* clipboard blocked: the text is on screen to copy by hand */
    }
  };

  const currentIndex = STEPS.findIndex((s) => s.id === stage);

  return (
    <section className="card receipt" aria-live="polite">
      <h2>Payment sent</h2>
      <ol className="stages">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < currentIndex ? "done" : i === currentIndex ? "now" : ""}>
            <span aria-hidden>{i <= currentIndex ? "●" : "○"}</span> {s.label}
          </li>
        ))}
      </ol>
      <p className="muted">{STEPS[currentIndex].hint}</p>
      {receipt.broadcast?.status === "sent" && (
        <p className="muted">
          Your wallet signed this but didn't put it on {network} itself, so HandlePay sent it for you. That usually means
          the wallet is set to {network === "chipnet" ? "mainnet" : "chipnet"}; if it shows an error such as "missing
          inputs", that's why, and the payment above still went through.
        </p>
      )}
      {receipt.broadcast?.status === "replaced" && (
        <p className="muted">
          Your wallet sent its own version of this payment. This receipt shows the one that is on the network.
        </p>
      )}
      {receipt.broadcast?.status === "unverified" && stage === "submitted" && (
        <p className="warn">
          Your wallet approved this, but HandlePay can't see it on the network yet
          {receipt.broadcast.detail ? ` (the server said: ${receipt.broadcast.detail.split("\n").pop()})` : ""}. Check
          your wallet's history; this receipt updates if it appears.
        </p>
      )}

      <dl className="facts">
        <dt>To</dt>
        <dd>{receipt.handle}</dd>
        <dt>Amount</dt>
        <dd>
          {formatBch(receipt.sats)} {network === "chipnet" ? "tBCH" : "BCH"}
          {receipt.usd !== undefined && <span className="muted"> · about ${receipt.usd.toFixed(2)}</span>}
        </dd>
        {receipt.memo && (
          <>
            <dt>Memo</dt>
            <dd>{receipt.memo}</dd>
          </>
        )}
        <dt>Address</dt>
        <dd>
          <code>{receipt.address}</code>
        </dd>
        <dt>Network</dt>
        <dd>{receipt.network}</dd>
        <dt>Time</dt>
        <dd>{new Date(receipt.at).toLocaleString()}</dd>
        <dt>Transaction</dt>
        <dd>
          <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
            <code>
              {receipt.txid.slice(0, 12)}…{receipt.txid.slice(-10)}
            </code>
          </a>
        </dd>
      </dl>

      <button className="ghost" onClick={copy}>
        {copied ? "Copied" : "Copy receipt"}
      </button>
    </section>
  );
}
