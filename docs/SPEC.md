# HPAY-BIND v1: binding a name to a Bitcoin Cash address

Status: implemented and running on mainnet and chipnet (November 2026).
Reference code: [`src/lib/binding.ts`](../src/lib/binding.ts),
[`src/lib/resolve.ts`](../src/lib/resolve.ts) and [`src/lib/auth.ts`](../src/lib/auth.ts),
also published as [`@handlepay/resolve`](../packages/resolve).

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

The two keys are separate: the Nostr key lives in a Nostr signer (NIP-07 browser extension)
and the BCH key in the user's wallet. Neither ever reaches HandlePay.

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

A chain server that doesn't answer is not evidence against a name. The resolver reports
"couldn't check" rather than Claimed. A server that says the transaction doesn't exist does
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
2. The user signs, with NIP-07, a kind 22242 event with tags `["challenge", <hex>]` and
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

1. Connect a Nostr signer, which provides the public key.
2. Connect a wallet through WizardConnect and choose the address (receive index 0).
3. Send the proof transaction. Its coins are selected from that one address only.
4. Wait for 1 confirmation.
5. Sign and publish the binding event and the kind-10133 payto event to at least 3 relays.
6. Run the resolver on your own name to confirm it shows Verified.

**To update:** run the same steps again with the new address. The newer event replaces the
older one. **To revoke:** publish the revoke event (section 4.2).

## 9. Transactions

The app never holds a key and never asks a wallet to broadcast:
- The app builds the transaction, and the wallet only signs it (WizardConnect, with
  `broadcast: false`).
- The app sends the signed transaction through a public Fulcrum server, on the page's
  network.
- The receipt shows three honest states. **Submitted:** the txid is known. **Seen:** the
  server returns the transaction. **Confirmed:** it has 1 or more confirmations.
