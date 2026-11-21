/**
 * Amount → memo → connect → approve → receipt, for a name the page has already
 * decided may be paid. The recipient is the `address` prop, which comes only
 * from the resolver; nothing on this panel can change it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Wallet } from "../hooks/useWallet";
import { satsToUsd, usdToSats } from "../lib/amount";
import { explorerTx, type BchNetwork } from "../lib/network";
import { MEMO_MAX, cleanMemo, parseBchAmount, paymentErrorMessage, type PayParams, type Receipt as ReceiptData } from "../lib/paylink";
import { getUsdPerBch, type Price } from "../lib/price";
import { DUST_SATS, formatBch, sendBch } from "../lib/wallet";
import { Receipt } from "./Receipt";

/** After this long with no answer, remind the payer to open their wallet. */
const SLOW_WALLET_MS = 90_000;

type Unit = "usd" | "bch";

export function PayPanel(props: {
  wallet: Wallet;
  network: BchNetwork;
  handle: string;
  address: string;
  params: PayParams;
  /** Called once a payment has gone out, so the page can move its step strip to Receipt. */
  onSent?: () => void;
}) {
  const { wallet, network, handle, address, params, onSent } = props;
  const { wc, connected, restoring, connect, receiveAddress, changeAddress, coins, balance, scanned, loading } = wallet;

  const amountFixed = params.amountUsd !== null;
  const [unit, setUnit] = useState<Unit>("usd");
  const [amountText, setAmountText] = useState(params.amountUsd !== null ? String(params.amountUsd) : "");
  const [memo, setMemo] = useState(params.memo ?? "");
  const [price, setPrice] = useState<Price | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const [phase, setPhase] = useState<"idle" | "approving">("idle");
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUsdPerBch()
      .then((p) => !cancelled && setPrice(p))
      .catch((e: Error) => {
        if (cancelled) return;
        setPriceError(e.message);
        // Without a price a dollar amount can't be converted; offer BCH instead.
        if (!amountFixed) setUnit("bch");
      });
    return () => {
      cancelled = true;
    };
  }, [amountFixed]);

  // Leaving the page while a request is open cancels it in the wallet.
  useEffect(() => () => abortRef.current?.abort(), []);

  /** The amount in satoshis, or a sentence saying what's wrong with it. */
  const amount = useMemo((): { sats: bigint; usd?: number } | { problem: string } | null => {
    if (!amountText.trim()) return null;
    if (unit === "bch") {
      const sats = parseBchAmount(amountText);
      if (sats === null) return { problem: "Enter an amount in BCH, like 0.0005." };
      if (sats < DUST_SATS) return { problem: `The smallest payment is ${DUST_SATS} sats (${formatBch(DUST_SATS)} BCH).` };
      return { sats, ...(price ? { usd: satsToUsd(sats, price.usdPerBch) } : {}) };
    }
    const usd = Number(amountText.trim().replace(/^\$/, ""));
    if (!/^\$?\d+(\.\d{1,2})?$/.test(amountText.trim()) || !(usd > 0)) return { problem: "Enter a dollar amount, like 0.25." };
    if (!price) return priceError ? { problem: priceError } : { problem: "Getting the BCH price…" };
    try {
      return { sats: usdToSats(usd, price.usdPerBch), usd };
    } catch (e) {
      return { problem: (e as Error).message };
    }
  }, [amountText, unit, price, priceError]);

  const ready = amount && "sats" in amount ? amount : null;
  const unitLabel = network === "chipnet" ? "tBCH" : "BCH";
  const label = ready
    ? unit === "usd" && ready.usd !== undefined
      ? `$${ready.usd.toFixed(2)}`
      : `${formatBch(ready.sats)} ${unitLabel}`
    : "";

  const pay = async () => {
    if (!ready || !wc.manager || !changeAddress) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const slowTimer = setTimeout(() => setSlow(true), SLOW_WALLET_MS);
    setPhase("approving");
    setSlow(false);
    setError(null);
    const cleanedMemo = cleanMemo(memo);
    try {
      const { txid, broadcast } = await sendBch({
        manager: wc.manager,
        network,
        coins,
        to: address,
        amount: ready.sats,
        changeAddress,
        userPrompt: `HandlePay: pay ${handle}${cleanedMemo ? ` · ${cleanedMemo}` : ""}`,
        signal: controller.signal,
      });
      setReceipt({
        handle,
        address,
        sats: ready.sats,
        usd: ready.usd,
        memo: cleanedMemo,
        txid,
        network,
        at: Date.now(),
        explorerUrl: explorerTx(network, txid),
        broadcast: { status: broadcast.status, detail: broadcast.detail },
      });
      setTimeout(wallet.refresh, 3_000);
      onSent?.();
    } catch (e) {
      setError(paymentErrorMessage(e, controller.signal.aborted, network));
    } finally {
      clearTimeout(slowTimer);
      abortRef.current = null;
      setPhase("idle");
    }
  };

  if (receipt) return <Receipt receipt={receipt} network={network} />;

  const emptyWallet = (connected || restoring) && scanned && !loading && balance === 0n;

  return (
    <section className="card pay">
      <h2>Pay {handle}</h2>

      <div className="amount-row">
        <label className="grow">
          Amount {unit === "usd" ? "(USD)" : `(${unitLabel})`}
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="decimal"
            placeholder={unit === "usd" ? "0.25" : "0.0005"}
            readOnly={amountFixed}
            aria-describedby="amount-help"
          />
        </label>
        {!amountFixed && (
          <div className="net unit" role="group" aria-label="Currency">
            {(["usd", "bch"] as const).map((u) => (
              <button
                key={u}
                type="button"
                className={u === unit ? "on" : ""}
                aria-pressed={u === unit}
                disabled={u === "usd" && !price}
                onClick={() => {
                  setUnit(u);
                  setAmountText("");
                }}
              >
                {u === "usd" ? "USD" : unitLabel}
              </button>
            ))}
          </div>
        )}
      </div>
      <p id="amount-help" className="muted">
        {ready
          ? unit === "usd"
            ? `≈ ${formatBch(ready.sats)} ${unitLabel}`
            : ready.usd !== undefined
              ? `≈ $${ready.usd.toFixed(2)}`
              : ""
          : amount && "problem" in amount
            ? amount.problem
            : amountFixed
              ? ""
              : "Enter how much to send."}
        {amountFixed && " · set by this pay link"}
      </p>
      {params.badAmount && (
        <p className="warn">This link's amount ("{params.badAmount}") isn't a valid dollar amount. Enter one yourself.</p>
      )}
      {network === "chipnet" && price && (
        <p className="muted small">Test coins have no value; dollar figures use the real BCH price.</p>
      )}

      <label>
        Memo (optional, kept on your receipt only)
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={MEMO_MAX}
          readOnly={!!params.memo}
          placeholder="Invoice 7"
        />
      </label>

      {!connected && !restoring ? (
        <>
          <button onClick={connect}>
            {wc.state === "connecting" || wc.state === "reconnecting" ? "Show QR" : "Connect wallet to pay"}
          </button>
          <p className="need">
            <b>You'll need a Bitcoin Cash wallet</b> that works with WizardConnect: Paytaca, Cashonize or Selene. Scan the
            code with it, and set it to {network === "mainnet" ? "mainnet (real money)" : "chipnet (practice coins)"}.
            HandlePay never holds your money or keys.
          </p>
          {wc.error && <p className="err">{wc.error}</p>}
        </>
      ) : (
        <>
          <p className="wallet-chip">
            Paying from <strong>{wc.walletName ?? "your wallet"}</strong>
            {scanned && (
              <span className="muted">
                {" "}
                · {formatBch(balance)} {unitLabel}
              </span>
            )}
            {restoring && <span className="muted"> · reconnecting…</span>}{" "}
            <button className="link" onClick={() => wc.disconnect()} disabled={phase === "approving"}>
              Disconnect
            </button>
          </p>

          {!receiveAddress && <p className="muted">Waiting for your wallet to share its keys…</p>}
          {restoring && (
            <p className="muted small">
              Waiting for {wc.walletName ?? "your wallet"} to answer before it can sign. If this takes more than a few
              seconds, open the wallet app.
            </p>
          )}

          {emptyWallet && (
            <p className="warn">
              No coins found. If your wallet is on {network === "chipnet" ? "mainnet" : "chipnet"}, switch it to{" "}
              {network}, or switch this page.
              {network === "chipnet" && (
                <>
                  {" "}
                  Need test coins? Use{" "}
                  <a href="https://tbch.googol.cash/" target="_blank" rel="noreferrer">
                    tbch.googol.cash
                  </a>{" "}
                  with the network set to chipnet.
                </>
              )}
            </p>
          )}

          {phase === "approving" ? (
            <div className="approving" aria-live="polite">
              <p>
                <span className="spinner" aria-hidden /> Approve the payment in {wc.walletName ?? "your wallet"}…
              </p>
              {slow && <p className="warn">Still waiting. Open your wallet app and look for the request.</p>}
              <button className="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={pay} disabled={!connected || !ready || !changeAddress || !coins.length}>
              {ready ? `Pay ${label} to ${handle}` : "Pay"}
            </button>
          )}
        </>
      )}

      {error && <p className="err">{error}</p>}
      {wallet.error && <p className="err">{wallet.error}</p>}
    </section>
  );
}
