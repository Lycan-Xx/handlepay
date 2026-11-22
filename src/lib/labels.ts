/** Words shared by the header and the pay and proof screens. */
import type { BchNetwork } from "./network";

/** How a network is named on screen: "Mainnet · real BCH", "Chipnet · practice coins". */
export const NETWORK_LABEL: Record<BchNetwork, { name: string; detail: string }> = {
  mainnet: { name: "Mainnet", detail: "real BCH" },
  chipnet: { name: "Chipnet", detail: "practice coins" },
};

/** "Your wallet must be on Bitcoin Cash Mainnet." */
export const walletMustBeOn = (network: BchNetwork) => `Your wallet must be on Bitcoin Cash ${NETWORK_LABEL[network].name}.`;

/** A cash address shortened for a button: prefix dropped, first 6 and last 4 characters. */
export function shortAddress(address: string): string {
  const bare = address.replace(/^[a-z]+:/, "");
  return bare.length > 12 ? `${bare.slice(0, 6)}…${bare.slice(-4)}` : bare;
}
