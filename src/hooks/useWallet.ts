/**
 * The connected WizardConnect wallet: pairing state, the addresses derived
 * from its xpubs, and the coins at those addresses. One instance lives in App
 * so the connection survives moving between pages.
 *
 * After a page reload the wallet has to answer over the relay again before it
 * can sign, which can take a while (a phone wallet in the background answers
 * only when opened). WizardConnect keeps the wallet's public keys from the
 * last session, so addresses and balance are shown straight away while that
 * happens ("restoring"); only signing waits for the wallet.
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

  /** Ready to sign: the wallet answered on this page load. */
  const connected = wc.state === "connected" && !!wc.manager;
  /**
   * Reconnecting a saved session (never a fresh QR pairing, which has a uri):
   * the keys are known from last time, but the wallet hasn't answered yet.
   */
  const restoring =
    !connected &&
    !!wc.manager &&
    !wc.uri &&
    (wc.state === "connecting" || wc.state === "reconnecting") &&
    wc.manager.getSessionPaths().length > 0;
  const haveKeys = connected || restoring;
  const addresses: WalletAddress[] = useMemo(
    () => (haveKeys ? deriveAddresses(wc.manager!, network) : []),
    // walletName is set when the wallet's keys arrive, so it re-runs the derivation then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [haveKeys, wc.manager, wc.walletName, network],
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

  // Scan whenever the address list changes. Going from restoring to connected
  // keeps the same list, so the balance shown at load isn't fetched twice.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (wc.state === "connected") setShowQR(false);
  }, [wc.state]);

  /** Start pairing (or re-show the QR of a pairing already in progress). */
  const connect = () => {
    if (!wc.uri) wc.connect();
    setShowQR(true);
  };

  /** Drop the connected wallet and start pairing another ("Use a different wallet"). */
  const switchWallet = async () => {
    await wc.disconnect();
    wc.connect();
    setShowQR(true);
  };

  return {
    wc,
    connected,
    /** Keys and balance known from the saved session; waiting for the wallet to answer before it can sign. */
    restoring,
    connect,
    switchWallet,
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
