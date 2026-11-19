/**
 * The connected WizardConnect wallet: pairing state, the addresses derived
 * from its xpubs, and the coins at those addresses. One instance lives in App
 * so the connection survives moving between pages.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWizardConnect } from "@wizardconnect/react";
import type { BchNetwork } from "../lib/network";
import { deriveAddresses, getCoins, type WalletAddress, type WalletCoin } from "../lib/wallet";

export type Wallet = ReturnType<typeof useWallet>;

export function useWallet(network: BchNetwork) {
  const wc = useWizardConnect({ dappName: "HandlePay" });
  const [showQR, setShowQR] = useState(false);
  const [coins, setCoins] = useState<WalletCoin[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = wc.state === "connected" && !!wc.manager;
  const addresses: WalletAddress[] = useMemo(
    () => (connected ? deriveAddresses(wc.manager!, network) : []),
    // walletName is set when the wallet's keys arrive, so it re-runs the derivation then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connected, wc.manager, wc.walletName, network],
  );
  const receiveAddress = addresses.find((a) => a.path === "receive" && a.index === 0)?.address;
  const changeAddress = addresses.find((a) => a.path === "change" && a.index === 0)?.address;
  const balance = coins.reduce((sum, c) => sum + c.satoshis, 0n);

  const refresh = useCallback(async () => {
    if (!addresses.length) {
      setCoins([]);
      setScanned(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setCoins(await getCoins(addresses, network));
      setScanned(true);
    } catch (e) {
      setError(`Can't reach the BCH network server (${network}): ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [addresses, network]);

  useEffect(() => {
    if (wc.state === "connected") setShowQR(false);
    refresh();
  }, [wc.state, refresh]);

  /** Start pairing (or re-show the QR of a pairing already in progress). */
  const connect = () => {
    if (!wc.uri) wc.connect();
    setShowQR(true);
  };

  return {
    wc,
    connected,
    connect,
    showQR,
    setShowQR,
    addresses,
    receiveAddress,
    changeAddress,
    coins,
    balance,
    loading,
    /** True once a coin scan has completed for the current addresses. */
    scanned,
    error,
    refresh,
  };
}
