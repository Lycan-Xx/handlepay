/**
 * Says why a name's file isn't working, in words a person can act on.
 *
 * This is advice for the identity page only. It never decides whether a name
 * is Verified (resolve.ts does that); it just probes the same URL again and
 * names the likely problem, so "Check again" isn't trial and error.
 */
import type { Handle } from "./nostr";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type Nip05Problem =
  | "ok"
  | "no_file"
  | "blocked_cors"
  | "unreachable"
  | "server_error"
  | "not_json"
  | "no_names"
  | "name_absent";

export interface Nip05Diagnosis {
  problem: Nip05Problem;
  message: string;
}

export async function diagnoseNip05(
  handle: Handle,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<Nip05Diagnosis> {
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? 6_000;
  const url = `https://${handle.domain}/.well-known/nostr.json?name=${encodeURIComponent(handle.local)}`;
  const signal = () => AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    // The same kind of request the checker makes: no redirects, and the browser enforces CORS.
    response = await fetchImpl(url, { redirect: "error", signal: signal() });
  } catch {
    // It failed before we got an answer. A request the page can't read (no-cors) says whether the server
    // replied at all: an opaque answer means it did, and the browser refused to hand it over. A page can't
    // tell a missing CORS header from a redirect, so the message names both.
    try {
      await fetchImpl(url, { mode: "no-cors", signal: signal() });
      return {
        problem: "blocked_cors",
        message: `${handle.domain} answered, but the browser wouldn't accept it. Most often the file is missing the header Access-Control-Allow-Origin: *. It can also be a redirect (www, http or a trailing slash), which NIP-05 doesn't allow: serve the file at exactly this address.`,
      };
    } catch {
      return {
        problem: "unreachable",
        message: `Couldn't reach ${handle.domain}. Check the spelling, that the site is online, and that it has a working https certificate.`,
      };
    }
  }

  if (response.status === 404) {
    return {
      problem: "no_file",
      message: `${handle.domain} has no file at /.well-known/nostr.json. Check the folder name (it starts with a dot) and that it was uploaded to the site's root.`,
    };
  }
  if (!response.ok) {
    return {
      problem: "server_error",
      message: `${handle.domain} answered with an error (${response.status}) for this file. Try again in a minute, or check your host's settings.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      problem: "not_json",
      message: `${handle.domain} answered, but not with JSON. Some hosts send their home page for missing files. Make sure the file exists and holds exactly the JSON shown.`,
    };
  }

  const names = typeof body === "object" && body !== null ? (body as { names?: unknown }).names : undefined;
  if (typeof names !== "object" || names === null) {
    return { problem: "no_names", message: `The file is there but has no "names" section. Use exactly the JSON shown.` };
  }
  if (!(handle.local in names)) {
    return {
      problem: "name_absent",
      message: `The file is there but doesn't list "${handle.local}". Names are case-sensitive; add the line shown.`,
    };
  }
  return { problem: "ok", message: "The file looks right." };
}
