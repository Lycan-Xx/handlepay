/**
 * The Day 1 developer page: pair a wallet, check coins, send a plain payment,
 * and run the identity binding against real services. It stays at "/" until
 * the real home page replaces it.
 */
import { useState } from "react";
import { IdentityDev } from "../components/IdentityDev";
import type { Wallet } from "../hooks/useWallet";
import { explorerTx, type BchNetwork } from "../lib/network";
import { paymentErrorMessage } from "../lib/paylink";
import { navigate, payPath } from "../lib/router";
import { formatBch, sendBch } from "../lib/wallet";

export function DevHome({ wallet, network }: { wallet: Wallet; network: BchNetwork }) {
  const { wc, connected, restoring, connect, addresses, receiveAddress, changeAddress, coins, balance, loading, refresh } = wallet;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1000");
  const [status, setStatus] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payHandle, setPayHandle] = useState("");

  const onSend = async () => {
    if (!wc.manager || !changeAddress) return;
    setError(null);
    setTxid(null);
    setStatus("Approve the payment in your wallet…");
    try {
      const result = await sendBch({
        manager: wc.manager,
        network,
        coins,
        to: to.trim(),
        amount: BigInt(amount),
        changeAddress,
        userPrompt: "HandlePay test payment",
      });
      setTxid(result.txid);
      setStatus("Sent. Waiting for the network to see it.");
      setTimeout(refresh, 3000);
    } catch (e) {
      setStatus(null);
      setError(paymentErrorMessage(e, false, network));
    }
  };

  return (
    <>
      <section className="card">
        <h2>Pay a name</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (payHandle.trim()) navigate(payPath(payHandle.trim()));
          }}
        >
          <label>
            Name
            <input value={payHandle} onChange={(e) => setPayHandle(e.target.value)} placeholder="sani@lycanforge.com.ng" />
          </label>
          <button type="submit" disabled={!payHandle.trim()}>
            Open pay page
          </button>
        </form>
      </section>

      <section className="card">
        <h2>1. Connect wallet</h2>
        {connected || restoring ? (
          <>
            <p>
              {connected ? "Connected to" : "Reconnecting to"} <strong>{wc.walletName ?? "wallet"}</strong>
            </p>
            {restoring && (
              <p className="muted">
                Your balance is shown from the last session. Signing waits until the wallet answers; open the wallet
                app if this takes more than a few seconds.
              </p>
            )}
            <button className="ghost" onClick={() => wc.disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <p className="muted">Scan with Cashonize, Paytaca or Selene. Make sure the wallet is on {network}.</p>
            <button onClick={connect}>
              {wc.state === "connecting" || wc.state === "reconnecting" ? "Show QR" : "Connect"}
            </button>
            {wc.error && <p className="err">{wc.error}</p>}
          </>
        )}
      </section>

      {(connected || restoring) && (
        <section className="card">
          <h2>2. Your wallet</h2>
          <p className="label">Receive address</p>
          {receiveAddress ? (
            <code className="addr">{receiveAddress}</code>
          ) : (
            <p className="muted">
              Waiting for {wc.walletName ?? "the wallet"} to share its keys. If this stays empty, disconnect and
              reconnect.
            </p>
          )}
          <p className="label">Balance (scanned {addresses.length} addresses)</p>
          <p className="big">
            {formatBch(balance)} {network === "chipnet" ? "tBCH" : "BCH"}
          </p>
          <button className="ghost" onClick={refresh} disabled={loading}>
            {loading ? "Checking…" : "Refresh"}
          </button>
          {network === "chipnet" && balance === 0n && (
            <p className="muted">
              Empty? Paste the receive address into{" "}
              <a href="https://tbch.googol.cash/" target="_blank" rel="noreferrer">
                tbch.googol.cash
              </a>{" "}
              with the network set to chipnet.
            </p>
          )}
        </section>
      )}

      {connected && (
        <section className="card">
          <h2>3. Send a test payment</h2>
          <label>
            To address
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={receiveAddress} />
          </label>
          <label>
            Amount (satoshis)
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
            />
          </label>
          <button onClick={onSend} disabled={!to || !amount || !coins.length}>
            Send
          </button>
          {status && <p className="muted">{status}</p>}
          {txid && (
            <p>
              Transaction:{" "}
              <a href={explorerTx(network, txid)} target="_blank" rel="noreferrer">
                {txid.slice(0, 10)}…{txid.slice(-8)}
              </a>
            </p>
          )}
        </section>
      )}

      {(connected || restoring) && receiveAddress && wc.manager && (
        <IdentityDev
          manager={wc.manager}
          walletReady={connected}
          walletName={wc.walletName ?? "the wallet"}
          network={network}
          coins={coins}
          bindAddress={receiveAddress}
          onSent={refresh}
        />
      )}

      {(error || wallet.error) && <p className="err">{error ?? wallet.error}</p>}
    </>
  );
}
