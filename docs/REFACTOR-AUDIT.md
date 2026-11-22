# Visual refactor: audit before editing

Written against `main` at `aa588e2` (22 Nov 2026), before any change on the `visual-refactor`
branch. It answers §1 of [REFACTOR-SPEC.md](REFACTOR-SPEC.md).

## Baseline (§1.3)

| Command | Result |
|---|---|
| `npm run build` | Passes. One existing warning: the JS chunk is ~1.1 MB (397 kB gzip), over Vite's 500 kB hint. Not caused by the refactor. |
| `npm test` | 17 files, 219 tests, all pass. |
| `npm run lint` | Clean (oxlint, no output). |

## What the code does today

- **Shell.** `App.tsx` holds the network (`useNetwork`), the one shared wallet (`useWallet`), the
  theme (`useTheme`) and the route (`useRoute`, a 60-line History router). Pages are keyed by
  network (and handle), so **switching the network remounts the page and drops any
  in-progress payment or proof**: that is why the lock in §2.12 matters.
- **Styling.** One stylesheet, `App.css`, with tokens on `:root`, the same dark tokens written
  twice (a `prefers-color-scheme` block and a `[data-theme="dark"]` block), and a `body::before`
  glow driven by `data-tone` from `useTone` (called by Home, Security and `VerifyCard`).
- **Wallet.** `useWallet` wraps `useWizardConnect`. `wc.walletName` exists (the session reports
  the wallet's name) and `wc.disconnect()` exists, so §2.15 needs no new wallet code: the
  header can show the name, and disconnect is already there.
- **Identity (`/identity`).** One 976-line page with three cards: (1) name and key, including
  claim and the domain file; (2) wallet; (3) proof and publish; then the Verified card, pay
  link, a tour-style "next" card, and change/remove. Progress is saved per network in
  localStorage. The "existing binding detected" path is an effect that resolves the name once
  the name check passes and a wallet address is known, and skips proof and publish when it
  finds a Verified binding for this key and address. Backup is an optional `<details>` that
  shows the nsec; `exportBrowserKey` exists but isn't offered in Manage.
- **Payment.** `PayStartPage` → `PayPage` (resolve, `paymentGate`, pins, gates) →
  `PayPanel` (amount, memo, connect, approve) → `Receipt` (polls Submitted/Seen/Confirmed).
  `sendBch` selects coins, builds with placeholder unlockers, asks the wallet to sign with
  `broadcast: false`, then `ensureBroadcast` sends it through Fulcrum. The selected coins'
  addresses are already known inside `sendBch`, so the payer inputs and the fee can be
  returned from there without changing what is built or signed.
- **`/tx/<txid>`.** Reads the raw transaction from Fulcrum, checks it hashes to the txid,
  fetches up to 25 parents to name the inputs and compute the fee, and refreshes every 15 s
  until confirmed. It currently **features the payer's input addresses** in a "From" card,
  which §2.14 says must not appear on `/tx`.

## Reusable as is

`Drawer`, `CopyButton`, `WalletQR`, `FundAddress`, `Journey`, `VerifyCard` (minus the glow),
the `.facts` list, `lib/qr.ts` (`qrcode-generator`), `describeTransaction`,
`buildSignRequest`/`selectCoins` (already used to preview the proof fee), `hasSigner()`, and
`nostr-tools/nip49` (installed, exports `encrypt`/`decrypt`).

## Small logic needed

- **§2.2 name check on `/tx`:** read `?name=`, resolve it with the existing `resolveHandle`, and
  compare the resolved address with the transaction's outputs. No new resolver code.
- **§2.12 network lock:** a tiny context in `App` (a boolean and its setter) plus a
  `useNetworkLock(active)` hook that sets it while active and clears it on unmount.
- **§2.13 review step:** a new phase in `PayPanel` between connect and the signing request. The
  fee is previewed with `selectCoins` + `buildSignRequest`, exactly as Get paid already does
  for the proof.
- **§2.14 fee and payer inputs:** `sendBch` returns them; the receipt data carries them; the
  inputs render only in the print layout.
- **§2.16/§2.19 backup:** NIP-49 export/import in `signer.ts`, a small pure `backup.ts` for the
  file text and for pulling the key out of a pasted or picked file, and a `Blob` download.

## Smallest plan

Follow §15: tokens and removals first (so every later screen is built on the final palette),
then chrome, home, Get paid, pay, receipt and `/tx`, then the remaining pages. Keep existing
class names where possible and restyle them, rather than renaming across the app.

## Risks

- **Routing:** none expected; no route is added or removed. The footer and home links use the
  existing `navigate`.
- **Wallet state:** the header control and Get paid's "Use a different wallet" share one
  connection. Disconnecting mid-payment would break the review; the header disconnect is
  therefore disabled while the network is locked.
- **Identity:** splitting step 1 into Name, Key and Backup must keep the same order of
  effects (name check → existing-binding detection → proof → publish) and the same saved
  progress shape (new fields are optional, so old saves still load).
- **Payments:** the review step must not change coin selection or what is built. The preview
  and the real send call the same functions with the same coins, so they agree; the real send
  still rebuilds from scratch.

## Notes on the palette

`--accent-strong` `#D93A0B` gives 4.60:1 on white but only 4.41:1 on the `--paper` background,
so links on the page would fail. It is darkened to **`#C9360A`** (5.23:1 on white, 5.01:1 on
paper, 4.74:1 on `--surface2`). The status colours in §4.1 (`#16A34A`, `#D97706`) are under
3.5:1 as text, so they are kept for dots, borders and fills, and text uses darker shades of
the same hues (`#15803D`, `#B45309`, `#B91C1C`).
