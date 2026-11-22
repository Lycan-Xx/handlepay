/**
 * Amount → connect → review → approve in the wallet → receipt, for a name the
 * page has already decided may be paid. The recipient is the `address` prop,
 * which comes only from the resolver; nothing on this panel can change it.
 *
 * Review sits after the wallet connects and before the signing request, so
 * the payer sees the name, address, dollars, BCH, network, memo and fee in
 * one place; the wallet's own screen is still the final check. The fee shown
 * there is a preview made with the same coin selection and builder the send
 * uses, so the two agree; the send still builds from scratch.
 *
 * From Connect until the receipt (or a cancel) the network is locked:
 * switching it would remount the page and drop the payment.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeTransaction, hexToBin } from "@bitauth/libauth";
import { useNetworkLock } from "../hooks/useNetworkLock";
import type { Wallet } from "../hooks/useWallet";
import { satsToUsd, usdToSats } from "../lib/amount";
import { NETWORK_LABEL, walletMustBeOn } from "../lib/labels";
import { explorerTx, type BchNetwork } from "../lib/network";
import { MEMO_MAX, cleanMemo, parseBchAmount, paymentErrorMessage, type PayParams, type Receipt as ReceiptData } from "../lib/paylink";
import { getUsdPerBch, type Price } from "../lib/price";
import { DUST_SATS, buildSignRequest, formatBch, selectCoins, sendBch } from "../lib/wallet";
import { Icon } from "./Icon";
import { Receipt } from "./Receipt";

/** After this long with no answer, remind the payer to open their wallet. */
const SLOW_WALLET_MS = 90_000;

type Unit = "usd" | "bch";
type Phase = "amount" | "connect" | "review" | "approving";

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
  const { wc, connected, restoring, connect, changeAddress, coins, balance, scanned, loading } = wallet;

  const amountFixed = params.amountUsd !== null;
  const [unit, setUnit] = useState<Unit>("usd");
  const [amountText, setAmountText] = useState(params.amountUsd !== null ? String(params.amountUsd) : "");
  const [memo, setMemo] = useState(params.memo ?? "");
  const [price, setPrice] = useState<Price | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const [step, setPhase] = useState<Phase>("amount");
  // Waiting at Connect and the wallet answers: that is Review.
  const phase: Phase = step === "connect" && connected ? "review" : step;
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useNetworkLock(phase !== "amount" && !receipt);

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
  const net = NETWORK_LABEL[network];

  /** The fee the built transaction would pay, or why it can't be built (usually not enough coins). */
  const preview = useMemo((): { fee: bigint } | { problem: string } | null => {
    if (phase !== "review" || !ready || !changeAddress || !coins.length) return null;
    try {
      const picked = selectCoins(coins, ready.sats);
      const request = buildSignRequest({ network, coins: picked, to: address, amount: ready.sats, changeAddress });
      const tx = decodeTransaction(hexToBin(request.transaction.transaction));
      if (typeof tx === "string") return null;
      const out = tx.outputs.reduce((s, o) => s + o.valueSatoshis, 0n);
      return { fee: picked.reduce((s, c) => s + c.satoshis, 0n) - out };
    } catch (e) {
      return { problem: (e as Error).message };
    }
  }, [phase, ready, changeAddress, coins, network, address]);

  const start = () => {
    setError(null);
    if (connected) setPhase("review");
    else {
      connect();
      setPhase("connect");
    }
  };

  const back = () => {
    abortRef.current?.abort();
    setError(null);
    setPhase("amount");
  };

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
      const { txid, broadcast, fee, inputAddresses } = await sendBch({
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
        ...(fee !== undefined ? { fee } : {}),
        payerAddresses: inputAddresses,
      });
      setTimeout(wallet.refresh, 3_000);
      onSent?.();
    } catch (e) {
      // A cancel goes back to the start (and unlocks the network); anything else stays on Review to retry.
      setError(paymentErrorMessage(e, controller.signal.aborted, network));
      setPhase(controller.signal.aborted ? "amount" : "review");
    } finally {
      clearTimeout(slowTimer);
      abortRef.current = null;
      setSlow(false);
    }
  };

  if (receipt) return <Receipt receipt={receipt} network={network} />;

  const emptyWallet = (connected || restoring) && scanned && !loading && balance === 0n;
  const amountLine = ready
    ? `${ready.usd !== undefined ? `$${ready.usd.toFixed(2)} · ` : ""}${formatBch(ready.sats)} ${unitLabel}`
    : "";

  if (phase === "amount") {
    return (
      <section className="card pay">
        <h2>How much?</h2>
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
        {network === "chipnet" && price && <p className="muted small">Test coins have no value; dollar figures use the real BCH price.</p>}

        <label className="memo">
          Memo (optional, kept on your receipt only)
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={MEMO_MAX} readOnly={!!params.memo} placeholder="Invoice 7" />
        </label>

        <button className="block" onClick={start} disabled={!ready}>
          <Icon name={connected ? "receipt_long" : "account_balance_wallet"} />
          {connected ? "Review payment" : "Connect wallet"}
        </button>
        {!connected && (
          <p className="muted small">
            Scan the code with a Bitcoin Cash wallet that works with WizardConnect (Paytaca, Cashonize or Selene).{" "}
            {walletMustBeOn(network)} HandlePay never holds your money or keys.
          </p>
        )}
        {error && <p className="err">{error}</p>}
      </section>
    );
  }

  if (phase === "connect") {
    return (
      <section className="card pay">
        <h2>Connect your wallet</h2>
        <p className="muted">
          Scan the code with your wallet to pay {amountLine}. {walletMustBeOn(network)}
        </p>
        {restoring && (
          <p className="muted small">
            Waiting for {wc.walletName ?? "your wallet"} to answer. If this takes more than a few seconds, open the wallet app.
          </p>
        )}
        <div className="strip-actions">
          {!restoring && (
            <button onClick={connect}>
              <Icon name="qr_code" /> Show QR
            </button>
          )}
          <button className="ghost" onClick={back}>
            Cancel
          </button>
        </div>
        {wc.error && <p className="err">{wc.error}</p>}
      </section>
    );
  }

  return (
    <section className="card pay review">
      <h2>{phase === "approving" ? "Approve in your wallet" : "Review your payment"}</h2>
      <dl className="facts">
        <dt>To</dt>
        <dd>
          <strong>{handle}</strong>
        </dd>
        <dt>Address</dt>
        <dd>
          <code>{address}</code>
        </dd>
        <dt>Amount</dt>
        <dd>
          {ready?.usd !== undefined && <strong>${ready.usd.toFixed(2)}</strong>}
          {ready && <span className={ready.usd !== undefined ? "muted" : ""}> {ready.usd !== undefined ? "≈ " : ""}{formatBch(ready.sats)} {unitLabel}</span>}
        </dd>
        <dt>Network</dt>
        <dd>
          {net.name} · {net.detail}
        </dd>
        {cleanMemo(memo) && (
          <>
            <dt>Memo</dt>
            <dd>
              {cleanMemo(memo)} <span className="muted small">(kept on this receipt only)</span>
            </dd>
          </>
        )}
        {preview && "fee" in preview && (
          <>
            <dt>Network fee</dt>
            <dd>{preview.fee.toString()} sats</dd>
          </>
        )}
        <dt>From</dt>
        <dd>{wc.walletName ?? "Your connected wallet"}</dd>
      </dl>

      {preview && "problem" in preview && <p className="warn">{preview.problem}</p>}
      {emptyWallet && (
        <p className="warn">
          No coins found. If your wallet is on {network === "chipnet" ? "mainnet" : "chipnet"}, switch it to {network}.
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
      {restoring && (
        <p className="muted small">
          Waiting for {wc.walletName ?? "your wallet"} to answer before it can sign. If this takes more than a few seconds,
          open the wallet app.
        </p>
      )}

      {phase === "approving" ? (
        <div className="approving" aria-live="polite">
          <p>
            <span className="spinner" aria-hidden /> Check the details on your wallet's screen and approve there.
          </p>
          {slow && <p className="warn">Still waiting. Open your wallet app and look for the request.</p>}
          <button className="ghost" onClick={() => abortRef.current?.abort()}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <p className="muted small">
            {walletMustBeOn(network)} Your wallet will show this payment again; that screen is the final check. HandlePay
            then sends it to the network.
          </p>
          <div className="strip-actions">
            <button onClick={pay} disabled={!connected || !ready || !changeAddress || !coins.length || (!!preview && "problem" in preview)}>
              <Icon name="send" /> Send to my wallet to approve
            </button>
            <button className="ghost" onClick={back}>
              Back
            </button>
          </div>
        </>
      )}

      {error && <p className="err">{error}</p>}
      {wallet.error && <p className="err">{wallet.error}</p>}
    </section>
  );
}
