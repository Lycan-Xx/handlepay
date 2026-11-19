import { ElectrumNetworkProvider } from "cashscript";

export type BchNetwork = "chipnet" | "mainnet";

/** CashAddr prefix for each network. */
export const PREFIX: Record<BchNetwork, "bchtest" | "bitcoincash"> = {
  chipnet: "bchtest",
  mainnet: "bitcoincash",
};

/**
 * Link to HandlePay's own transaction page. Public chipnet explorers proved
 * unreliable (some only show unconfirmed transactions, one sits behind a bot
 * check), so links go to /tx/<txid>, which reads the transaction from the same
 * server the app already uses. The network is in the link so a shared link
 * shows the right chain. Absolute when a browser origin is available, so a
 * copied receipt carries a working link.
 */
export const explorerTx = (network: BchNetwork, txid: string) => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/tx/${txid}?network=${network}`;
};

/** Third-party explorers, offered as a second opinion on the transaction page. */
export const externalExplorers = (network: BchNetwork, txid: string): { name: string; url: string }[] =>
  network === "mainnet"
    ? [
        { name: "Blockchair", url: `https://blockchair.com/bitcoin-cash/transaction/${txid}` },
        { name: "Blockchain.com", url: `https://www.blockchain.com/explorer/transactions/bch/${txid}` },
      ]
    : [
        { name: "Chaingraph", url: `https://chipnet.chaingraph.cash/tx/${txid}` },
        { name: "Imaginary (unconfirmed only)", url: `https://chipnet.imaginary.cash/tx/${txid}` },
      ];

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

export interface ChainTx {
  hex: string;
  /** 0 while in the mempool. */
  confirmations: number;
}

/**
 * Raw transaction plus confirmation count, from Fulcrum's verbose
 * `blockchain.transaction.get`. Callers re-hash `hex` against the txid; the
 * server is only trusted for availability and confirmation depth.
 */
export async function getTransaction(network: BchNetwork, txid: string): Promise<ChainTx> {
  const result = (await getProvider(network).performRequest("blockchain.transaction.get", txid, true)) as unknown;
  if (typeof result === "string") return { hex: result, confirmations: 0 };
  const r = result as { hex?: unknown; confirmations?: unknown };
  if (typeof r?.hex !== "string") throw new Error(`Transaction ${txid} not found.`);
  return { hex: r.hex, confirmations: typeof r.confirmations === "number" ? r.confirmations : 0 };
}
