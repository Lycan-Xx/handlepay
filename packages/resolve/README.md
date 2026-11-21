# @handlepay/resolve

Turn a name like `sani@lycanforge.com.ng` into the Bitcoin Cash address it has **proven** it
controls, or into the reason it hasn't.

This is the verification code behind [HandlePay](https://handlepay.lycanforge.com.ng),
packaged so any wallet, shop or app can pay people by name. There's no HandlePay server in
the loop: it reads the name's domain, public Nostr relays, and the BCH chain directly.

```bash
npm install @handlepay/resolve
```

## Use it

```ts
import { resolve } from "@handlepay/resolve";

const r = await resolve("sani@lycanforge.com.ng", { network: "mainnet" });

switch (r.status) {
  case "verified":  // every check passed: safe to pay r.address
    console.log("Pay", r.address);
    break;
  case "claimed":   // signed claim, but control of the address isn't proven
  case "changed":   // verified, but different from what you pinned last time
    console.log("Ask the user first:", r.reason, r.address);
    break;
  case "not_found": // no such name, no binding, or revoked
    console.log("Can't pay:", r.reason);
}
```

`r.checks` lists every check in order with `ok`, a plain-language `label`, and a `detail`
explaining any failure. It's ready to show to users as "how we checked".

Works in browsers and in Node 22 or later, which has built-in `fetch` and `WebSocket`.
In a browser, some domains block cross-origin NIP-05 requests; pass a proxy through
`fetchNip05`, or set `VITE_NIP05_PROXY` in a Vite app.

## What "verified" means

Three facts that point at each other:

1. `https://domain/.well-known/nostr.json` lists the name's Nostr key (NIP-05).
2. That key signed a binding event naming the BCH address and a proof transaction.
3. The proof transaction was **spent from that address**, and its `OP_RETURN` names the same
   Nostr key. It has at least 1 confirmation.

Someone who copies your address into their own profile can't make fact 3, so their claim
stays `claimed`. The proof and its parent transactions are re-hashed from raw bytes, so a
chain server can withhold data but can't fake it. Full protocol:
[HPAY-BIND v1](https://github.com/Lycan-Xx/handlepay/blob/main/docs/SPEC.md). Threat model:
[THREAT-MODEL.md](https://github.com/Lycan-Xx/handlepay/blob/main/docs/THREAT-MODEL.md).

## Remember what you saw (trust on first use)

```ts
const pinned = loadFromYourStorage(name); // { pubkey, address } | null
const r = await resolve(name, { network: "mainnet", pinned });
if (r.status === "verified") saveToYourStorage(name, { pubkey: r.pubkey!, address: r.address! });
if (r.status === "changed") warnUser(r.previous, r.address);
```

## Other exports

| Export | What it does |
|---|---|
| `resolveHandle(name, network, deps, pinned?)` | The same as `resolve`, with every network lookup injectable, for tests or your own servers |
| `liveDeps(network)` | The default lookups: NIP-05, relays, and Fulcrum (via CashScript) |
| `paymentGate(result)` | `"allowed"`, `"confirm_unverified"`, `"acknowledge_change"` or `"blocked"` |
| `checkProof(input)` | The four BCH checks on a proof transaction, from raw bytes |
| `parseBindingEvent`, `buildBindingEvent`, `buildRevokeEvent`, `buildPaytoEvent` | Read and write the Nostr events |
| `proofOpReturnChunks`, `parseProofOutput` | Write and read the `OP_RETURN "HPAY" 01 <pubkey>` proof output |
| `createChallenge`, `buildAuthTemplate`, `verifyAuthEvent` | Sign-in with a name (challenge–response, kind 22242) |
| `parseHandle`, `fetchNip05`, `queryIdentityEvents` | The lower-level lookups |

## License

MIT
