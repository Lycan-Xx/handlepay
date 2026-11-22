import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  CLAIMS_PER_IP_PER_HOUR,
  MAX_NAMES_PER_KEY,
  handleAvailability,
  handleNamesPost,
  handleNostrJson,
  preflight,
  type Env,
  type KV,
} from "../functions/_lib/names";
import { buildHttpAuthTemplate, encodeAuthHeader } from "../src/lib/httpauth";
import { checkLocalName } from "../src/lib/hostedRules";

const HOST = "https://handlepay.example";
const API = `${HOST}/api/names`;
const NOW_MS = 1_800_000_000_000;

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
}

async function post(
  env: Env,
  sk: Uint8Array,
  payload: unknown,
  opts: { ip?: string; nowMs?: number; signedAtMs?: number; rawBody?: string } = {},
) {
  const body = opts.rawBody ?? JSON.stringify(payload);
  const nowMs = opts.nowMs ?? NOW_MS;
  const template = await buildHttpAuthTemplate({
    url: API,
    method: "POST",
    body,
    now: Math.floor((opts.signedAtMs ?? nowMs) / 1000),
  });
  const event = finalizeEvent(template, sk);
  const request = new Request(API, {
    method: "POST",
    body,
    headers: { Authorization: encodeAuthHeader(event), "CF-Connecting-IP": opts.ip ?? "203.0.113.7", "Content-Type": "application/json" },
  });
  const response = await handleNamesPost(request, env, nowMs);
  return { status: response.status, body: await response.json(), headers: response.headers, eventId: event.id };
}

const claim = (env: Env, sk: Uint8Array, name: string, opts = {}) => post(env, sk, { action: "claim", name }, opts);
const release = (env: Env, sk: Uint8Array, name: string, opts = {}) => post(env, sk, { action: "release", name }, opts);

const nostrJson = async (env: Env, query: string) => {
  const r = await handleNostrJson(new Request(`${HOST}/.well-known/nostr.json${query}`), env);
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const available = async (env: Env, query: string) => {
  const r = await handleAvailability(new Request(`${API}${query}`), env);
  return { status: r.status, body: await r.json() };
};

describe("checkLocalName", () => {
  it("accepts ordinary names and lowercases them", () => {
    expect(checkLocalName("Carol")).toEqual({ ok: true, name: "carol" });
    expect(checkLocalName(" a-b_c1 ")).toEqual({ ok: true, name: "a-b_c1" });
    expect(checkLocalName("x".repeat(24)).ok).toBe(true);
  });

  it("rejects names that are too short or too long", () => {
    expect(checkLocalName("ab")).toMatchObject({ ok: false, problem: "too_short" });
    expect(checkLocalName("")).toMatchObject({ ok: false, problem: "too_short" });
    expect(checkLocalName("x".repeat(25))).toMatchObject({ ok: false, problem: "too_long" });
  });

  it("rejects look-alike and awkward characters", () => {
    for (const bad of ["ca rol", "carol!", "car.ol", "-carol", "carol-", "_carol", "ca--rol", "cаrol" /* Cyrillic а */, "carol@x", "ca/rol", "😀😀😀"]) {
      expect(checkLocalName(bad), bad).toMatchObject({ ok: false, problem: "bad_chars" });
    }
  });

  it("rejects reserved names, however they are written", () => {
    for (const r of ["sani", "LYCAN", "admin", "handlepay", "paytaca"]) {
      expect(checkLocalName(r), r).toMatchObject({ ok: false, problem: "reserved" });
    }
  });
});

describe("/.well-known/nostr.json", () => {
  it("lists a claimed name with its key, in the NIP-05 shape", async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    expect((await claim(env, sk, "carol")).status).toBe(201);
    const r = await nostrJson(env, "?name=carol");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ names: { carol: getPublicKey(sk) } });
  });

  it("sends the headers NIP-05 clients need", async () => {
    const r = await nostrJson({ NAMES: memoryKV() }, "?name=carol");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers an unknown name, no name, or a bad name with an empty list, never an error", async () => {
    const env = { NAMES: memoryKV() };
    for (const q of ["?name=nobody", "", "?name=", "?name=BAD NAME", "?name=" + "x".repeat(500)]) {
      const r = await nostrJson(env, q);
      expect(r.status, q).toBe(200);
      expect(r.body, q).toEqual({ names: {} });
    }
  });

  it("finds a name whatever case it was asked in", async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    await claim(env, sk, "carol");
    expect((await nostrJson(env, "?name=CAROL")).body).toEqual({ names: { carol: getPublicKey(sk) } });
  });

  it("never lists more than the one name asked for", async () => {
    const env = { NAMES: memoryKV() };
    await claim(env, generateSecretKey(), "carol");
    await claim(env, generateSecretKey(), "dave");
    const r = await nostrJson(env, "?name=carol");
    expect(Object.keys((r.body as { names: object }).names)).toEqual(["carol"]);
  });

  it("is empty, not broken, when the store isn't set up", async () => {
    const r = await nostrJson({}, "?name=carol");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ names: {} });
  });

  it("never lists a reserved name, even if a record for one were in the store", async () => {
    const kv = memoryKV();
    kv.data.set("name:sani", JSON.stringify({ pubkey: "a".repeat(64), at: 1 }));
    expect((await nostrJson({ NAMES: kv }, "?name=sani")).body).toEqual({ names: {} });
  });

  it("ignores a corrupt stored record", async () => {
    const kv = memoryKV();
    kv.data.set("name:carol", "{not json");
    expect((await nostrJson({ NAMES: kv }, "?name=carol")).body).toEqual({ names: {} });
    kv.data.set("name:carol", JSON.stringify({ pubkey: "short", at: 1 }));
    expect((await nostrJson({ NAMES: kv }, "?name=carol")).body).toEqual({ names: {} });
  });
});

describe("claiming a name", () => {
  it("registers it and records the owner", async () => {
    const kv = memoryKV();
    const sk = generateSecretKey();
    const r = await claim({ NAMES: kv }, sk, "Carol");
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, name: "carol", pubkey: getPublicKey(sk) });
    expect(JSON.parse(kv.data.get("name:carol")!).pubkey).toBe(getPublicKey(sk));
    expect(JSON.parse(kv.data.get(`owner:${getPublicKey(sk)}`)!)).toEqual(["carol"]);
  });

  it("says OK again if the same key claims it twice, without adding it twice", async () => {
    const kv = memoryKV();
    const sk = generateSecretKey();
    await claim({ NAMES: kv }, sk, "carol");
    const again = await claim({ NAMES: kv }, sk, "carol", { nowMs: NOW_MS + 1000 });
    expect(again.status).toBe(200);
    expect(again.body.already).toBe(true);
    expect(JSON.parse(kv.data.get(`owner:${getPublicKey(sk)}`)!)).toEqual(["carol"]);
  });

  it("refuses a name another key already has, and leaves the owner alone", async () => {
    const kv = memoryKV();
    const first = generateSecretKey();
    await claim({ NAMES: kv }, first, "carol");
    const second = await claim({ NAMES: kv }, generateSecretKey(), "carol");
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("taken");
    expect(JSON.parse(kv.data.get("name:carol")!).pubkey).toBe(getPublicKey(first));
  });

  it("treats Carol and carol as the same name", async () => {
    const kv = memoryKV();
    await claim({ NAMES: kv }, generateSecretKey(), "Carol");
    expect((await claim({ NAMES: kv }, generateSecretKey(), "cAROL")).status).toBe(409);
  });

  it("refuses reserved and badly formed names", async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    expect((await claim(env, sk, "sani")).body.error).toBe("reserved");
    expect((await claim(env, sk, "ab")).body.error).toBe("too_short");
    expect((await claim(env, sk, "bad name")).body.error).toBe("bad_chars");
    expect((await claim(env, sk, "x".repeat(40))).body.error).toBe("too_long");
    expect((await post(env, sk, { action: "claim" })).status).toBe(400);
    expect((await post(env, sk, { action: "claim", name: 42 })).status).toBe(400);
  });

  it(`caps one key at ${MAX_NAMES_PER_KEY} names, and lets it claim again after giving one up`, async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    for (const n of ["aaa", "bbb", "ccc"]) expect((await claim(env, sk, n, { ip: `10.0.0.${n}` })).status).toBe(201);
    const fourth = await claim(env, sk, "ddd", { ip: "10.0.0.x" });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toBe("too_many");
    expect((await release(env, sk, "bbb", { ip: "10.0.0.y" })).status).toBe(200);
    // A fresh request is signed at a new time; re-sending the refused one unchanged would count as a replay.
    expect((await claim(env, sk, "ddd", { ip: "10.0.0.z", nowMs: NOW_MS + 5_000 })).status).toBe(201);
  });

  it("does not let a second key take a name in the gap while the store disagrees (lost race)", async () => {
    const kv = memoryKV();
    const winner = generateSecretKey();
    const loser = generateSecretKey();
    // Simulate another claim landing between this request's write and its read-back.
    const racing: KV = {
      ...kv,
      put: async (k, v) => {
        if (k === "name:carol") kv.data.set(k, JSON.stringify({ pubkey: getPublicKey(winner), at: 1 }));
        else kv.data.set(k, v);
      },
    };
    const r = await claim({ NAMES: racing }, loser, "carol");
    expect(r.status).toBe(409);
    expect(JSON.parse(kv.data.get("name:carol")!).pubkey).toBe(getPublicKey(winner));
    expect(kv.data.has(`owner:${getPublicKey(loser)}`)).toBe(false);
  });
});

describe("releasing a name", () => {
  it("frees it for anyone, and removes it from the file", async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    await claim(env, sk, "carol");
    expect((await release(env, sk, "carol", { ip: "10.1.1.1" })).status).toBe(200);
    expect((await nostrJson(env, "?name=carol")).body).toEqual({ names: {} });
    expect((await claim(env, generateSecretKey(), "carol", { ip: "10.1.1.2" })).status).toBe(201);
  });

  it("refuses anyone but the owner", async () => {
    const env = { NAMES: memoryKV() };
    const owner = generateSecretKey();
    await claim(env, owner, "carol");
    const r = await release(env, generateSecretKey(), "carol", { ip: "10.2.2.2" });
    expect(r.status).toBe(403);
    expect((await nostrJson(env, "?name=carol")).body).toEqual({ names: { carol: getPublicKey(owner) } });
  });

  it("says so when the name isn't registered", async () => {
    expect((await release({ NAMES: memoryKV() }, generateSecretKey(), "carol")).status).toBe(404);
  });
});

describe("proof of key and request safety", () => {
  it("refuses a request with no authorization", async () => {
    const env = { NAMES: memoryKV() };
    const r = await handleNamesPost(new Request(API, { method: "POST", body: JSON.stringify({ action: "claim", name: "carol" }) }), env, NOW_MS);
    expect(r.status).toBe(401);
    expect((await nostrJson(env, "?name=carol")).body).toEqual({ names: {} });
  });

  it("refuses a request signed more than a minute ago", async () => {
    const env = { NAMES: memoryKV() };
    const r = await claim(env, generateSecretKey(), "carol", { signedAtMs: NOW_MS - 120_000 });
    expect(r.status).toBe(401);
  });

  it("refuses a captured request used a second time", async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    const body = JSON.stringify({ action: "claim", name: "carol" });
    const template = await buildHttpAuthTemplate({ url: API, method: "POST", body, now: Math.floor(NOW_MS / 1000) });
    const header = encodeAuthHeader(finalizeEvent(template, sk));
    const make = () => new Request(API, { method: "POST", body, headers: { Authorization: header, "CF-Connecting-IP": "10.3.3.3" } });
    expect((await handleNamesPost(make(), env, NOW_MS)).status).toBe(201);
    const replay = await handleNamesPost(make(), env, NOW_MS + 1000);
    expect(replay.status).toBe(409);
    expect((await replay.json()).error).toBe("replay");
  });

  it("does not let a captured 'claim' be reused as a 'release' (the body is signed)", async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    const claimBody = JSON.stringify({ action: "claim", name: "carol" });
    const template = await buildHttpAuthTemplate({ url: API, method: "POST", body: claimBody, now: Math.floor(NOW_MS / 1000) });
    const header = encodeAuthHeader(finalizeEvent(template, sk));
    await handleNamesPost(new Request(API, { method: "POST", body: claimBody, headers: { Authorization: header, "CF-Connecting-IP": "10.4.4.4" } }), env, NOW_MS);
    const releaseBody = JSON.stringify({ action: "release", name: "carol" });
    const r = await handleNamesPost(new Request(API, { method: "POST", body: releaseBody, headers: { Authorization: header, "CF-Connecting-IP": "10.4.4.5" } }), env, NOW_MS);
    expect(r.status).toBe(401);
    expect((await nostrJson(env, "?name=carol")).body).toEqual({ names: { carol: getPublicKey(sk) } });
  });

  it("does not let someone claim a name for a key they don't hold", async () => {
    // The only key a name can be registered to is the one that signed the request.
    const env = { NAMES: memoryKV() };
    const mine = generateSecretKey();
    const victim = getPublicKey(generateSecretKey());
    const r = await post(env, mine, { action: "claim", name: "carol", pubkey: victim });
    expect(r.status).toBe(201);
    expect(r.body.pubkey).toBe(getPublicKey(mine));
    expect((await nostrJson(env, "?name=carol")).body).toEqual({ names: { carol: getPublicKey(mine) } });
  });

  it("rejects bad JSON, unknown actions and oversized bodies", async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    expect((await post(env, sk, null, { rawBody: "not json" })).status).toBe(400);
    expect((await post(env, sk, { action: "delete", name: "carol" })).status).toBe(400);
    expect((await post(env, sk, null, { rawBody: JSON.stringify({ action: "claim", name: "carol", pad: "x".repeat(2000) }) })).status).toBe(413);
    expect((await post(env, sk, null, { rawBody: "null" })).status).toBe(400);
  });

  it(`slows one address after ${CLAIMS_PER_IP_PER_HOUR} writes in an hour, and resets the next hour`, async () => {
    const env = { NAMES: memoryKV() };
    for (let i = 0; i < CLAIMS_PER_IP_PER_HOUR; i++) {
      const r = await claim(env, generateSecretKey(), `user${i}x`, { ip: "198.51.100.9" });
      expect(r.status, `claim ${i}`).toBe(201);
    }
    const blocked = await claim(env, generateSecretKey(), "onemore", { ip: "198.51.100.9" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");
    expect((await claim(env, generateSecretKey(), "elsewhere", { ip: "198.51.100.10" })).status).toBe(201);
    expect((await claim(env, generateSecretKey(), "nexthour", { ip: "198.51.100.9", nowMs: NOW_MS + 3_700_000 })).status).toBe(201);
  });

  it("writes nothing and says 503 when the store isn't set up", async () => {
    const r = await claim({}, generateSecretKey(), "carol");
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("not_configured");
  });

  it("allows cross-origin callers, which is safe because every write is signed", async () => {
    const r = await claim({ NAMES: memoryKV() }, generateSecretKey(), "carol");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const pre = preflight();
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
  });
});

describe("GET /api/names (is it free?)", () => {
  it("says a new name is available", async () => {
    expect((await available({ NAMES: memoryKV() }, "?name=carol")).body).toEqual({ name: "carol", available: true });
  });

  it("says a taken name is taken, and 'yours' only to the key that holds it", async () => {
    const env = { NAMES: memoryKV() };
    const sk = generateSecretKey();
    await claim(env, sk, "carol");
    expect((await available(env, "?name=carol")).body).toMatchObject({ available: false, problem: "taken" });
    expect((await available(env, `?name=carol&pubkey=${getPublicKey(sk)}`)).body).toEqual({ name: "carol", available: false, yours: true });
    expect((await available(env, `?name=carol&pubkey=${getPublicKey(generateSecretKey())}`)).body).toMatchObject({ problem: "taken" });
  });

  it("explains reserved and malformed names", async () => {
    const env = { NAMES: memoryKV() };
    expect((await available(env, "?name=admin")).body).toMatchObject({ available: false, problem: "reserved" });
    expect((await available(env, "?name=a")).body).toMatchObject({ available: false, problem: "too_short" });
    expect((await available(env, "")).body).toMatchObject({ available: false });
  });

  it("answers 503 when the store isn't set up", async () => {
    expect((await available({}, "?name=carol")).status).toBe(503);
  });
});
