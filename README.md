# HandlePay

**Pay people, not addresses.** Send Bitcoin Cash to a name like `sani@lycanforge.com.ng`
instead of a 42-character address. Before you pay, HandlePay checks that the name really
controls the address, so a copied or swapped address gets caught.

**Live demo:** https://handlepay.lycanforge.com.ng. No account and no sign-up.

Built for [BCH BLAZE 2026](https://dorahacks.io/hackathon/bchblaze2026/detail) (Mainnet
Track, Paytaca Decentralized Identity bounty, Build with XO bounty).

## Try it in a minute

1. **Try the attack:** [/security](https://handlepay.lycanforge.com.ng/security?network=mainnet). A fresh
   attacker, Mallory, claims Sani's address and tampers with a pay link, live in your
   browser. Both attacks are caught, and no money moves.
2. **Pay Sani $0.25:**
   [/pay/sani@lycanforge.com.ng](https://handlepay.lycanforge.com.ng/pay/sani@lycanforge.com.ng?amount=0.25&network=mainnet).
   The name shows **Verified** with each check listed. Press **Connect**, scan the QR with a
   WizardConnect wallet (Paytaca, Cashonize or Selene), approve, and you get a receipt that
   tracks Submitted → Seen → Confirmed. This is a real mainnet payment of about $0.25.
3. **Get paid by name:** [/identity](https://handlepay.lycanforge.com.ng/identity). Link
   your own wallet to your name in three steps.
4. **Sign in with your name:** [/auth](https://handlepay.lycanforge.com.ng/auth). Log in
   with no password, by signing a challenge with your Nostr key.

## How a name becomes Verified

A name is **Verified** only when two proofs point at each other:

| Proof | Where it lives | Proves |
|---|---|---|
| `name@domain` → Nostr key | `https://domain/.well-known/nostr.json` (NIP-05) | the domain vouches for the key |
| Nostr key → BCH address | a binding event signed by that key, on public relays | the key owner names the address |
| BCH address → Nostr key | a proof transaction **spent from that address**, with `OP_RETURN "HPAY" 01 <pubkey>` | the address owner names the key |

A scammer can copy your address into their own signed event, but they can't spend from your
address, so their claim stays **Claimed** (amber) and is never **Verified** (green). HandlePay
also remembers what it saw for each name in your browser. If the name later points to a
different address, it shows **Changed** before you can pay.

There is no HandlePay server or database. Names live on your own domain and on Nostr, and
proofs and payments live on the Bitcoin Cash chain. Your keys never leave your wallet or
your Nostr signer. See [docs/SPEC.md](docs/SPEC.md) for the full format, and
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) for what it does and doesn't protect against.

## Use the resolver in your own app

[`packages/resolve`](packages/resolve) is the same verification code the app uses,
packaged as `@handlepay/resolve`:

```ts
import { resolve } from "@handlepay/resolve";

const r = await resolve("sani@lycanforge.com.ng", { network: "mainnet" });
if (r.status === "verified") console.log("Pay", r.address);
else console.log(r.status, r.reason); // claimed / changed / not_found, with the reason
```

## Wallets

All signing goes through [WizardConnect](https://github.com/wizardconnect). The wallet only
signs, and HandlePay broadcasts the signed transaction through a public Fulcrum server on the
page's network.

| Wallet | Mainnet pay | Chipnet pay | Proof transaction |
|---|---|---|---|
| Paytaca | ✓ | ✓ | — |
| Cashonize | — | ✓ | — |
| Selene | — | mainnet only | ✓ (mainnet, Sani's binding) |

Results come from the live test log, [docs/milestone-1-test-log.md](docs/milestone-1-test-log.md).
A dash means not tested yet.

## XO

The Heartbeat Vault (savings that pass to an heir after the owner goes silent) is written as
an XO template and was run end to end on chipnet; an in-app version is future work. See
[xo/README.md](xo/README.md).

## Run it locally

```bash
npm install
npm run dev
```

Open the local URL and pick **chipnet** (test coins) or **mainnet** at the top. Chipnet
coins come from https://tbch.googol.cash/; pick **chipnet** in its network selector.

| Command | What it does |
|---|---|
| `npm test` | Offline unit tests: transaction building, proof format, binding events, the resolver (every badge state and both attacks), NIP-05, sign-in, amounts |
| `npm run lint` | oxlint |
| `npm run build` | Type-check and build `dist/` for Cloudflare Pages (output directory `dist`) |

### Electrum servers

The defaults are CashScript's (`chipnet.bch.ninja`, `bch.imaginary.cash`). To use others,
create `.env.local`:

```
VITE_ELECTRUM_CHIPNET=chipnet.imaginary.cash
VITE_ELECTRUM_MAINNET=bch.imaginary.cash
# optional: NIP-05 CORS proxy, used when a domain blocks browser requests
VITE_NIP05_PROXY=https://<your-worker>.workers.dev
```

## Code map

| Path | What it does |
|---|---|
| `src/lib/resolve.ts` | `resolveHandle`: name → Verified / Claimed / Changed / Not found, with the reasons |
| `src/lib/binding.ts` | HPAY-BIND v1: proof transaction format, binding events, `checkProof` from raw bytes |
| `src/lib/nostr.ts` | NIP-05 lookups, relay queries and publishing, NIP-07 signing |
| `src/lib/wallet.ts` | Addresses from WizardConnect xpubs, coin selection, sign requests |
| `src/lib/broadcast.ts` | Sends the signed transaction and tracks Submitted / Seen / Confirmed |
| `src/lib/auth.ts` | Challenge–response sign-in (kind 22242) |
| `src/lib/attack.ts` | The live attacks on `/security` |
| `src/routes/` | One file per page |
| `packages/resolve/` | `@handlepay/resolve`, the publishable resolver |
| `xo/` | The Heartbeat Vault as an XO template |
| `docs/` | Spec, threat model, test log |
