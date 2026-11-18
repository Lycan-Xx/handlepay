import { useCallback, useEffect, useMemo, useState } from "react";
import { WizardConnectQRDialog, useWizardConnect } from "@wizardconnect/react";
import { explorerTx, type BchNetwork } from "./lib/network";
import { deriveAddresses, formatBch, getCoins, sendBch, type WalletCoin } from "./lib/wallet";
import { IdentityDev } from "./components/IdentityDev";
import "./App.css";

const NETWORK_KEY = "handlepay-network";

export default function App() {
  const [network, setNetwork] = useState<BchNetwork>(() => {
    try {
      return (localStorage.getItem(NETWORK_KEY) as BchNetwork) || "chipnet";
    } catch {
      return "chipnet";
    }
  });
  const wc = useWizardConnect({ dappName: "HandlePay" });
  const [showQR, setShowQR] = useState(false);

  const [coins, setCoins] = useState<WalletCoin[]>([]);
  const [loading, setLoading] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1000");
  const [status, setStatus] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = wc.state === "connected" && wc.manager;
  const addresses = useMemo(
    () => (connected ? deriveAddresses(wc.manager!, network) : []),
    [connected, wc.manager, network],
  );
  const receiveAddress = addresses.find((a) => a.path === "receive" && a.index === 0)?.address;
  const changeAddress = addresses.find((a) => a.path === "change" && a.index === 0)?.address;
  const balance = coins.reduce((sum, c) => sum + c.satoshis, 0n);

  const refresh = useCallback(async () => {
    if (!addresses.length) return;
    setLoading(true);
    setError(null);
    try {
      setCoins(await getCoins(addresses, network));
    } catch (e) {
      setError(`Could not reach the ${network} server: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [addresses, network]);

  useEffect(() => {
    if (wc.state === "connected") setShowQR(false);
    refresh();
  }, [wc.state, refresh]);

  const switchNetwork = (next: BchNetwork) => {
    setNetwork(next);
    setCoins([]);
    setTxid(null);
    try {
      localStorage.setItem(NETWORK_KEY, next);
    } catch {
      /* storage unavailable: keep in memory only */
    }
  };

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
      setError((e as Error).message);
    }
  };

  return (
    <main className="shell">
      <header className="top">
        <h1>HandlePay</h1>
        <div className="net" role="group" aria-label="Network">
          {(["chipnet", "mainnet"] as const).map((n) => (
            <button key={n} className={n === network ? "on" : ""} onClick={() => switchNetwork(n)}>
              {n}
            </button>
          ))}
        </div>
      </header>

      {network === "mainnet" && (
        <p className="warn">Mainnet uses real money. Keep amounts tiny.</p>
      )}

      <section className="card">
        <h2>1. Connect wallet</h2>
        {connected ? (
          <>
            <p>
              Connected to <strong>{wc.walletName ?? "wallet"}</strong>
            </p>
            <button className="ghost" onClick={() => wc.disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Scan with Cashonize, Paytaca or Selene. Make sure the wallet is on {network}.
            </p>
            <button
              onClick={() => {
                if (!wc.uri) wc.connect();
                setShowQR(true);
              }}
            >
              {wc.state === "connecting" || wc.state === "reconnecting" ? "Show QR" : "Connect"}
            </button>
            {wc.error && <p className="err">{wc.error}</p>}
          </>
        )}
      </section>

      {connected && (
        <section className="card">
          <h2>2. Your wallet</h2>
          <p className="label">Receive address</p>
          <code className="addr">{receiveAddress}</code>
          <p className="label">Balance (scanned {addresses.length} addresses)</p>
          <p className="big">{formatBch(balance)} {network === "chipnet" ? "tBCH" : "BCH"}</p>
          <button className="ghost" onClick={refresh} disabled={loading}>
            {loading ? "Checking…" : "Refresh"}
          </button>
          {network === "chipnet" && balance === 0n && (
            <p className="muted">
              Empty? Paste the receive address into{" "}
              <a href="https://tbch.googol.cash/" target="_blank" rel="noreferrer">tbch.googol.cash</a>.
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
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
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

      {connected && receiveAddress && (
        <IdentityDev
          manager={wc.manager!}
          network={network}
          coins={coins}
          bindAddress={receiveAddress}
          onSent={refresh}
        />
      )}

      {error && <p className="err">{error}</p>}

      {wc.uri && wc.qrUri && (
        <WizardConnectQRDialog
          show={showQR && !connected}
          onClose={() => setShowQR(false)}
          uri={wc.uri}
          qrUri={wc.qrUri}
          title="Connect your BCH wallet"
        />
      )}
    </main>
  );
}
