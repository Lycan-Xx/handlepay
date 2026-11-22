# What HandlePay does and doesn't do

Written the day before the deadline, from what was run against the `ux-reskin` branch.
Use it to know your own product before a judge does. The protocol is in
[SPEC.md](SPEC.md) and the attacker analysis is in [THREAT-MODEL.md](THREAT-MODEL.md).

## One sentence

Pay a name like `sani@lycanforge.com.ng` instead of an address. Before any money moves,
HandlePay checks that the name's owner proved they control that address, and refuses to
call it Verified if they haven't.

## What it can do (run and seen working)

| Claim | How it was checked |
|---|---|
| A real name resolves to **Verified** and shows the address it pays | `sani@lycanforge.com.ng` on mainnet and `lycan@lycanforge.com.ng` on chipnet, in the browser against live relays and chain servers |
| A name that doesn't exist shows **Not found**, with no pay form | `nobody@lycanforge.com.ng`, and a bare `abc` |
| A domain that can't be reached shows **Couldn't check**, never Verified | `doesnotexist-handlepay-test.invalid` |
| A fake claim of someone's address is **Claimed**, not Verified, and not recommended | The attack page, both "no proof" and "reuse the real proof" |
| An edited pay link can't change who gets paid: `to=` is ignored and a warning shows | `?to=bitcoincash:qfake` on a real name |
| If a name later points at a different address, the payer sees **Changed** | A planted old address in browser storage |
| The attack page runs on the real chain in a few seconds, with no money moved | 3 to 4 s per run, on mainnet and chipnet |
| The page holds up at phone width with no sideways scrolling | 375 px wide, all seven pages |
| The "why isn't my name file working" helper names the right problem | The probe run against real hosts: OK, name missing, unreachable, blocked/redirect |
| 230 offline tests, lint and the build pass | `npm test`, `npm run lint`, `npm run build` |

## What it can't do, or only half does (say these first)

1. **Names are verified per network.** `sani@` is Verified on mainnet. On chipnet it shows
   **Claimed** with no address, so nothing can be paid, because the proof lives on mainnet.
   `lycan@` is the reverse: Verified on chipnet. The demo links carry `?network=mainnet`.
   A visitor who last used chipnet stays on chipnet until they switch.
2. **First visit has no memory.** "Changed" only protects someone who has visited the name
   before; the memory is in that browser. A stolen Nostr key or hijacked domain can fool a
   first-time payer if the attacker also makes a real proof. This is in the threat model.
3. **Only two demo names are fully Verified.** Anyone can now claim a free
   `name@handlepay.lycanforge.com.ng` with only a wallet (no domain, no extension; the key is
   made in the browser). A new free name becomes Verified only after its owner sends the
   proof transaction from their wallet, and that full run has not been tested end to end. A
   free name's key lives only in that browser unless backed up. Limits: 3 to 24 characters,
   3 names per key, 10 writes per network address per hour.
4. **Payers need a WizardConnect wallet** (Paytaca, Cashonize or Selene), and the
   wallet must be set to the same network. Other BCH wallets can't pay through the page.
   Per the handoff notes, only Paytaca has paid on mainnet so far.
5. **Payments can't be reversed.** On mainnet they are real money. The page says so.
6. **A bound address is public and reused**, so payments to it can be linked. Noted as
   future work.
7. **No vault and no NIP-46 remote signing yet.** Don't imply them. (Hosted free names
   exist; see item 3.) The XO
   vault notes in the repo mention a HandlePay vault; the web app has none.
8. **Event kind 30145 is a placeholder**, not an agreed standard.

## What hasn't been tested (do these yourself, on a phone)

| Item | Why it matters |
|---|---|
| **Connect wallet, then pay $0.25, on a phone** | The one flow not exercised here. Needs your wallet and real coins |
| **The Receipt step after paying** (Submitted, Seen, Confirmed, and the "View transaction details" link) | Only reachable after a real payment |
| **Get-paid steps 2 to 4** (wallet, proof payment, publish) | Needs a Nostr extension, a domain file and a wallet |
| **Sign in with your name at `/auth`**, with a real Nostr extension | The page loads, but signing needs the extension |
| **The deployed preview and then the live site** | These checks ran on a local dev server |
| **The banner**: slides link, repo link, vote address with Copy and QR | `SITE.slides` is still empty |

## Judge path, about 60 seconds

1. Home: read the line, then tap **Pay Sani $0.25**. The name shows **Verified**.
2. Say what the green badge means: two proofs that point at each other.
3. Tap **How it works** (`/security`). Watch a fake Mallory get **Claimed**, not Verified. Nothing is paid.
4. Optional: connect a wallet and send the $0.25. Watch the Receipt follow the chain.

Keep a screen recording of 2 to 4 in case a relay or chain server is slow on the day.

## Manual checklist

Preview first, live site after merging. Tick as you go.

- [ ] Home shows two roles (Create my pay name, Pay someone); light only, by design
- [ ] Pay door → example name → Verified → "Step 3 of 4"
- [ ] `nobody@lycanforge.com.ng` → Not found, no pay form
- [ ] `/pay/sani@lycanforge.com.ng?network=mainnet&to=bitcoincash:qfake` → warning shown
- [ ] How it works → both Mallory attempts amber, none green
- [ ] Switch to Chipnet → `lycan@lycanforge.com.ng` is Verified
- [ ] Connect wallet on a phone; the QR or deep link works
- [ ] Pay $0.25; Receipt moves through Submitted, Seen, Confirmed
- [ ] "View transaction details" opens `/tx/…`
- [ ] Footer "Your name as a login" opens `/auth`
- [ ] Banner has slides link (once set), repo link, vote address, Copy and QR
