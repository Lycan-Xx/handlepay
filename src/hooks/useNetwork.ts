import { useState } from "react";
import type { BchNetwork } from "../lib/network";

const NETWORK_KEY = "handlepay-network";

/** The chipnet/mainnet choice, remembered in this browser. */
export function useNetwork(): [BchNetwork, (next: BchNetwork) => void] {
  const [network, setNetwork] = useState<BchNetwork>(() => {
    try {
      const stored = localStorage.getItem(NETWORK_KEY);
      return stored === "mainnet" ? "mainnet" : "chipnet";
    } catch {
      return "chipnet";
    }
  });
  const choose = (next: BchNetwork) => {
    setNetwork(next);
    try {
      localStorage.setItem(NETWORK_KEY, next);
    } catch {
      /* storage unavailable: keep in memory only */
    }
  };
  return [network, choose];
}
