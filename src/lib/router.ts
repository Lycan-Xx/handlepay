/**
 * A tiny path router. The app has a handful of routes, so a dependency isn't
 * worth it: match the pathname, and use the History API to move between pages.
 * Hosting serves index.html for unknown paths, so deep links like
 * /pay/sani@lycanforge.com.ng load the app directly.
 */
import { useEffect, useState } from "react";
import type { BchNetwork } from "./network";

export type Route =
  | { name: "home" }
  | { name: "dev" }
  | { name: "identity" }
  | { name: "pay"; handle: string }
  | { name: "tx"; txid: string }
  | { name: "security" }
  | { name: "auth" }
  | { name: "not_found"; path: string };

export function matchRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  if (path === "/dev") return { name: "dev" };
  if (path === "/identity") return { name: "identity" };
  if (path === "/security") return { name: "security" };
  if (path === "/auth") return { name: "auth" };
  const tx = /^\/tx\/([0-9a-fA-F]{64})$/.exec(path);
  if (tx) return { name: "tx", txid: tx[1].toLowerCase() };
  const pay = /^\/pay\/([^/]+)$/.exec(path);
  if (pay) {
    let handle: string;
    try {
      handle = decodeURIComponent(pay[1]);
    } catch {
      return { name: "not_found", path };
    }
    return { name: "pay", handle };
  }
  return { name: "not_found", path };
}

const NAV_EVENT = "handlepay:navigate";

/** Go to `href` (path + query) without reloading the page. */
export function navigate(href: string): void {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}

/** The current route, kept in sync with back/forward and navigate(). */
export function useRoute(): { route: Route; search: URLSearchParams } {
  const read = () => ({ route: matchRoute(window.location.pathname), search: new URLSearchParams(window.location.search) });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    window.addEventListener("popstate", update);
    window.addEventListener(NAV_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAV_EVENT, update);
    };
  }, []);
  return state;
}

/**
 * Path for a pay link. The handle keeps its "@" so the link stays readable.
 * `network` makes the page switch to that network, so a link to a mainnet
 * name works for someone whose browser is still on chipnet.
 */
export function payPath(handle: string, params?: { amount?: string; memo?: string; network?: BchNetwork }): string {
  const query = new URLSearchParams();
  if (params?.amount) query.set("amount", params.amount);
  if (params?.memo) query.set("memo", params.memo);
  if (params?.network) query.set("network", params.network);
  const q = query.toString();
  return `/pay/${encodeURIComponent(handle).replace(/%40/g, "@")}${q ? `?${q}` : ""}`;
}
