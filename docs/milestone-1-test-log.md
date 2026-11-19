# Milestone 1: live test log

This is the record of the first end-to-end test of HandlePay against real services: a real WizardConnect wallet, a real Nostr signer, public Nostr relays, a real domain, and the chipnet chain. It covers what we ran, what broke, how we found the cause, and what we changed.

Unit tests (`npm test`, 82 passing) cover the logic in isolation. They could not have caught most of what is listed below, because the failures came from how real wallets, servers and sites behave. That is why this test was run.

- **Date:** 18 Nov 2026
- **Network:** chipnet (test coins only, no real money)
- **Wallet:** Selene (WizardConnect). Selene turned out to be on mainnet throughout; see issue 4.
- **Nostr signer:** nos2x, with a throwaway key
- **Result:** passed. `lycan@lycanforge.com.ng` resolves to **Verified** with all six checks ticked.

## Outcome at a glance

| Part | What it proves | Result |
|---|---|---|
| 1. Pair the wallet | WizardConnect link works; addresses derive from shared public keys | Passed after fix 1 |
| 2. Fund the wallet | App reads coins from the chipnet Fulcrum server | Passed (user error, see issue 2) |
| 3. Plain payment | Hand-built signing request is accepted and signed by a real wallet; txid matches the network | Passed after fixes 2 and 3 |
| 4. Bind address to Nostr key | On-chain proof and signed relay events, with no HandlePay server | Passed |
| 5. Resolve the name | Both halves are checked against each other on live data | Passed |

## Chronology: trial and error

### 1. Taking over the session
The work began in a Claude CLI session that was still running. It had already built the identity panel and a relay-check script and then written the test instructions. Two sessions writing to one history would have conflicted, so the CLI session was stopped first and its transcript was read to rebuild context. The last commit it made (`d3c4efb`) had not been pushed. Pushing was held back until the live test passed.

### 2. Unit tests as a baseline
`npm test` ran first: 5 files, 82 tests, all passing. It was slow (about 150 s) because each file spends about 24 s starting its worker. This confirmed the logic was sound before testing against real services.

### Issue 1: card 2 showed no wallet address after connecting
- **Symptom:** after pairing Selene, card 2 appeared but had no receive address to copy.
- **Diagnosis:** the address list was computed in a `useMemo` keyed on connection state and the manager object. Both are already set before the wallet has shared its public keys. `getPubkey()` returned nothing at that moment, so the list was empty, and nothing triggered a recompute when the keys arrived.
- **Fix:** add `wc.walletName` to the dependencies. It is set when the wallet reports ready, which reruns the derivation. The card also shows "Waiting for the wallet to share its keys" while no address exists, instead of a blank space.
- **Commit:** `0748484`

### Issue 2: the faucet "sent" coins but the wallet stayed empty
- **Symptom:** the faucet reported success and gave a txid, but the balance stayed at zero after refreshing.
- **Diagnosis:** the success link pointed to `blockchain.com/bch-testnet`, which is the plain **testnet**, a different chain from chipnet. The faucet has a network selector (testnet, testnet4, chipnet) and the wrong one had been chosen. The coins existed, but on a chain neither the app nor Selene was reading.
- **Fix:** request again with the selector on **chipnet**. No code change.
- **Lesson:** the faucet's success link is the quickest way to see which network was used.

### Issue 3: the explorer link did not show the transaction
Two separate problems were mixed together here, which made it confusing.

1. **The explorer itself.** The app linked to `chipnet.chaingraph.cash`, which sits behind a bot check ("Just a moment…") that can block the page. We switched to `chipnet.imaginary.cash`, the explorer the faucet already uses for chipnet (commit `05b6c8e`).
2. **The transaction did not exist.** The new explorer answered "No such mempool or blockchain transaction". To rule out the explorer, we asked the chipnet Fulcrum server directly for the txid. It had never seen it.

### Issue 4: the signed transaction never reached chipnet
- **Diagnosis at the time:** every request sets `broadcast: true`, so the app assumed the wallet would send the transaction and returned the txid it computed from the signed hex. Selene signed correctly, but the transaction never reached chipnet. The txid was right; the transaction simply was not on the network. We concluded that Selene does not broadcast.
- **Fix:** after signing, `sendBch` polls the server a few times for the txid. If it is still unknown, the app submits the signed hex itself. An "already known" reply counts as success, because that means the wallet's own broadcast landed in the meantime.
- **Commit:** `d9c05a0`
- **Retest:** the same txid (`f917f1db…`) appeared in the mempool: 219 bytes, 219 sat fee, inputs from one address, change to Selene's change address.
- **What this does and does not prove:** Selene accepted and signed the hand-built request, and the network accepted the signature. That is the riskiest piece of Day 1 and it works.
- **Correction (19 Nov):** the conclusion "Selene does not broadcast" was wrong. Selene never showed a balance, and its network settings list only mainnet servers (cashnode.bch.ninja, bch.imaginary.cash, electroncash.dk and others); it has no chipnet option that we could find. So Selene was on **mainnet** for the whole test. It most likely did broadcast, but to mainnet, where the coins it spent don't exist, so the transaction was rejected. It could still sign correctly, because neither pairing nor signing carries the network: the app turns the shared keys into `bchtest:` addresses only because the page is on chipnet.
- **Why the fallback stays:** it protects against exactly this kind of wallet/page network mismatch, and re-sending a transaction the network already has is harmless.

### Issue 5: no Nostr signer
- **Symptom:** card 4 said "No signer found".
- **First attempt, Alby:** installing Alby did not help. Its extension insists on creating or importing a wallet before it will give out a Nostr key, and it kept redirecting back to its setup page.
- **Fix:** switch to **nos2x**, which just holds a key. A throwaway key was generated with `nostr-tools` and loaded into it. Never use a real identity key for this test: events published to public relays stay there.
- **Side note:** the key the signer ended up using (`93bff6df…`) was not the one generated for the test. This was harmless because the app uses whichever key the signer holds, but it was checked on purpose, since a mismatch could have meant the app put the wrong key into the proof.

### Issue 6: the proof transaction was unreachable in the explorer
The explorer page failed to load for the proof (`685cacd1…`), so we did not rely on it. The transaction was decoded directly from the Fulcrum server and checked by hand:

- one input, 10,000 sats, from the receive address and nowhere else
- output 0: a 0-value OP_RETURN with `HPAY`, version `01`, then the 32-byte Nostr public key
- output 1: 9,765 sats of change back to the **same** receive address
- fee: 235 sats

This is exactly what the spec requires. A proof whose change went elsewhere would have been invalid.

### Issue 7: the domain could not serve the NIP-05 file
Before resolving the name, the domain was inspected with `curl`. Two problems:

1. `https://lycanforge.com.ng/.well-known/nostr.json` redirected with a 307 to `www.`. NIP-05 forbids redirects, and the redirect response had no CORS header, so a browser would block the app's lookup.
2. At `www.` the path returned the site's normal web page, not JSON, because the site rewrites every path to `index.html`.

The fix was made in the LycanForge site, not in HandlePay: a static `nostr.json`, `/.well-known/` excluded from the rewrite, and CORS and content-type headers added. A shell heredoc swallowed a backslash in the regex in `vercel.json` and had to be corrected. The planned CORS-proxy Worker will remove the need for this setup on future domains.

### Binding and resolution
With everything in place:

- The proof transaction `685cacd1…` was confirmed on chain.
- The binding (kind 30145) and payto (kind 10133) events were published to 3 of 3 relays: relay.damus.io, nos.lol and relay.primal.net.
- `scripts/check-binding.mjs` independently confirmed every relay held both events with valid signatures, the right `payto` and `proof` tags, and `network: chipnet`.
- **Resolve** returned **Verified** with all six checks ticked: the domain lists the name, the key signed the binding, the proof was paid from this address, the proof names this key, the proof is confirmed, and the binding is for chipnet.

### Revoke and republish (Part 5c)
- **Revoke:** after pressing Revoke and signing, Resolve returned **Not found · Binding revoked**. The name still resolved to the key, but the key's newest signed event cancelled the binding, so the app refused to verify it.
- **Republish:** signing and publishing the binding again, reusing the remembered proof with no new transaction, made Resolve return **Verified** again.
- **What it proves:** the newest event always wins, so a binding can be revoked and later restored.

### Other wallets on the pay page (Nov 19)
Once `/pay` existed, the same chipnet payment was repeated from Paytaca and Cashonize. Both showed an error after approval, even though the payment had been approved.

- **What the wallets said:**
  - Paytaca showed "missing-inputs".
  - Cashonize said one of the transaction's coins was "missing or already spent". HandlePay first labelled this "cancelled" because the message contains the word "rejected".
- **What the chain said:** the Paytaca payments were on chipnet anyway. Transaction `97854e5e…8469` was signed by Paytaca, broadcast by HandlePay's fallback, and confirmed about four minutes later. The `/tx` page and Chaingraph agreed.
- **Diagnosis:** both wallets were set to mainnet.
  - They signed correctly, because the keys are the same on both networks.
  - Each wallet then broadcast to its own mainnet server. That server had never seen the chipnet coins, so it answered "missing inputs".
  - HandlePay, which checks chipnet itself, saw the transaction was absent and broadcast it.
- **Confirmation:**
  - **Cashonize:** after switching to chipnet, it paid with no error.
  - **Paytaca:** still shows "missing-inputs" because the tester could not find a chipnet switch in its settings. Its payments still arrive through the fallback, and the receipt explains this.
  - **Selene:** works the same way through the fallback, with rough edges still to note.
- **Fixes:**
  - `90e7e24` recognises a wallet that broadcasts its own version of the payment.
  - `f6a1224` replaces the raw errors with a sentence naming the likely network mismatch, and stops calling Cashonize's message a cancellation.

## Findings worth keeping

1. **Do not trust a wallet to broadcast to the right network.** Verify that the network knows the txid before showing it, and broadcast the signed hex yourself if it does not.
2. **A wallet can sign for a network it isn't on.** Pairing and signing carry no network, so a mainnet-only wallet like Selene passes every chipnet check except broadcasting and showing a balance. Test chipnet with Cashonize or Paytaca; test Selene on mainnet.
3. **Check the network first.** Most "nothing arrived" problems were wallet, faucet or explorer on different networks.
4. **Verify against the chain, not the explorer.** When an explorer fails, query the Fulcrum server directly. It separates "the page is down" from "the transaction does not exist".
5. **Derived state must follow the data it depends on.** The address list depended on keys that arrive after the connection is already marked connected.
6. **The hand-built WizardConnect signing request works** with a real wallet, including the restricted-coin spend used for the proof transaction.
7. **NIP-05 hosting is stricter than it looks:** no redirects, JSON content type, CORS open. A site that rewrites every path needs an exemption.

## Commits from this test

| Commit | Change |
|---|---|
| `d9c05a0` | Broadcast the signed transaction ourselves if the wallet did not |
| `0748484` | Re-derive wallet addresses when the wallet's keys arrive |
| `05b6c8e` | Link chipnet transactions to chipnet.imaginary.cash |

## Not covered yet

- Mainnet; this ran on chipnet only.
- Attacks such as one person reusing another's proof. The unit tests cover these; the `/security` page will show them live.
- **Wallet matrix on chipnet:**

  | Wallet | Pair | Pay by name | Wallet's own broadcast | Notes |
  |---|---|---|---|---|
  | Cashonize | ✓ | ✓ | ✓ once set to chipnet | Clean run after switching networks |
  | Paytaca | ✓ | ✓ (arrives through HandlePay's fallback) | ✗ "missing-inputs" | Chipnet switch not found in settings; recheck once it is |
  | Selene | ✓ | ✓ (arrives through HandlePay's fallback) | ✗ (mainnet-only) | Also ran the proof transaction; recheck on mainnet |

- **Mainnet:** all three wallets still need a mainnet run.
