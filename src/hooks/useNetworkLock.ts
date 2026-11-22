/**
 * The network lock: while a payment or a proof is in progress, the network
 * control in the header is disabled.
 *
 * Pages are remounted when the network changes (App keys them by network),
 * so switching mid-payment would silently drop the payment's state, and a
 * proof sent on one network must be published on that same network. App owns
 * one boolean; a page holds the lock by calling useNetworkLock(true), and
 * lets go when it passes false or unmounts.
 */
import { createContext, useContext, useEffect } from "react";

export const NetworkLockContext = createContext<(locked: boolean) => void>(() => {});

export function useNetworkLock(active: boolean): void {
  const setLocked = useContext(NetworkLockContext);
  useEffect(() => {
    if (!active) return;
    setLocked(true);
    return () => setLocked(false);
  }, [active, setLocked]);
}
