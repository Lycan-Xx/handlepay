import { useState } from "react";
import type { BchNetwork } from "../lib/network";

const NETWORK_KEY = "handlepay-network";

/** The chipnet/mainnet choice, remembered in this browser. */
export function useNetwork(): [BchNetwork, (next: BchNetwork) => void] {
  const [network, setNetwork] = useState<BchNetwork>(() => {
    // A link that names its network wins from the first render, so the page doesn't start on the other one.
    const fromLink = new URLSearchParams(window.location.search).get("network");
    if (fromLink === "chipnet" || fromLink === "mainnet") return fromLink;
    try {
      const stored = localStorage.getItem(NETWORK_KEY);
      // First visit: real money, so a judge's pay link and the demo name work with no setup. Practice coins stay one tap away.
      return stored === "chipnet" ? "chipnet" : "mainnet";
    } catch {
      return "mainnet";
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
