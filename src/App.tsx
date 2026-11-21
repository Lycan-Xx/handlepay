import { useEffect } from "react";
import { Banner } from "./components/Banner";
import { NetworkPicker } from "./components/NetworkPicker";
import { WalletQR } from "./components/WalletQR";
import { useNetwork } from "./hooks/useNetwork";
import { useTheme } from "./hooks/useTheme";
import { useWallet } from "./hooks/useWallet";
import { navigate, useRoute } from "./lib/router";
import { DevHome } from "./routes/DevHome";
import { AuthPage } from "./routes/AuthPage";
import { HomePage } from "./routes/HomePage";
import { IdentityPage } from "./routes/IdentityPage";
import { PayPage } from "./routes/PayPage";
import { SecurityPage } from "./routes/SecurityPage";
import { TxPage } from "./routes/TxPage";
import "./App.css";

export default function App() {
  const [network, setNetwork] = useNetwork();
  const wallet = useWallet(network);
  const theme = useTheme();
  const { route, search } = useRoute();

  // A link can name its network (?network=mainnet), so a pay link to a mainnet name works from a chipnet browser.
  const linkNetwork = search.get("network");
  useEffect(() => {
    if ((linkNetwork === "chipnet" || linkNetwork === "mainnet")) setNetwork(linkNetwork);
    // Only when the link changes: after that, the network buttons are the user's to press.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkNetwork]);

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate("/");
  };
  const link = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(href);
  };

  return (
    <main className="shell">
      <Banner />
      <header className="top">
        <h1>
          <a href="/" className="brand" onClick={goHome}>
            HandlePay
          </a>
        </h1>
        <div className="top-tools">
          <NetworkPicker network={network} onChange={setNetwork} />
          <button
            type="button"
            className="pill icon"
            onClick={theme.toggle}
            aria-label={theme.dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            <span aria-hidden>{theme.dark ? "☀" : "◐"}</span>
          </button>
        </div>
      </header>
      <nav className="nav" aria-label="Pages">
        <a href="/identity" onClick={link("/identity")} aria-current={route.name === "identity" ? "page" : undefined}>
          Get paid by name
        </a>
        <a href="/security" onClick={link("/security")} aria-current={route.name === "security" ? "page" : undefined}>
          Try the attack
        </a>
        <a href="/auth" onClick={link("/auth")} aria-current={route.name === "auth" ? "page" : undefined}>
          Sign in
        </a>
      </nav>

      {network === "mainnet" && <p className="warn mainnet">Real money: payments here are final. Keep amounts tiny while testing.</p>}

      {route.name === "home" && <HomePage />}
      {route.name === "dev" && <DevHome wallet={wallet} network={network} />}
      {route.name === "identity" && <IdentityPage key={network} wallet={wallet} network={network} />}
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
            There's nothing here yet.{" "}
            <a href="/" onClick={goHome}>
              Go home
            </a>
          </p>
        </section>
      )}

      <WalletQR wallet={wallet} />
    </main>
  );
}
