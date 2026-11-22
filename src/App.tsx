import { useEffect, useState } from "react";
import { Banner } from "./components/Banner";
import { NetworkPicker } from "./components/NetworkPicker";
import { WalletControl } from "./components/WalletControl";
import { WalletQR } from "./components/WalletQR";
import { useNetwork } from "./hooks/useNetwork";
import { NetworkLockContext } from "./hooks/useNetworkLock";
import { useWallet } from "./hooks/useWallet";
import { navigate, useRoute } from "./lib/router";
import { DevHome } from "./routes/DevHome";
import { AuthPage } from "./routes/AuthPage";
import { HomePage } from "./routes/HomePage";
import { IdentityPage } from "./routes/IdentityPage";
import { PayPage } from "./routes/PayPage";
import { PayStartPage } from "./routes/PayStartPage";
import { SecurityPage } from "./routes/SecurityPage";
import { TxPage } from "./routes/TxPage";
import "./App.css";

export default function App() {
  const [network, setNetwork] = useNetwork();
  const wallet = useWallet(network);
  const { route, search } = useRoute();
  /** Set by a page while a payment or proof is in progress; the network control is disabled meanwhile. */
  const [locked, setLocked] = useState(false);

  // A link can name its network (?network=mainnet), so a pay link to a mainnet name works from a chipnet browser.
  const linkNetwork = search.get("network");
  useEffect(() => {
    if ((linkNetwork === "chipnet" || linkNetwork === "mainnet")) setNetwork(linkNetwork);
    // Only when the link changes: after that, the network control is the user's to press.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkNetwork]);

  const link = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };

  return (
    <NetworkLockContext value={setLocked}>
      <Banner />
      <div className="shell">
        <header className="top">
          <h1>
            <a href="/" className="brand" onClick={link("/")}>
              <img src="/brand/logo-64.png" width="28" height="28" alt="" />
              HandlePay
            </a>
          </h1>
          <div className="top-tools">
            <WalletControl wallet={wallet} locked={locked} />
            <NetworkPicker network={network} onChange={setNetwork} locked={locked} />
          </div>
        </header>
        {locked && (
          <p className="lock-note" role="status">
            Network locked while this transaction is in progress.
          </p>
        )}

        <main>
          {/* Only where money can move; elsewhere the network control at the top is enough. */}
          {network === "mainnet" && (route.name === "pay" || route.name === "identity") && (
            <p className="warn mainnet">Mainnet · real BCH: payments here are final. Keep amounts tiny while testing.</p>
          )}

          {route.name === "home" && <HomePage />}
          {route.name === "dev" && <DevHome wallet={wallet} network={network} />}
          {route.name === "identity" && <IdentityPage key={network} wallet={wallet} network={network} />}
          {route.name === "pay_start" && <PayStartPage search={search} />}
          {route.name === "pay" && (
            <PayPage key={`${route.handle}|${network}`} handle={route.handle} search={search} wallet={wallet} network={network} />
          )}
          {route.name === "tx" && (
            <TxPage key={`${route.txid}|${search.get("network") ?? network}`} txid={route.txid} search={search} network={network} />
          )}
          {route.name === "security" && <SecurityPage key={network} network={network} search={search} />}
          {route.name === "auth" && <AuthPage key={network} network={network} search={search} />}
          {route.name === "not_found" && (
            <section className="card">
              <h2>Page not found</h2>
              <p className="muted">
                There's nothing here.{" "}
                <a href="/" onClick={link("/")}>
                  Go home
                </a>
              </p>
            </section>
          )}
        </main>

        <footer className="foot">
          <a href="/" onClick={link("/")}>
            Home
          </a>
          <span aria-hidden> · </span>
          <a href="/security" onClick={link("/security")}>
            How it works
          </a>
          <span aria-hidden> · </span>
          <a href="/auth" onClick={link("/auth")}>
            Your name as a login
          </a>
        </footer>
      </div>

      <WalletQR wallet={wallet} />
    </NetworkLockContext>
  );
}
