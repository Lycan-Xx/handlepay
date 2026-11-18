# HandlePay

Pay a verified name instead of a Bitcoin Cash address. Built for BCH BLAZE 2026.

Current state: the Day 1 wallet page (connect with WizardConnect, see balance, send) plus a
developer panel that runs the identity binding end to end. The design is in
`docs/HandlePay — Engineering & Product Spec.md`.

## Run it

```bash
npm install
npm run dev
```

Open the local URL, keep the network on **chipnet**, press **Connect**, and scan the QR with a
WizardConnect wallet (Cashonize, Paytaca or Selene) that is set to chipnet.

1. Copy the receive address shown and fund it from https://tbch.googol.cash/
2. Press **Refresh** until the balance appears.
3. Send 1,000 sats to the same address (or a second wallet) and approve in the wallet.
4. Click the transaction link to see it on the explorer.

### Identity binding (developer panel)

Card 4 runs HPAY-BIND v1 against real relays and a real chain. You need a NIP-07 Nostr
signer extension (Alby or nos2x).

1. **Connect Nostr signer.** The app reads your public key.
2. **Send proof transaction.** It spends only coins at receive address 0 (keep about 2,000
   sats there) and writes `OP_RETURN "HPAY" 01 <your pubkey>`, with change back to the same
   address. Approve it in the wallet.
3. Optionally enter your NIP-05 name, then **Sign and publish binding**. This signs the
   kind-30145 binding and a NIP-A3 `payto` event and publishes both to three relays.
4. Once your domain serves `/.well-known/nostr.json` with your key, enter the name under
   **Check a name**. It shows Claimed ("Waiting for confirmation") until the proof has
   1 confirmation, then Verified.

## Tests

```bash
npm test
```

These are offline unit tests: transaction building and relay serialisation, the proof
transaction format, binding events, the resolver (every badge state, plus the
security-page attacks), NIP-05 lookup, sign-in and amounts. Fixtures are real transaction
bytes and real Schnorr signatures from deterministic test keys.

## How it works

| Step | Code |
|---|---|
| Pairing, QR, reconnects | `useWizardConnect` from `@wizardconnect/react` |
| Addresses from shared xpubs | `deriveAddresses` in `src/lib/wallet.ts` (receive and change, 10 each) |
| Coins | CashScript `ElectrumNetworkProvider.getUtxos` |
| Transaction | CashScript `TransactionBuilder` with `placeholderP2PKHUnlocker`, change at 1 sat/byte |
| Signing request | `generateWcTransactionObject`, then serialised by hand: transaction as hex, source outputs via `sourceOutputToRelay`, plus `inputPaths` per input |
| Broadcast | the wallet broadcasts (`broadcast: true`) and returns the signed hex; the app computes the txid |

Notes from the installed packages (cashscript 0.14.0, @wizardconnect/* 0.2.x):

- CashScript 0.14.0 has no `generateWizardConnectTransactionObject`; `inputPaths` is built manually.
- WizardConnect sends plain JSON, so libauth objects (Uint8Array, BigInt) must be converted first.

## Electrum servers

Defaults are CashScript's (`chipnet.bch.ninja`, `bch.imaginary.cash`). If one is down, create
`.env.local`:

```
VITE_ELECTRUM_CHIPNET=chipnet.imaginary.cash
VITE_ELECTRUM_MAINNET=bch.imaginary.cash
# optional: NIP-05 CORS proxy Worker, used when a domain blocks browser requests
VITE_NIP05_PROXY=https://<your-worker>.workers.dev
```

## Deploy

`npm run build` produces `dist/`, ready for Cloudflare Pages (build command `npm run build`,
output directory `dist`).
