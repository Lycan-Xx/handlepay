# HPAY-BIND v1: binding a name to a Bitcoin Cash address

Status: implemented and running on mainnet and chipnet (November 2026).
Reference code: [`src/lib/binding.ts`](../src/lib/binding.ts),
[`src/lib/resolve.ts`](../src/lib/resolve.ts) and [`src/lib/auth.ts`](../src/lib/auth.ts),
also published as [`@handlepay/resolve`](../packages/resolve). The free-name registry
(section 10) is [`functions/_lib/names.ts`](../functions/_lib/names.ts), and keys kept in the
browser (section 11) are [`src/lib/signer.ts`](../src/lib/signer.ts) and
[`src/lib/backup.ts`](../src/lib/backup.ts).

## 1. Goal

A payer types `local@domain` and gets a Bitcoin Cash address they can trust, with no
central server. The design has to hold up against the most common attack: someone copying
a victim's address into their own profile, or swapping the address in a link.

## 2. Overview

Three facts are chained together. Each one is checked by a different party:

```
name@domain ──NIP-05──▶ Nostr key ──signed binding event──▶ BCH address
                            ▲                                   │
                            └──── proof transaction spent ◀─────┘
                                  from that address names the key
```

1. **Name → key.** The domain serves `/.well-known/nostr.json` listing the name's Nostr
   public key ([NIP-05](https://github.com/nostr-protocol/nips/blob/master/05.md)).
2. **Key → address.** The key signs a binding event that names the address and a proof
   transaction.
3. **Address → key.** The proof transaction is spent *from* that address and commits to the
   key in an `OP_RETURN` output. Only someone holding the address's private key can make it.

Facts 2 and 3 point at each other, and together they make the binding. A party who controls
only one side, a Nostr key or a BCH address, can't produce both.

The two keys are separate:
- **The BCH key** stays in the user's wallet, which only signs (section 9).
- **The Nostr key** lives either in a Nostr browser extension (NIP-07), or in this browser's
  own storage, made by HandlePay for people who don't have an extension (section 11).

Neither key is ever sent to a server. The Nostr key controls the name's records, never any
money.

## 3. Proof transaction

| Part | Rule |
|---|---|
| Inputs | One or more, and **every** input spends a coin locked (P2PKH) to the bound address |
| Output carrying the proof | `OP_RETURN` with exactly three pushes, see below |
| Other outputs | Free; HandlePay sends the change back to the same address |
| Confirmations | At least 1 before the binding counts |

The proof output's locking bytecode must be exactly these 41 bytes:

```
6a                       OP_RETURN
04 48504159              push 4: "HPAY"
01 01                    push 1: version 1
20 <32 bytes>            push 32: x-only Nostr public key (the binding event's author)
```

Any other form, such as a different push opcode, extra data or a different length, doesn't
count as a proof.

## 4. Nostr events

Addresses in tags are written without the `bitcoincash:` or `bchtest:` prefix. Readers
accept them with or without it.

### 4.1 Binding: kind 30145, addressable, `d` = `bch-bind`

> 30145 is a placeholder kind until a number is agreed with Paytaca.

```json
{
  "kind": 30145,
  "tags": [
    ["d", "bch-bind"],
    ["payto", "bitcoincash", "qqxeuaneldpe…xvl0"],
    ["proof", "<proof txid, 64 hex>"],
    ["network", "mainnet"],
    ["nip05", "sani@lycanforge.com.ng"]
  ],
  "content": "{\"v\":1,\"network\":\"mainnet\",\"address\":\"qqxeuaneldpe…xvl0\",\"proof\":{\"type\":\"op_return_spend\",\"txid\":\"<proof txid>\"}}"
}
```

**Rules:**
- **Agreement:** the tags and the content must agree on the address, the proof txid and the
  network. If they don't, the event is invalid.
- **Versions:** `v` must be `1`, and `network` must be `mainnet` or `chipnet`.
- **Addresses:** the address must be P2PKH on that network.
- **Optional tag:** `nip05` is informational only and is never trusted.

### 4.2 Revoke

The same kind and `d` tag, with content `{"v":1,"revoked":true}`. Because the event is
addressable, it replaces the binding.

### 4.3 Payment target: kind 10133 ([NIP-A3](https://github.com/nostr-protocol/nips))

`["payto", "bitcoincash", "<bare address>"]`, with empty content. This is published
alongside the binding so other Nostr clients can find the address. On its own it proves
nothing, so it is shown as **Claimed**.

### 4.4 Paytaca's existing format: kind 30078, `d` = `paytaca:bch-address`

This is read-only. The content is either a bare address or `{"address": "..."}`. It is
shown as **Claimed**, never Verified.

## 5. Resolving a name: `resolveHandle`

Input: `local@domain`, a network, and optionally the last result this browser pinned.

1. **Parse.** Lowercase the input and split at the last `@`. A non-ASCII name is allowed but
   flagged, because it may be a look-alike.
2. **NIP-05.** Fetch `https://domain/.well-known/nostr.json?name=local`, without following
   redirects (NIP-05 forbids them).
   - If the browser blocks the request (CORS), retry through a proxy when one is configured.
   - If the domain doesn't list the name, the result is **Not found**.
   - If the domain can't be reached at all, report that, and don't show Not found.
3. **Relays.** Query the relays the NIP-05 file lists for this key, plus three defaults
   (`relay.damus.io`, `nos.lol`, `relay.primal.net`). Ask for the author's kinds 30145,
   10133 and 30078. Check every signature again locally, drop events from any other author,
   and take the newest valid event of each kind.
   - Connect to the relays first. If **not one** relay accepts a connection, stop with
     "couldn't check" (`RelaysUnreachableError`). Without that first step, "no relay
     answered" and "this key has no records" would both look like an empty result, and a dead
     connection would show as **Not found**.
4. **Revoked binding:** the result is **Not found** ("Binding revoked").
5. **Binding present:** fetch the proof transaction and each parent transaction it spends,
   then check from the raw bytes:
   1. The proof transaction's bytes hash to the txid in the event.
   2. **spends:** every input spends an output locked to the claimed address. Each parent is
      also re-hashed against its txid.
   3. **commits:** an output is the exact `OP_RETURN HPAY 01 <pubkey>` with the event
      author's key.
   4. **confirmed:** at least 1 confirmation.
   5. **network:** the event's network matches the page's network.

   If all pass, the result is **Verified**. If any fails, it's **Claimed**, with the first
   failed check named.
6. **No binding, but a payto or Paytaca event:** the result is **Claimed** ("No BCH proof
   from this address").
7. **Nothing at all:** the result is **Not found**.
8. **Trust on first use.** If this browser saw the name Verified before with a different key
   or address, the result is **Changed**, and the user must acknowledge it before paying.
   Only Verified results are pinned.

A server that doesn't answer is not evidence against a name. When no relay can be reached
(step 3), or the chain server doesn't answer (step 5), the resolver reports "couldn't check"
rather than Not found or Claimed, and the page offers to try again. A server that says the transaction doesn't exist does
count as evidence.

### Result states

| Status | Meaning | Paying |
|---|---|---|
| `verified` | Every check passed | Allowed |
| `claimed` | A signed claim, but control of the BCH address isn't proven | Only after an explicit "pay unverified" confirmation |
| `changed` | Verified now, but different from what this browser saw before | Only after the user acknowledges the change |
| `not_found` | No such name, no binding, or a revoked binding | Blocked |

## 6. Pay links

`/pay/<local@domain>?amount=<USD>&memo=<text>&network=<mainnet|chipnet>`

- **Recipient:** the address always comes from the resolver (step 5). A `to=` parameter, or
  any other way of naming an address in the link, is ignored.
- **`amount` and `memo`:** only pre-fill the form. They're visible and can be edited before
  paying.
- **`network`:** switches the page's network so the link works from either.

## 7. Signing in with a name (challenge–response)

1. The verifier makes a random 32-byte challenge, as hex.
2. The user signs, with the name's key (a browser extension, or the key kept in this
   browser), a kind 22242 event with tags `["challenge", <hex>]` and
   `["relay", <verifier origin>]`.
3. The verifier checks:
   - the signature;
   - the challenge;
   - the origin;
   - that `created_at` is within 5 minutes;
   - that the author is the key the name resolves to (step 2).

On the `/auth` demo page, both ends run in the browser. A real site must create and remember
the challenge on its own side.

## 8. Creating and updating a binding

The `/identity` page runs these seven steps, one at a time:

1. **Name.** Either a free name on HandlePay's domain (section 10), or a name on your own
   domain.
2. **Key.** Make a key in this browser, use a Nostr extension, or restore a backup
   (section 11).
3. **Backup.** For a key kept in the browser only: save it, then confirm you did. Extension
   users skip this step, because the extension holds the key. Then link the name to the key:
   claim the free name (a request signed with the key), or put the name in your own domain's
   `/.well-known/nostr.json`. Both stay disabled until a browser key is backed up.
4. **Wallet.** Connect a wallet through WizardConnect. Its first receive address (index 0)
   is the one bound.
5. **Proof.** Send the proof transaction, with coins taken from that one address only, and
   wait for 1 confirmation.
6. **Publish.** Sign the binding event and the kind-10133 payto event, and publish them to the
   three default relays.
7. **Done.** The page runs the resolver on your own name to confirm it shows Verified, and
   gives you the pay link.

**To update:** run the same steps again with the new address. The newer event replaces the
older one. **To revoke:** publish the revoke event (section 4.2).

## 9. Transactions

The app never holds a BCH key, and never asks a wallet to broadcast:
- The app builds the transaction, and the wallet only signs it (WizardConnect, with
  `broadcast: false`).
- The app sends the signed transaction through a public Fulcrum server, on the page's
  network.
- The receipt shows three honest states. **Submitted:** the txid is known. **Seen:** the
  server returns the transaction. **Confirmed:** it has 1 or more confirmations.

## 10. Free names: the HandlePay registry

Owning a domain was the biggest barrier to getting paid by name. So HandlePay can play "the
domain" for names like `alice@handlepay.lycanforge.com.ng`. The registry is a small
Cloudflare Pages Function, with one KV store bound as `NAMES`.

### 10.1 What it serves

| Request | Answer |
|---|---|
| `GET /.well-known/nostr.json?name=alice` | Standard NIP-05: `{"names":{"alice":"<pubkey>"}}`, or `{"names":{}}`. Open CORS (`*`) |
| `GET /api/names?name=alice` | `{"available":true}`, or `available:false` with the reason (`taken`, `reserved`, `too_short`…). Add `&pubkey=` to learn whether it's already yours |
| `POST /api/names` with `{"action":"claim","name":"alice"}` | Links the name to the key that signed the request. Answers 201 when new, or 200 when the key already holds it |
| `POST /api/names` with `{"action":"release","name":"alice"}` | Frees the name. Only the key that holds it can do this |

If the KV store isn't bound, `/api/names` answers 503 ("not switched on") and the NIP-05
file is empty. The rest of the site works unchanged.

### 10.2 Who is asking: NIP-98 signed requests

There are no passwords or accounts. Every `POST` carries `Authorization: Nostr <base64
event>`, where the event is signed by the name's key and has:
- kind 27235;
- a `u` tag with the request's URL;
- a `method` tag, `POST`;
- a `payload` tag with the SHA-256 of the exact request body.

The server checks the signature, that the URL's origin and path and the method match, that
the body hash matches, and that `created_at` is within 60 seconds of its clock. Each signed
request works **once**: its event id is remembered for 180 seconds, longer than the 60-second
window, so a captured header can't be replayed.

### 10.3 Rules

- **Shape:** 3 to 24 characters: lowercase letters, digits, `-` and `_`. It must start and
  end with a letter or digit, with no `--`.
- **Reserved:** names that would look official or belong to the demo, such as `sani`,
  `admin`, `handlepay`, `paytaca` and `wallet`. The full list is in
  [`src/lib/hostedRules.ts`](../src/lib/hostedRules.ts).
- **At most 3 names per key**, first come, first served.
- **At most 10 writes per network address per hour**, as a best-effort limit.
- **Requests are small:** a body over 1 KB is refused.
- **One copy of the rules** is shared by the page (to warn early) and the server (to
  enforce).

### 10.4 What the registry can and can't do

- **It can't make anyone Verified.** It only provides fact 1 (name → key). Facts 2 and 3
  still need the owner's own Nostr signature and a proof transaction spent from their own
  address. If the registry listed a wrong key, that key's owner couldn't make a proof from
  the real owner's address, so the name would come out **Claimed**, not Verified.
- **What you trust it for** is what you trust any NIP-05 domain for: that the name maps to
  the right key. A returning payer is protected by trust on first use (step 8): a changed
  key shows **Changed**. A payer's first visit has no history to compare with (see the
  [threat model](THREAT-MODEL.md)).
- **It stores only** name → key, plus which names each key holds. There are no accounts and
  no payment data.
- **KV storage isn't transactional.** If two keys claim the same name at once, the server
  reads the record back after writing it, and only the key the store kept gets the name.

## 11. Keys kept in the browser, and backups

Most people don't have a Nostr extension, and needing one was a barrier. So `/identity` can
make a key and keep it in this browser's storage (`localStorage`, as hex).

- **It never controls money.** It signs only the name's records: the binding, payto and
  revoke events, registry requests, and sign-in challenges. The BCH proof still has to come
  from the wallet.
- **It lives only on this device.** Anyone who can read this browser's storage could use
  it. The page says so.
- **A backup is required before the name is claimed** (section 8, step 3). The page offers
  two files, both made in the browser with no network request:
  - `handlepay-key-<name>.txt`, which holds the key as `nsec` (plain text; guard it);
  - `handlepay-key-<name>.ncryptsec.txt`, which holds the key encrypted with a password you
    choose ([NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md), `ncryptsec`).
- **Restore** ("I have a backed-up key") accepts either file, picked or pasted, or a bare
  key. It finds the `ncryptsec1…`, `nsec1…` or 64-hex key line and ignores the public key
  (`npub`) in the file. A restored key counts as backed up.
- **Losing the key** means losing control of the name's records. The money stays in the
  wallet either way.
