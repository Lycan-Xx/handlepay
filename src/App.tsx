import { WalletQR } from "./components/WalletQR";
import { useNetwork } from "./hooks/useNetwork";
import { useWallet } from "./hooks/useWallet";
import { navigate, useRoute } from "./lib/router";
import { DevHome } from "./routes/DevHome";
import { PayPage } from "./routes/PayPage";
import "./App.css";

export default function App() {
  const [network, setNetwork] = useNetwork();
  const wallet = useWallet(network);
  const { route, search } = useRoute();

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate("/");
  };

  return (
    <main className="shell">
      <header className="top">
        <h1>
          <a href="/" className="brand" onClick={goHome}>
            HandlePay
          </a>
        </h1>
        <div className="net" role="group" aria-label="Network">
          {(["chipnet", "mainnet"] as const).map((n) => (
            <button key={n} className={n === network ? "on" : ""} aria-pressed={n === network} onClick={() => setNetwork(n)}>
              {n}
            </button>
          ))}
        </div>
      </header>

      {network === "mainnet" && <p className="warn">Mainnet uses real money. Keep amounts tiny.</p>}

      {route.name === "home" && <DevHome wallet={wallet} network={network} />}
      {route.name === "pay" && (
        <PayPage key={route.handle} handle={route.handle} search={search} wallet={wallet} network={network} />
      )}
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
