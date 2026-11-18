# HandlePay

Pay a verified name instead of a Bitcoin Cash address. Built for BCH BLAZE 2026.

This is the Day 1 milestone: connect a BCH wallet with WizardConnect, see its address and
balance, and send a payment that the wallet signs and broadcasts.

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
```

## Deploy

`npm run build` produces `dist/`, ready for Cloudflare Pages (build command `npm run build`,
output directory `dist`).
