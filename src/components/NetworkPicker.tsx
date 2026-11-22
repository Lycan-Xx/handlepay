/**
 * The network control in the header: a dot and a label, opening a drawer to
 * choose. Mainnet has the brand-orange dot, chipnet a blue one; green, amber
 * and red stay reserved for status badges, so a practice page never looks
 * like a warning and a mainnet page never looks "verified".
 *
 * While a payment or proof is in progress the control is locked (see
 * useNetworkLock), and says so in words rather than in a tooltip.
 */
import { useCallback, useState } from "react";
import type { BchNetwork } from "../lib/network";
import { NETWORK_LABEL } from "../lib/labels";
import { Drawer } from "./Drawer";

export function NetworkPicker(props: { network: BchNetwork; onChange: (n: BchNetwork) => void; locked?: boolean }) {
  const { network, onChange, locked = false } = props;
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const choose = (n: BchNetwork) => {
    onChange(n);
    setOpen(false);
  };
  const label = NETWORK_LABEL[network];
  return (
    <>
      <button
        type="button"
        className={`pill ${network === "chipnet" ? "practice" : ""}`}
        onClick={() => setOpen(true)}
        disabled={locked}
        aria-haspopup="dialog"
        aria-label={`Network: ${label.name}, ${label.detail}.${locked ? " Locked while this transaction is in progress." : " Change"}`}
      >
        <span className="dot" aria-hidden /> {label.name}
        <span className="wide-only"> · {label.detail}</span> <span aria-hidden>{locked ? "" : "▾"}</span>
      </button>
      <Drawer open={open} title="Which network?" onClose={close}>
        <button type="button" className="choice" aria-pressed={network === "mainnet"} onClick={() => choose("mainnet")}>
          <span className="dot" aria-hidden />
          <span>
            <b>Mainnet · real BCH</b>
            <span className="d">Payments are real and can't be undone.</span>
          </span>
          {network === "mainnet" && <span className="tick" aria-hidden>✓</span>}
        </button>
        <button type="button" className="choice practice" aria-pressed={network === "chipnet"} onClick={() => choose("chipnet")}>
          <span className="dot" aria-hidden />
          <span>
            <b>Chipnet · practice coins</b>
            <span className="d">Free test coins with no value. Learn safely.</span>
          </span>
          {network === "chipnet" && <span className="tick" aria-hidden>✓</span>}
        </button>
        <p className="tip">
          <strong>Learning?</strong> Use chipnet. Nothing there is worth anything, and you can switch to mainnet when
          you're ready. Your wallet must be on the same network as this page. A name is the same on both networks, but
          each network has its own binding.
        </p>
      </Drawer>
    </>
  );
}
