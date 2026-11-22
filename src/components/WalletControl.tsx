/**
 * The wallet control in the header. It reflects the one wallet connection
 * the whole app shares (useWallet), so connecting here is the same as
 * connecting on the pay page or in Get paid.
 *
 * Disconnected, it opens the WizardConnect QR: there is no provider picker,
 * because the user scans with whichever wallet they have. Connected, it shows
 * the wallet's name when the session reports one (otherwise "Connected") and
 * a short address, with a popover to copy the address or disconnect. It never
 * shows a balance, and never suggests HandlePay holds the wallet.
 */
import { useEffect, useRef, useState } from "react";
import type { Wallet } from "../hooks/useWallet";
import { shortAddress } from "../lib/labels";
import { CopyButton } from "./CopyButton";

export function WalletControl({ wallet, locked = false }: { wallet: Wallet; locked?: boolean }) {
  const { wc, connected, restoring, connect, receiveAddress } = wallet;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!connected && !restoring) {
    const pairing = wc.state === "connecting" || wc.state === "reconnecting";
    return (
      <button type="button" className="pill wallet" onClick={connect}>
        {pairing ? "Show QR" : <>Connect<span className="wide-only"> wallet</span></>}
      </button>
    );
  }

  const name = wc.walletName ?? "Connected";
  return (
    <div className="popover-wrap" ref={ref}>
      <button
        type="button"
        className="pill wallet on"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="wallet-name">{name}</span>
        {receiveAddress && <span className="wide-only mono small"> · {shortAddress(receiveAddress)}</span>}
        <span aria-hidden> ▾</span>
      </button>
      {open && (
        <div className="popover" role="group" aria-label="Your wallet">
          <p className="label">{restoring ? "Reconnecting to your wallet…" : `Connected to ${name}`}</p>
          {receiveAddress ? (
            <code className="addr">{receiveAddress}</code>
          ) : (
            <p className="muted small">Waiting for your wallet to share its address…</p>
          )}
          <p className="muted small">Your wallet holds your coins and keys. HandlePay only asks it to sign.</p>
          <div className="strip-actions">
            {receiveAddress && <CopyButton text={receiveAddress} label="Copy address" />}
            <button
              type="button"
              className="ghost"
              disabled={locked}
              onClick={() => {
                wc.disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
          {locked && <p className="muted small">Finish or cancel the transaction in progress to disconnect.</p>}
        </div>
      )}
    </div>
  );
}
