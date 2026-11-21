/**
 * The network switch, in plain words. "Real money" is mainnet and "Practice
 * coins" is chipnet; the app logic still uses the network names.
 */
import { useCallback, useState } from "react";
import type { BchNetwork } from "../lib/network";
import { Drawer } from "./Drawer";

const NETWORK_LABEL: Record<BchNetwork, string> = { mainnet: "Real money", chipnet: "Practice coins" };

export function NetworkPicker({ network, onChange }: { network: BchNetwork; onChange: (n: BchNetwork) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const choose = (n: BchNetwork) => {
    onChange(n);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className={`pill ${network === "chipnet" ? "practice" : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Network: ${NETWORK_LABEL[network]}. Change`}
      >
        <span className="dot" aria-hidden /> {NETWORK_LABEL[network]} <span aria-hidden>▾</span>
      </button>
      <Drawer open={open} title="Which network?" onClose={close}>
        <button type="button" className="choice" aria-pressed={network === "mainnet"} onClick={() => choose("mainnet")}>
          <span className="dot" aria-hidden />
          <span>
            <b>Real money (mainnet)</b>
            <span className="d">Payments are real and can't be undone.</span>
          </span>
          {network === "mainnet" && <span className="tick" aria-hidden>✓</span>}
        </button>
        <button type="button" className="choice practice" aria-pressed={network === "chipnet"} onClick={() => choose("chipnet")}>
          <span className="dot" aria-hidden />
          <span>
            <b>Practice coins (chipnet)</b>
            <span className="d">Free test coins with no value. Learn safely.</span>
          </span>
          {network === "chipnet" && <span className="tick" aria-hidden>✓</span>}
        </button>
        <p className="tip">
          <strong>Learning?</strong> Use practice coins. Nothing there is worth anything, and you can switch to real money
          when you're ready. Your wallet must be on the same network as this page.
        </p>
      </Drawer>
    </>
  );
}
