/**
 * Trust-on-first-use pins: the {pubkey, address} this browser last saw
 * Verified for a name. Convenience state only; never authoritative.
 */
import type { BchNetwork } from "./network";
import type { Pin, Resolution } from "./resolve";

const key = (network: BchNetwork, handle: string) => `handlepay-pin:${network}:${handle.toLowerCase()}`;

export function getPin(network: BchNetwork, handle: string): Pin | null {
  try {
    const raw = localStorage.getItem(key(network, handle));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pin>;
    return typeof p.pubkey === "string" && typeof p.address === "string" ? { pubkey: p.pubkey, address: p.address } : null;
  } catch {
    return null;
  }
}

export function setPin(network: BchNetwork, handle: string, pin: Pin): void {
  try {
    localStorage.setItem(key(network, handle), JSON.stringify(pin));
  } catch {
    /* storage unavailable: no pin, so no Changed warning next time */
  }
}

/**
 * Pin a Verified result on first sight, or after the user acknowledged a
 * Changed one. Claimed results are never pinned.
 */
export function pinResolution(network: BchNetwork, r: Resolution): void {
  if ((r.status === "verified" || r.status === "changed") && r.handle && r.pubkey && r.address) {
    setPin(network, r.handle.full, { pubkey: r.pubkey, address: r.address });
  }
}
