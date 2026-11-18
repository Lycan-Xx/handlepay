import { ElectrumNetworkProvider } from "cashscript";

export type BchNetwork = "chipnet" | "mainnet";

/** CashAddr prefix for each network. */
export const PREFIX: Record<BchNetwork, "bchtest" | "bitcoincash"> = {
  chipnet: "bchtest",
  mainnet: "bitcoincash",
};

/** Block explorer link for a transaction id. */
export const explorerTx = (network: BchNetwork, txid: string) =>
  network === "mainnet"
    ? `https://blockchair.com/bitcoin-cash/transaction/${txid}`
    : `https://chipnet.chaingraph.cash/tx/${txid}`;

/**
 * Electrum providers are cached per network. Each one opens a WebSocket to a
 * public Fulcrum server (CashScript's defaults: chipnet.bch.ninja for chipnet,
 * bch.imaginary.cash for mainnet). Override with VITE_ELECTRUM_CHIPNET /
 * VITE_ELECTRUM_MAINNET if a default server is down.
 */
const providers = new Map<BchNetwork, ElectrumNetworkProvider>();

export function getProvider(network: BchNetwork): ElectrumNetworkProvider {
  let provider = providers.get(network);
  if (!provider) {
    const hostname =
      network === "chipnet"
        ? import.meta.env.VITE_ELECTRUM_CHIPNET
        : import.meta.env.VITE_ELECTRUM_MAINNET;
    provider = hostname
      ? new ElectrumNetworkProvider(network, { hostname })
      : new ElectrumNetworkProvider(network);
    providers.set(network, provider);
  }
  return provider;
}
