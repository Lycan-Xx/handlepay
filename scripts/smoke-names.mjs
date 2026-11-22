/**
 * Smoke test for the free-name registry, against any running copy:
 *
 *   node scripts/smoke-names.mjs http://localhost:8788
 *   node scripts/smoke-names.mjs https://handlepay.lycanforge.com.ng
 *
 * It plays a real client with throwaway keys: claims one random name, checks the
 * NIP-05 file, tries the things that must fail, then releases the name so
 * nothing is left behind. It makes 5 writes; the server allows 10 per network
 * address per hour, so don't run it more than once an hour from one place.
 *
 * Needs Node 22.18+ (it loads the TypeScript signing helper directly).
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { buildHttpAuthTemplate, encodeAuthHeader } from "../src/lib/httpauth.ts";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) {
  console.error("Usage: node scripts/smoke-names.mjs <base url>");
  process.exit(2);
}

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function signedPost(sk, payload, { signedAt } = {}) {
  const url = `${base}/api/names`;
  const body = JSON.stringify(payload);
  const template = await buildHttpAuthTemplate({ url, method: "POST", body, now: signedAt });
  const header = encodeAuthHeader(finalizeEvent(template, sk));
  const res = await fetch(url, { method: "POST", body, headers: { Authorization: header, "Content-Type": "application/json" } });
  return { status: res.status, body: await res.json().catch(() => null), header, rawBody: body };
}

const nostrJson = async (name) => {
  const res = await fetch(`${base}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
  return { status: res.status, type: res.headers.get("content-type"), cors: res.headers.get("access-control-allow-origin"), body: await res.json().catch(() => null) };
};

const suffix = Math.random().toString(36).slice(2, 8);
const name = `smoke-${suffix}`;
const owner = generateSecretKey();
const ownerPub = getPublicKey(owner);
const other = generateSecretKey();

console.log(`Testing ${base} with throwaway name "${name}"\n`);

// 0. The file route answers like a NIP-05 file even for an unknown name.
const before = await nostrJson(name);
check("NIP-05 route answers JSON with open CORS", before.status === 200 && /json/.test(before.type ?? "") && before.cors === "*", `${before.status} ${before.type} cors=${before.cors}`);
check("unknown name is simply absent", before.body && typeof before.body.names === "object" && !(name in before.body.names));

// 1. Claim.
const claimed = await signedPost(owner, { action: "claim", name });
if (claimed.status === 503) {
  console.log("\nStore isn't set up on this server (503). Bind a KV namespace as NAMES, then run again.");
  process.exit(1);
}
check("claim is accepted (201)", claimed.status === 201, `${claimed.status} ${JSON.stringify(claimed.body)}`);
check("claim names the signing key", claimed.body?.pubkey === ownerPub);

// 2. The file now lists it.
const after = await nostrJson(name);
check("NIP-05 file lists the name with the owner's key", after.body?.names?.[name] === ownerPub, JSON.stringify(after.body));

// 3. A different key can't take it; a replayed request is refused.
const stolen = await signedPost(other, { action: "claim", name });
check("another key is refused (409 taken)", stolen.status === 409 && stolen.body?.error === "taken", `${stolen.status} ${JSON.stringify(stolen.body)}`);

const replay = await fetch(`${base}/api/names`, { method: "POST", body: claimed.rawBody, headers: { Authorization: claimed.header } });
check("replaying the captured claim is refused", replay.status === 409 || replay.status === 401, `${replay.status}`);

// 4. A reserved name and an unsigned request are refused.
const reserved = await signedPost(other, { action: "claim", name: "admin" });
check("reserved name is refused", reserved.status === 400 && reserved.body?.error === "reserved", `${reserved.status}`);
const unsigned = await fetch(`${base}/api/names`, { method: "POST", body: JSON.stringify({ action: "claim", name: `${name}x` }) });
check("unsigned request is refused (401)", unsigned.status === 401, `${unsigned.status}`);

// 5. Only the owner can release; then it's gone. (4 writes so far counted by the server; this makes 5.)
const wrongRelease = await signedPost(other, { action: "release", name });
check("a different key can't release it (403)", wrongRelease.status === 403, `${wrongRelease.status}`);
const released = await signedPost(owner, { action: "release", name });
check("the owner can release it (200)", released.status === 200, `${released.status} ${JSON.stringify(released.body)}`);
const gone = await nostrJson(name);
check("the file no longer lists it", !(name in (gone.body?.names ?? {})), JSON.stringify(gone.body));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
