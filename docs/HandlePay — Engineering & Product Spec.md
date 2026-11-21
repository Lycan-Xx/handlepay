# HandlePay — Engineering & Product Spec

Nov 18, 2026 · @root\_x

> **This is the planning document, written on 18 Nov 2026 before most of the build.** It
> records what we intended, and some of it was changed or not built. For what actually
> exists, read the [README](../README.md), the protocol in [SPEC.md](SPEC.md), the
> [threat model](THREAT-MODEL.md) and the [live test log](milestone-1-test-log.md).
> In particular, the in-app CashScript vault described below was never built. The
> Heartbeat Vault runs as an XO template on chipnet instead ([xo/](../xo/README.md)).

## Summary and philosophy

HandlePay lets anyone send Bitcoin Cash to a verified name like `sani@lycanforge.com.ng` instead of a 42-character address, and lets an owner leave BCH to a verified name that unlocks only if they go silent. A name shows **Verified** only when both its Nostr key and its BCH address have proven control, so a scammer who copies someone's address into their own profile is caught.

**Pitch (one line):** Pay people, not addresses — and leave something behind for them if you go quiet.

**Positioning:** proven primitives, new integration. HandlePay never claims to have invented pay-by-name (CashAccounts did that in 2019) or dead-man's switches. The new part is the combination: a dual-proof binding, heirs chosen by verified name, and Nostr discovery, all with no server.

### Principles

1. **Working beats wide.** Judges give each project about two minutes. A flow that completes beats three that half-work. Every feature ships end to end or is cut.
2. **The user never sees the machinery.** No covenant, CSV or npub on the main path. Words on screen: name, verified, pay, heartbeat, claim.
3. **No custody, no server, no accounts.** Keys stay in the user's wallet and Nostr signer. HandlePay holds nothing and can vanish without anyone losing funds or identity.
4. **Verified must mean verified.** Green appears only after every check passes. Anything weaker is amber with the reason shown. Never round a claim up.
5. **Honest about time.** Chain age is blocks, not days; the UI says "about 90 days" and claims are decided by the chain, not the clock.
6. **Real use first.** The Nigerian freelancer and remittance story is the lived case: an invoice link a client pays without ever seeing an address.
7. **Small amounts on mainnet.** Everything judges touch on mainnet is tiny and recoverable.

## Scope and targets

The floor is an eligible Mainnet Track entry that meets all five Paytaca identity requirements; the Heartbeat Vault and XO are layered on top only after that floor works on mainnet.

| Target | Value | Feature that earns it | Priority |
| --- | --- | --- | --- |
| Paytaca Decentralized Identity bounty | $500 PUSD | F1 resolve, F2 binding, F4 auth, F5 resolver + docs | Must |
| Mainnet Track | $3,500 / $1,500 / $750 PUSD + BLISS 2027 | F3 pay on mainnet via WizardConnect, live demo, banner, slides | Must |
| Community Choice | $750 PUSD | EMBER2026 CashTokens address in banner, vote push | Should |
| Build with XO bounty | 0.3 BCH × 10 | F7 Heartbeat Vault as XO template, invitation, feedback essay | Could (gated) |
| TokenHunt pool | share of $250 PUSD | completion tasks | Should |
| Media Track | $1,000 PUSD | 60–90 s demo video, separate entry | Could |

**Not entering:** Migrate to XO (for existing projects — ask GP once), Stablecoin Bridge, SolidCash, FoldingCash.

### Features

| ID | Feature | Tier |
| --- | --- | --- |
| F1 | Resolve a handle and show Verified / Claimed / Not found with the reasons | MVP |
| F2 | Identity setup: Nostr binding event + BCH proof transaction; update and revoke | MVP |
| F3 | Pay link `/pay/<handle>?amount=&memo=` paid through WizardConnect, with receipt | MVP |
| F4 | Challenge–response sign-in demo against the bound Nostr key | MVP |
| F5 | `@handlepay/resolve` package + binding spec + threat model | MVP |
| F6 | Compliance banner: slides, repo, EMBER2026 address | MVP |
| F7 | Heartbeat Vault: create, heartbeat, reclaim, heir claim | Stretch |
| F8 | Security demo page: false claim and URL tampering | MVP |

### Out of scope

Accounts or databases, native mobile apps, reusable payment addresses (RPA), on-chain key rotation (design note only), multiple fiat currencies beyond USD display, encrypted invitation delivery over Nostr (invitations are shared as links).

### Success criteria

- A judge opens the demo link and completes a real mainnet payment to a pre-seeded verified handle in under 60 seconds, with no account.
- The security demo shows a fake claim as amber within 5 seconds of opening.
- Every Paytaca requirement maps to a working screen or document (see readiness checklist).
- If F7 ships: a pre-aged chipnet vault is claimable by the heir during judging, Nov 23–27.

## System architecture

HandlePay is a static React app with no backend: Nostr relays hold identity records, the BCH chain holds proofs, payments and vaults, and the user's wallet and Nostr signer hold every key.

&#91;embedded content: architecture · 7 parts, no HandlePay server\]

The wallet broadcasts transactions itself; the app only reads chain state through Fulcrum and never sees a private key.

### Stack (pinned versions, as installed Nov 18)

| Layer | Choice | Version |
| --- | --- | --- |
| UI | React + TypeScript on Vite | react 19.3, vite 8.3 |
| Hosting | Cloudflare Pages; one Worker for NIP-05 lookups on other people's domains | — |
| Wallet link | `@wizardconnect/react`, `@wizardconnect/dapp`, `@wizardconnect/core` | 0.2.6 / 0.2.7 / 0.2.10 |
| Transactions + contracts | `cashscript` (TransactionBuilder, ElectrumNetworkProvider, contracts) | 0.14.0 |
| BCH primitives | `@bitauth/libauth` | 3.1.0-next.8 |
| Nostr | `nostr-tools` + NIP-07 browser signer (Alby, nos2x) | 2.26.1 |
| XO (stretch) | `@xo-cash/engine` latest `0.1.0-next.*`, `@xo-cash/templates` | pin on install |
| Chain data | Public Fulcrum over WSS: `chipnet.bch.ninja`, `bch.imaginary.cash`; overridable by env | — |
| Price | One public BCH/USD price endpoint, cached 60 s; amounts always shown in BCH too | — |

### Where truth lives

| Fact | Source of truth | Read by |
| --- | --- | --- |
| Name → Nostr key | `https://<domain>/.well-known/nostr.json` (NIP-05) | resolver |
| Nostr key → BCH address | signed binding event on relays (kind 30145, placeholder) | resolver |
| BCH address → Nostr key | OP\_RETURN in a proof transaction spent from that address | resolver via Fulcrum |
| Payments, vault state, vault age | BCH chain | app via Fulcrum |
| Convenience state (network choice, pinned bindings, tracked vaults) | browser localStorage, wrapped in try/catch | app only, never authoritative |

### Repository layout

```text
handlepay/
  src/
    lib/
      network.ts        providers, prefixes, explorer links
      wallet.ts         derive addresses, coins, sendBch (done Day 1)
      nostr.ts          NIP-05 fetch, relay query/publish, NIP-07 signing
      binding.ts        build binding event + proof tx, verify (HPAY-BIND v1)
      auth.ts           challenge create + verify
      vault/
        HeartbeatVault.cash   CashScript contract
        vault.ts              create, heartbeat, reclaim, claim builders
        xo.ts                 XO template + engine glue (stretch)
    routes/            one file per route (see UI/UX)
    components/        VerifyCard, PayPanel, ProofChecklist, Banner, ...
  packages/resolve/    @handlepay/resolve (re-exports lib/nostr + lib/binding verify)
  worker/              Cloudflare Worker: NIP-05 proxy with CORS
  docs/                SPEC.md, THREAT-MODEL.md, XO-FEEDBACK.md (written by hand)
  test/                vitest unit + chipnet integration scripts
```

## Identity binding spec — HPAY-BIND v1

A binding is two proofs that point at each other: a BCH transaction spent from the address commits to the Nostr key, and a Nostr event signed by that key names the address and the transaction. Either alone is a claim; both together are Verified.

### Order of creation

1. User connects Nostr signer (NIP-07) → app reads the x-only pubkey.
2. User connects BCH wallet (WizardConnect) and picks the address to bind (default: receive index 0).
3. App builds the **proof transaction**, spending only coins from that address, and the wallet signs and broadcasts it.
4. App waits for 1 confirmation (about 10 minutes on mainnet; show progress, allow leaving and returning).
5. User signs the **binding event** that names the address and the proof txid; app publishes it plus a NIP-A3 `payto` event to at least 3 relays.
6. App runs the full verification on its own output and shows the result.

### Proof transaction

- Inputs: one or more coins whose locking bytecode is P2PKH of the bound address. No other inputs.
- Output 0: `OP_RETURN` with pushes `0x48504159` (`HPAY`), `0x01` (version), 32-byte x-only Nostr pubkey.
- Output 1: remaining value back to the same address, minus a 1 sat/byte fee.
- Built with the Day 1 `sendBch` path (amount 0, `opReturn` set), with coin selection restricted to the bound address.

### Events

| Kind | Purpose | Tags | Content |
| --- | --- | --- | --- |
| 30145 (placeholder, addressable, `d=bch-bind`) | the binding | `d`, `payto bitcoincash <bare cashaddr>`, `proof <txid>`, `network mainnet\|chipnet`, `nip05 <handle>` | JSON `{v:1, network, address, proof:{type:"op_return_spend", txid}}` or `{v:1, revoked:true}` |
| 10133 (NIP-A3, replaceable) | public payment target for other clients | `payto bitcoincash <bare cashaddr>` | empty |
| 30078 `d=paytaca:bch-address` | read-only fallback from Paytaca's existing format | — | shown as Claimed |

Addresses are written **without** the `bitcoincash:`/`bchtest:` prefix in tags; readers accept both.

### Verification algorithm (`resolveHandle`)

1. Split `local@domain`; fetch `https://domain/.well-known/nostr.json?name=local` (direct, then via Worker on CORS failure). No pubkey → **Not found**.
2. Query relays from NIP-05 `relays` plus 3 defaults for the author's kinds 30145 (`#d=bch-bind`), 10133, 30078. Verify every signature; drop invalid ones.
3. Take the newest valid 30145 event. If `revoked` → **Not found** with reason "binding revoked".
4. Fetch the proof transaction from Fulcrum. Check all of:
   1. at least one input spends an output locked to the claimed address (fetch the parent transaction to read it);
   2. an output is `OP_RETURN HPAY 01 <pubkey>` with the event's own pubkey;
   3. at least 1 confirmation;
   4. network matches.
5. All pass → **Verified**. Event valid but any check fails, or only 10133/30078 found → **Claimed** with the failed check named.
6. Compare with the pinned `{pubkey, address}` in localStorage: different → **Changed** warning before any payment; first sight → pin.
7. URL `amount` and `memo` are display-only; the recipient address comes only from step 5.

### Badge states

| State | Meaning | Payment allowed |
| --- | --- | --- |
| Verified | Nostr signature + confirmed BCH proof both match | Yes |
| Claimed | Signed Nostr claim, BCH control not proven | Only after an explicit "pay unverified" confirm |
| Changed | Verified now, but differs from what this browser saw before | After the user acknowledges the change |
| Not found | No handle, no event, or revoked | No |

### Update and revoke

- **Update:** run setup again with a new address; the newer event replaces the old one (addressable kind).
- **Revoke:** publish the 30145 event with `{v:1, revoked:true}`; resolvers stop paying it.

### Challenge–response sign-in (F4)

1. Verifier (the `/auth` page, or any third-party app) makes 32 random bytes as hex.
2. User signs a kind 22242 event via NIP-07 with tags `["challenge", <hex>]` and `["relay", <verifier origin>]`.
3. Verifier checks the signature, the challenge, `created_at` within 5 minutes, and that the pubkey equals the one the handle resolves to.
4. Result: "Signed in as `sani@lycanforge.com.ng`, Verified." No server involved; the doc states that a real site must create the challenge itself.

## Payment engineering

Every transaction the app makes — payment, proof, vault — goes through one builder (`sendBch` in `src/lib/wallet.ts`, working and offline-tested Day 1) so there is one place to fix bugs.

### Pairing

- `useWizardConnect({ dappName: "HandlePay" })` handles QR, key exchange, session persistence and reconnect.
- State `connected` arrives only after `wallet_ready`, so xpubs are present; derive addresses then, never before.
- Show the QR in `WizardConnectQRDialog`; also show the `wiz://` link as copyable text for desktop wallets.

### Addresses and coins

- Derive P2PKH addresses from the shared xpubs: `receive` (child 0) and `change` (child 1), indexes 0–9 each (`SCAN_DEPTH`). Raise if a test wallet has used more.
- Fetch coins per address with `ElectrumNetworkProvider.getUtxos`; skip coins carrying CashTokens.
- The **EMBER2026 donation address** must be token-aware: encode it with `tokenSupport: true`.

### Building a transaction

1. Select coins largest-first until amount + 2,000 sat buffer is covered. Proof transactions restrict selection to the bound address.
2. `TransactionBuilder` with `maximumFeeSatsPerByte: 5`; each wallet coin uses `placeholderP2PKHUnlocker(address)`.
3. Add the payment output, optional `addOpReturnOutput`, then `addBchChangeOutputIfNeeded({ to: change[0], feeRate: 1 })`.
4. `generateWcTransactionObject({ broadcast: true, userPrompt })`.

### Serialising the sign request (the Day 1 gotcha)

CashScript 0.14.0 has no `generateWizardConnectTransactionObject`, and WizardConnect's relay uses plain `JSON.stringify`, which throws on BigInt. The app therefore sends:

```ts
manager.signTransaction({
  transaction: {
    transaction: binToHex(encodeTransaction(wc.transaction)),   // hex string
    sourceOutputs: wc.sourceOutputs.map(sourceOutputToRelay),    // from @wizardconnect/core/hdwalletv1-serialize
    broadcast: true,
    userPrompt,
  },
  inputPaths: coins.map((c, i) => [i, c.owner.path, c.owner.index]), // only wallet-signed inputs
});
```

Contract inputs (vault) carry complete unlocking bytecode and are **left out** of `inputPaths`.

### Amounts

- Pay links accept USD; convert at the fetched price, round to whole satoshis, and show both "$0.25 ≈ 0.00052 BCH" before approval.
- Minimum output 546 sat (dust); reject smaller amounts with a clear message.
- Default judge amount: $0.25 on mainnet.

### After signing

- Wallet broadcasts (`broadcast: true`). Paytaca may broadcast even when asked not to, so the app never relies on `broadcast: false`.
- App computes the txid from the signed hex and shows three honest states: **Submitted** (we have a txid) → **Seen** (Fulcrum returns it) → **Confirmed** (1+ confirmation). Never say "confirmed" on broadcast.
- Receipt: recipient handle, amount in BCH and USD, memo, txid with explorer link, network, time. Copy button.

### Errors the user can see

| Situation | Message |
| --- | --- |
| Wallet on wrong network | "Your wallet is on mainnet; this page is on chipnet. Switch one of them." (xpubs carry no network, so the app can't detect this directly; show it when the scan finds zero coins, alongside the faucet link) |
| Not enough coins | "You have X BCH; this needs about Y." |
| User rejected in wallet | "Payment cancelled in your wallet." |
| Fulcrum unreachable | "Can't reach the BCH network server. Retrying…" + fallback host |
| No reply from wallet in 90 s | "Open your wallet app to approve" + Cancel (sends `sign_cancel`) |

## Heartbeat Vault

The vault is a 37-opcode CashScript contract with two paths: the owner can move the funds any time, and the heir can claim once the vault coin has gone unspent for a set number of blocks. Both paths are authorised by a sibling input the wallet signs, because WizardConnect cannot sign inside a contract input. *(Correction, 21 Nov: this contract and its tests are not in the repository, so this plan can't show they ran. The in-app vault was never built; see the note at the top.)*

### Contract (`src/lib/vault/HeartbeatVault.cash`)

```solidity
pragma cashscript ^0.14.0;

contract HeartbeatVault(bytes25 ownerLock, bytes25 heirLock, int timeoutBlocks) {
    // Heartbeat or reclaim. The owner chooses the outputs.
    function owner() {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length == 2);
        require(tx.inputs[1].lockingBytecode == ownerLock);
    }

    // Claim after silence. CSV is checked on the vault input itself.
    function heir() {
        require(this.activeInputIndex == 0);
        require(tx.inputs.length == 2);
        require(tx.inputs[1].lockingBytecode == heirLock);
        require(this.age >= timeoutBlocks);
    }
}
```

`ownerLock` and `heirLock` are the 25-byte P2PKH locking scripts of the owner's and heir's addresses. The vault address is P2SH32.

### Why this is safe

- Only someone who can sign for a coin at `ownerLock` (or `heirLock`) can produce input 1; consensus rejects a P2PKH spend without the key.
- WizardConnect wallets sign with `SIGHASH_ALL | SIGHASH_UTXOS`, which commits to every input (including the vault coin) and every output, so the signature cannot be moved to another transaction.
- `activeInputIndex == 0` and `inputs.length == 2` stop one owner coin from unlocking several vaults at once.
- No output rules are needed: in each path the signer is spending money that path entitles them to. Heartbeat versus reclaim is a UI choice, not a contract rule.
- `this.age` compiles to `OP_CHECKSEQUENCEVERIFY` on the vault input. The VM checks the input's sequence number; the network then refuses the transaction until the vault coin is really that old.

### Transactions

| Action | Inputs | Outputs | Signed by |
| --- | --- | --- | --- |
| Create | owner coins | 0: vault (amount) · 1: heir key coin (1,000 sat to heir address) · 2: change to owner address | owner wallet (all inputs in `inputPaths`) |
| Heartbeat | 0: vault · 1: owner key coin | 0: new vault, same address, amount − fee · 1: owner key coin back to the **same** owner address | owner wallet (input 1 only) |
| Reclaim | 0: vault · 1: owner key coin | 0: everything to the owner address | owner wallet (input 1 only) |
| Claim | 0: vault with sequence = timeoutBlocks · 1: heir key coin | 0: everything to the heir address | heir wallet (input 1 only) |

### The key coins

- The contract checks for a coin at one exact address, but wallets rotate addresses. So the **create** transaction also sends 1,000 sat to the heir's address, and heartbeats always return the owner's coin to the same owner address.
- Owner address = the owner's receive index 0. Heir address = the address the heir's verified binding names.
- UI warns both: "Keep at least one small coin at this address; it is your key to the vault."
- Test early that Cashonize and Paytaca let a key coin be spent from a specific address through WizardConnect (the app picks the coin and sets `inputPaths`, so it should).

### Timing

- 1 block ≈ 10 minutes. Silence presets: 6 blocks (demo), 4,320 (about 30 days), 12,960 (about 90 days). CSV in blocks is limited to 65,535 (about 455 days).
- Shown as "about N days"; eligibility = current height − vault coin height ≥ timeoutBlocks, read from Fulcrum.

### Demo pre-ageing

- By **Nov 20**: create chipnet vault A (6 blocks) with a separate heir wallet; leave it untouched so the heir claim is live during judging, Nov 23–27.
- Create vault B (4,320 blocks) to show "not yet claimable — about 30 days".
- Mainnet: one tiny owner-reclaimable vault only, if time allows.

### XO plan (Build with XO bounty, gated Nov 20 end of day)

- Same script, wrapped as an XO template with roles `owner` and `heir`; actions `createPocket` (start), `heartbeat`, `reclaim`, `claim`.
- XO runs its own in-browser wallet per mnemonic, so owner and heir are two engine accounts on chipnet. Payments to judges still go through WizardConnect.
- Deliverables: template file, one executed chipnet transaction via an invitation inspected at blaze.xo.cash, the invitation itself, reproduction steps, and a \~500-word feedback essay **written by Mohammad personally** (AI-written is rejected).
- If the engine can't express CSV or input introspection by the gate, drop XO; the CashScript vault through WizardConnect stays.

## UI/UX

The app should feel like a payment page, not a wallet: one handle field, one badge that tells the truth, one button. Every screen fits a 375 px phone and a laptop, and a judge reaches a mainnet payment in four taps.

### Routes

| Route | Screen | Primary user | Tier |
| --- | --- | --- | --- |
| `/` | Hero, handle search, judge strip (Try the attack · Pay Sani $0.25), three entry cards | everyone | MVP |
| `/pay/:handle` | Verify card → amount → connect → approve → receipt | payer, judge | MVP |
| `/identity` | Three-step setup (Nostr → wallet → proof) + manage (view, update, revoke, copy pay link) | payee | MVP |
| `/auth` | Challenge–response sign-in demo | judge, developer | MVP |
| `/security` | Two attacks side by side: fake claim, tampered link | judge | MVP |
| `/vault` | Tabs: My vaults (owner) · Inherited (heir); create flow; claim flow | owner, heir | Stretch |
| `/developers` | Install, 5-line example, result types, spec and threat-model links | developer | MVP |

### Global elements

- **Compliance banner** (top of every page, required): Slides · Source code · Vote with EMBER2026: `<token-aware address>` (copy). Plus, if any pre-hackathon work exists, the pre-hackathon demo and repo links.
- **Network pill** (chipnet / mainnet) always visible; mainnet shows a one-line "real money, tiny amounts" note.
- **Wallet chip** appears only when an action needs a wallet; shows wallet name and a disconnect menu.

### Key screens and their states

**Verify card** (on `/pay/:handle` and anywhere a handle appears)

| State | Look | Copy |
| --- | --- | --- |
| Checking | grey, 4-row checklist filling in | "Checking sani@lycanforge.com.ng…" |
| Verified | green border + check | "Verified · Nostr signature ✓ · BCH proof ✓ (confirmed)" |
| Claimed | amber | "Claimed, not proven · No BCH proof from this address" + "Pay anyway" behind a confirm |
| Changed | amber + lock icon | "This name now points to a different address than last time" |
| Not found | neutral | "No HandlePay identity for this name" + link to set one up |

A "How we checked" disclosure lists the four checks with the proof txid link — the technical judge's proof.

**Pay flow:** amount (USD with BCH beneath, editable unless the link fixed it) → memo → Connect (QR dialog) → "Approve in your wallet" with Cancel → receipt with Submitted / Seen / Confirmed progress.

**Identity setup:** three numbered cards, each locked until the previous is done; progress survives a reload (step + txid in localStorage); the proof step shows its fee before signing and a 1-confirmation wait with "you can leave this page".

**Vault:** owner card = balance, heir handle with badge, silence period, "claimable by heir in about N days", buttons Heartbeat / Reclaim. Heir card = owner handle, amount, countdown, then "Claim available" with one button. A plain-language rules box on create: "You can take this back any time. Zainab can claim it only if you don't touch it for about 90 days. HandlePay cannot move it."

### The judge path (target under 60 seconds)

1. Open link → banner + hero + judge strip.
2. Tap **Try the attack** → `/security` shows Mallory's claim on Sani's address as amber, with the reason, in under 5 seconds.
3. Tap **Pay Sani $0.25** → `/pay/sani@lycanforge.com.ng?amount=0.25` → green Verified card.
4. Connect (scan with Paytaca, Cashonize or Selene) → approve → receipt with txid.
5. Optional: Vault tab shows the pre-aged chipnet vault ready to claim; Developers shows the package.

### Copy rules

- Say name, verified, pay, heartbeat, claim. Never on the main path: npub, covenant, CSV, UTXO, OP\_RETURN (allowed inside "How we checked").
- Every error says what happened and what to do next, in one sentence.
- Amounts: USD first when the user typed USD, always with BCH beside it.
- Never "confirmed" until it is.

### Design system

- Tokens in `:root` with a dark-mode set (Day 1 `App.css` is the base): ink, muted, line, card, accent green `#0a8f5a`, warn amber, error red. Badge colours always paired with an icon and words (colour-blind safe).
- Type: system UI stack; 16 px body, 24 px hero handle, monospace only for addresses and txids (truncated middle with copy).
- Layout: single 560 px column, 16 px gutters, 12 px card radius, 8 px spacing steps.
- Accessibility: buttons ≥ 44 px tall, focus rings visible, status changes announced with `aria-live="polite"`, QR always paired with a copyable link.

## Security and threat model

HandlePay stops false claims and link tampering outright; it limits but cannot stop a stolen Nostr key or a hijacked domain, and the docs say so plainly.

| Threat | What happens | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Mallory lists Sani's address in her profile | Her event is signed, but no proof transaction from that address commits to her key | Badge stays Claimed with the failed check named | None for HandlePay users |
| Mallory replays Sani's proof txid in her event | The OP\_RETURN commits Sani's pubkey, not hers | Check 4b fails → Claimed | None |
| Tampered pay link (`?amount=`, `?memo=`, extra `to=`) | Parameters change display only | Address comes only from the verified binding; wallet shows the real output before signing | User could approve a wrong amount if careless |
| Domain owner or attacker changes `nostr.json` | Name now points to another key | TOFU pin → Changed warning; the other key also needs its own BCH proof | First-ever visit can't detect it |
| Nostr private key stolen | Thief can publish a new binding to their own proven address | Changed warning for returning payers; revoke and re-bind | Payers who never paid before can be fooled |
| Look-alike handle (`sanl@`, Unicode homoglyphs) | Different name, own valid binding | Show domain prominently; flag non-ASCII handles | Social engineering remains |
| Relays withhold or serve stale events | Older binding or none | Query 3+ relays, take newest valid event | All relays colluding |
| Fulcrum server lies about a transaction | Fake proof or fake payment state | Proof is re-derived from raw transaction bytes; use 2 servers for proof checks if time allows | Single-server trust in MVP |
| Vault: someone else spends it | Needs a signed coin at owner or heir address | Contract checks input 1's lock; tested Nov 18 | None found in tests |
| Vault: heir claims early | CSV blocks it | `this.age` on the vault input; tested Nov 18 | None |
| Vault: owner or heir loses the key coin | Path can't be used until a coin is sent back to that exact address | Warnings; anyone can send a coin to that address to restore it | User error |
| Vault: heir key lost | Funds stay until owner reclaims | Owner can always reclaim | If owner is gone and heir lost keys, funds are stuck |
| Privacy: address reuse | Payments to one address are linkable | Documented; reusable payment addresses listed as future work | Accepted for MVP |

### Out of scope, stated in the docs

- Proving the owner has died: the vault only measures silence.
- Key rotation on chain (CashToken-based identity): design note only.
- An audit: the contract is unaudited; mainnet amounts stay tiny.

## Build plan, Nov 18–22

Pay and identity must work on mainnet by the end of Nov 20; the vault and XO only get the time left after that, and Nov 22 is for checking and submitting, not coding.

&#91;embedded content: build plan · 4 workstreams × 5 days\]

The highlighted cells are the two milestones that protect the entry: mainnet pay on Nov 20 and submission by 12:00 UTC on Nov 22.

### Definition of done per day

- [ ] **Nov 18:** a real wallet pays on chipnet through the Day 1 page; proof transaction builds with coins from one address; binding event signs and publishes; Paytaca and GP questions sent.
- [ ] **Nov 19:** `resolveHandle` returns all five states from fixtures and live relays; NIP-05 for `sani@lycanforge.com.ng` served with CORS; vault create, heartbeat, reclaim and claim work on chipnet with Cashonize; vault A (6 blocks) created and left alone; unit tests green.
- [ ] **Nov 20:** a fresh wallet pays $0.25 to the seeded handle on mainnet; `/auth` and `/security` work; banner and slides draft live. **Gate, end of day:** XO template executes a chipnet invitation → continue XO on Nov 21, otherwise drop it.
- [ ] **Nov 21:** npm package published; SPEC and THREAT-MODEL docs in repo; all routes polished on phone width; judge dry run done; feature freeze at midnight; demo video if time.
- [ ] **Nov 22:** second dry run on a clean profile; BUIDL submitted by 12:00 UTC; vault A confirmed still unspent.

### If a day slips

1. Cut first: XO, then the demo video, then `/developers` beyond the README.
2. Never cut: mainnet pay, Verified/Claimed badges, the security page, banner and slides.

## Testing plan

Every feature is tested at three levels — offline unit, chipnet with real wallets, and a cold judge run on mainnet — and nothing ships to the demo link until its row in the wallet matrix is green.

### Level 1: offline (vitest, runs in seconds)

| Test | Checks | Status |
| --- | --- | --- |
| Transaction build + relay serialisation | payment, OP\_RETURN, change at about 1 sat/byte; request survives `JSON.stringify` | passing (Day 1) |
| Vault contract, VM evaluated | owner spends; Mallory rejected on both paths; heir accepted at sequence 6, rejected at 5; 3-input batch rejected | not in the repo; vault not built in-app |
| Proof transaction parser | finds `HPAY 01 <pubkey>`; rejects wrong prefix, version, length, pubkey | to write |
| Binding verifier | Verified / Claimed / Not found / revoked / Changed from fixture events and transactions | to write |
| Auth verifier | good signature passes; wrong challenge, stale `created_at`, other pubkey fail | to write |
| Amount conversion | USD → sats rounding, dust floor 546 | to write |

**Rule:** contract tests call CashScript's `debug()`, not `build()`. `build()` assembles a transaction without running the script, so attacks pass silently — this happened on Nov 18 and was caught.

### Level 2: chipnet with real wallets

| Flow | Cashonize | Paytaca | Selene |
| --- | --- | --- | --- |
| Pair, reconnect after reload | ☐ | ☐ | ☐ |
| Plain send + receipt | ☐ | ☐ | ☐ |
| Proof transaction (coins from one address only) | ☐ | ☐ | ☐ |
| Vault create (with heir key coin) | ☐ | ☐ | ☐ |
| Heartbeat (vault input not in `inputPaths`) | ☐ | ☐ | ☐ |
| Reclaim | ☐ | ☐ | ☐ |
| Heir claim after 6 blocks | ☐ | ☐ | ☐ |
| Rejection in wallet shows "cancelled" | ☐ | ☐ | ☐ |

A wallet that fails the vault rows is listed in the README as "payments only". The judge path needs at least two wallets green on mainnet.

### Level 3: adversarial cases (run on chipnet, recorded for the security page)

- [ ] Mallory's npub publishes a 30145 event naming Sani's address → Claimed.
- [ ] Mallory's event reuses Sani's proof txid → Claimed (pubkey mismatch).
- [ ] Proof transaction with an extra input from another address → Claimed.
- [ ] Unconfirmed proof → Claimed with "waiting for confirmation".
- [ ] `nostr.json` swapped to another key after first visit → Changed.
- [ ] Pay link with edited `amount` and an injected `to=` → recipient unchanged.
- [ ] Heir tries to claim vault B (4,320 blocks) → wallet or network refuses; UI never offers the button.

### Level 4: judge dry run (Nov 21 and again Nov 22 morning)

- [ ] Fresh browser profile, phone on mobile data, a wallet that has never seen the app.
- [ ] Start a timer at the link; stop at the receipt. Target under 60 s; fix anything over 90 s.
- [ ] Someone who has not seen the project repeats it with only the banner and slides to guide them; note every hesitation.
- [ ] Kill the default Fulcrum host (block it in dev tools) and confirm the fallback works.
- [ ] Check every banner link opens: slides (view access), repo (public), EMBER2026 address copies.

## Hackathon readiness checklist

Submit on DoraHacks by **Nov 22, 12:00 UTC** (13:00 Lagos), two hours before the 14:00 UTC deadline; every box below is ticked first.

### Eligibility

- [x] Registered on DoraHacks before Nov 13.
- [x] Roll call attended (two streams).
- [ ] "Confirming my project is real" message posted in the BCH BLAZE Telegram, with DoraHacks username and HandlePay name.
- [ ] Repo started on or after Nov 14, 14:00 UTC, or forked then with the pre-hackathon state linked in the banner.

### Mainnet Track

- [ ] Live demo at a public URL (Cloudflare Pages), opens without login.
- [ ] Anyone can make a useful mainnet BCH payment through the app (pre-seeded verified handle, $0.25 default).
- [ ] WizardConnect integration working on mainnet with at least two wallets.
- [ ] Top-of-page banner: Widget Factory slides link, public repo link, EMBER2026-capable CashTokens address.
- [ ] Slides made from a copy of the Widget Factory template (no other slide format), set to view-by-link.
- [ ] Pitch covers all four judging categories: innovation, design, technical strength, business potential (free core; Merchant Pro \~$9/month; Vault+ \~$3/month; Nigerian freelancer and remittance corridor first).
- [ ] DoraHacks BUIDL: title, description, demo URL, repo, slides, logo, track = Mainnet, bounties listed in the description (Paytaca identity; XO if built).

### Paytaca Decentralized Identity bounty

- [ ] Req 1 — creation and management: `/identity` set up, update, revoke; keys never leave wallet or signer.
- [ ] Req 2 — cryptographic binding: Nostr-signed event + BCH proof transaction; separate keys; screenshot of both in docs.
- [ ] Req 3 — decentralised discovery: NIP-05 + relays + NIP-A3 `payto`; no HandlePay database.
- [ ] Req 4 — verification and authentication: Verify card + `/auth` challenge–response.
- [ ] Req 5 — demo and docs: live app, public source, setup instructions, `docs/SPEC.md`, `docs/THREAT-MODEL.md`.
- [ ] Stretch shown: send via identity (pay flow), reusable `@handlepay/resolve` package, transaction-as-commitment.
- [ ] Read the bounty page's IP-waiver wording before submitting.

### Build with XO bounty (only if the Nov 20 gate passes)

- [ ] Template on the latest `@xo-cash/engine` `0.1.0-next.*`.
- [ ] Chipnet transaction executed via an invitation; invitation inspected at blaze.xo.cash and submitted.
- [ ] Follow-up actions shown (heartbeat, reclaim, claim).
- [ ] Reproduction steps in the README.
- [ ] \~500-word feedback essay, typed by Mohammad himself.

### Extras

- [ ] EMBER2026 address tested by sending a CashToken to it.
- [ ] Community Choice post on X and Telegram with the demo link (after submission).
- [ ] TokenHunt tasks done.
- [ ] Optional 60–90 s demo video for the Media Track (made Nov 14–22, own submission).
- [ ] Chipnet vault A still unspent and claimable during Nov 23–27; nothing to touch during judging.
- [ ] Mainnet demo wallet topped up with about $5–10 and monitored daily during judging.

## Open questions and decisions

### Open questions

- [ ] Paytaca: preferred kind number or format for the binding event (30145 is a placeholder), and is a proof transaction acceptable for requirement 2? — ask in Paytaca Telegram.
- [ ] GP: can the current XO engine express `OP_CHECKSEQUENCEVERIFY` and `OP_UTXOBYTECODE` on a sibling input, and could a vault built during BLAZE count for Migrate to XO? — ask in GP Telegram.
- [ ] Does Paytaca's WizardConnect return a transaction whose contract input carries complete unlocking bytecode and no `inputPaths` entry? — chipnet test, Nov 19.
- [ ] Which BCH/USD price endpoint is reachable from the browser without a key? — pick on Nov 19.
- [ ] Does Selene list WizardConnect on the current store build? — test on device.

### Decisions log (newest first)

| Date | Decision | Why |
| --- | --- | --- |
| Nov 18 | Vault authorised by a sibling input; no output rules; `activeInputIndex == 0`, `inputs.length == 2` | WizardConnect cannot sign inside contract inputs; signer's SIGHASH\_UTXOS signature commits to the whole transaction (this design was not built; see the note at the top) |
| Nov 18 | Create transaction sends a 1,000 sat key coin to the heir | The contract checks one exact heir address; wallets rotate addresses |
| Nov 18 | Use `generateWcTransactionObject` + manual `inputPaths` + `sourceOutputToRelay` | CashScript 0.14.0 has no WizardConnect helper; relay JSON can't carry BigInt |
| Nov 18 | CSV with `this.age`, never `tx.inputs[i].age` | Only `this.age` compiles to OP\_CHECKSEQUENCEVERIFY on the vault input |
| Nov 18 | NIP-A3 `payto` type `bitcoincash`, address without prefix; readers accept both | NIP-A3 lists `bitcoincash`; avoids `bitcoincash:bitcoincash:` |
| Nov 18 | XO decided at end of Nov 20; CashScript vault is the fallback | XO bounty is 0.3 BCH and the engine is pre-release |
| Nov 16 | Build the full scope solo, with Pay + Identity finished on mainnet first | Founder's call; ordering protects the floor |
| Nov 15 | Lead the demo with the attack, end with the heir claim | Shows what the system prevents within the two-minute judging window |
