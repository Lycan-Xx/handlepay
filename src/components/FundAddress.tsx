/**
 * The address the proof must be funded from, with a QR to scan, a copy button
 * and a suggested amount in dollars. The QR holds only the plain address (no
 * amount): wallets treat amounts in a payment URI inconsistently.
 */
import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "./CopyButton";
import { qrSvg, SUGGESTED_USD } from "../lib/qr";
import { getUsdPerBch } from "../lib/price";
import { satsToUsd } from "../lib/amount";
import type { BchNetwork } from "../lib/network";

export function FundAddress({ address, network, minSats }: { address: string; network: BchNetwork; minSats: bigint }) {
  const svg = useMemo(() => qrSvg(address), [address]);
  const [usdPerBch, setUsdPerBch] = useState<number | null>(null);

  useEffect(() => {
    // Only mainnet coins are worth dollars, so only then is a price needed.
    if (network !== "mainnet") return;
    let live = true;
    getUsdPerBch()
      .then((p) => live && setUsdPerBch(p.usdPerBch))
      .catch(() => {
        /* no price: the sats minimum below still stands */
      });
    return () => {
      live = false;
    };
  }, [network]);

  const minUsd = usdPerBch ? satsToUsd(minSats, usdPerBch) : null;

  return (
    <div className="fund">
      <div className="fund-qr" role="img" aria-label={`QR code for ${address}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="fund-body">
        <code className="addr">{address}</code>
        <p>
          <CopyButton text={address} label="Copy address" />
        </p>
        <p className="muted small">
          {network === "mainnet"
            ? `Send about $${SUGGESTED_USD.toFixed(2)} of BCH. The least that works is ${minSats.toLocaleString()} sats${
                minUsd !== null ? ` (about $${Math.max(minUsd, 0.01).toFixed(2)})` : ""
              }.`
            : `Chipnet coins are free test coins with no dollar value. Send at least ${minSats.toLocaleString()} sats; the faucet's default amount is plenty.`}{" "}
          Scan with your wallet's Send screen, not its WizardConnect scanner.
        </p>
      </div>
    </div>
  );
}
