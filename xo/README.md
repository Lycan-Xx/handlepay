# Heartbeat Vault on XO

HandlePay's Heartbeat Vault, rewritten as an [XO](https://xo.cash) template and run on
chipnet with the XO engine.

The vault holds money that the **owner** can spend at any time. It passes to an **heir**
only after the owner has been silent for a set waiting period. The owner can also take the
money back at any time. (A "check in" action that restarts the clock is in the template, but
it doesn't run yet; see [Heartbeat](#heartbeat-why-it-doesnt-run-yet).)

## What's here

| File | What it is |
|---|---|
| [`heartbeat-vault.template.json`](heartbeat-vault.template.json) | The XO template: roles, actions, transactions and scripts |
| [`vault.mjs`](vault.mjs) | Runs the template on chipnet as two separate XO accounts, owner and heir |
| [`invitations/create-vault.json`](invitations/create-vault.json) | Vault 1: the executed invitation that created and funded it |
| [`invitations/claim.json`](invitations/claim.json) | Vault 1: the heir's claim after the waiting period |
| [`invitations/create-vault-2.json`](invitations/create-vault-2.json) | Vault 2: created and funded |
| [`invitations/reclaim-vault-2.json`](invitations/reclaim-vault-2.json) | Vault 2: the owner takes it back, with no wait |
| [`invitations/create-vault-3.json`](invitations/create-vault-3.json) | Vault 3: created and funded, and left unspent so the heir's claim can be shown during judging |
| [`screenshots/`](screenshots/) | Both invitations and transactions opened in blaze.xo.cash |

## The template

**Roles:** `owner` and `heir`.

**Actions:**

| Action | Who | What it does |
|---|---|---|
| `createVault` | owner and heir | Each makes a key. The owner sets the waiting period and the amount, then pays in. |
| `heartbeat` | owner | Moves the vault back into itself, which restarts the waiting period. **Doesn't run yet**; see below. |
| `reclaim` | owner | Spends the vault to any address, with no waiting. |
| `claim` | heir | Spends the vault after the owner has been silent for the whole waiting period. |

**Locking script** (P2SH):

```
OP_IF
  <ownerKey.public_key> OP_CHECKSIG
OP_ELSE
  <timeoutBlocks> OP_CHECKSEQUENCEVERIFY OP_DROP
  <heirKey.public_key> OP_CHECKSIG
OP_ENDIF
```

- **The owner's path:** a signature followed by `OP_1`. There is no wait.
- **The heir's path:** a signature followed by `OP_0`. The heir's input uses
  `timeoutBlocks` as its sequence number (`"sequenceNumber": "$(<timeoutBlocks>)"`).
  So the network itself refuses the claim until the vault coin is old enough.

**Why XO, and not a contract inside the web app.** An in-app CashScript vault was the planned
fallback, and it was never built. WizardConnect wallets can't sign a contract input, so an
in-app version would need a workaround: an extra "key coin" input from the owner's wallet,
spent alongside the vault. That path was never tested with real wallets. XO avoids it,
because the engine signs the vault input itself from the owner key in the template. XO could
express the time lock, so the fallback wasn't needed. An in-app vault is future work.

## The chipnet run

| Step | Invitation | Transaction | Time (UTC) |
|---|---|---|---|
| Owner and heir create the vault, and the owner funds it with 20,000 sats | `4bf7d344ab7e2aa2fa1ebee490e4e6d7` | [`bb11895f…d488`](https://chipnet.imaginary.cash/tx/bb11895f0e873eb1f0bbe8ca24842a19d1e86c2436ff47bd9ac1ae269006d488) | 2026-11-20 20:41 |
| The heir claims 19,500 sats after the waiting period | `4f94d2158865393431d21f5bfcd1c551` | [`5706b227…e1e5`](https://chipnet.imaginary.cash/tx/5706b227f1911c70cfa24f01aaffbf36a727aaccc43e8f8279045edc0233e1e5) | 2026-11-20 22:27 |
| Vault 2: created and funded with 20,000 sats | `d4e70b5028114a6ad22898a930f26e07` | [`ed18527a…bf6f`](https://chipnet.imaginary.cash/tx/ed18527a3299cd89c7bb6b6bd726a51b6646ad77fda6371a2fdd82da335ebf6f) | 2026-11-21 |
| Vault 2: the owner takes 19,500 sats back right away (`reclaim`) | `3e02ae14639819a661ccca85907d2380` | [`4893837c…fc98`](https://chipnet.imaginary.cash/tx/4893837cf64ae423d74cb991b0949b0684c51fbd7aab4f122ac89e32bee3fc98) | 2026-11-21 |
| Vault 3: created and funded with 20,000 sats, **left unspent** | `77ab2c1043193db8acd2368edd49a8c3` | [`61b731ae…7b97`](https://chipnet.imaginary.cash/tx/61b731ae65613faa177c62c77d62644ffd02ea715e78785eb1faf236ee577b97) | 2026-11-21 |

So all three spending paths that work have run on chipnet: the heir's claim after the wait,
the owner's reclaim with no wait, and a new vault that stays open.

The waiting period was 6 blocks. Before it passed, chipnet refused every claim with
`non-BIP68-final`.

> **What we saw on chipnet, and what we can and can't say about it.**
>
> - **The lock is block-based.** The claim's input sequence number is `0x00000006`. In BIP68,
>   bit 22 marks a time-based lock (512-second steps). That bit is clear here, so this is a
>   block-based lock of 6.
> - **Chipnet makes about one block a minute.** We measured 58.8 seconds on average over 100
>   blocks on 20 Nov. Chipnet runs the next network upgrade early, and faster blocks are part
>   of it.
> - **The claim was refused at 27 blocks.** Under classic BIP68 rules, a block-based 6
>   unlocks once the coin is 6 blocks deep. Our claim was refused with `non-BIP68-final` when
>   the vault coin was 27 blocks deep, and accepted about an hour after the vault was made.
>
> This fits old block counts being read on a 10-minute scale, so "6 blocks" keeps meaning
> about an hour. blaze.xo.cash's inspector also talks about a "ten minute height" for time
> locks. We didn't find the exact rule written in the upgrade proposal, so treat this as an
> observation, not a specification.

## Heartbeat: why it doesn't run yet

The owner's check-in failed with:

```
LockingScriptSecretsNotFoundError: Secrets ["ownerKey"] not found in the invitation for locking
script "vaultLockingScript" role "owner" … expected secrets this account generated for the invitation
```

A check-in has to lock the money into a **new** vault output. The engine builds that output's
script from keys made **for that invitation**, but the heartbeat invitation has only the owner
in it, so there is no owner key made for it and no heir key at all. Claim and reclaim work,
because they pay out to a plain address and never rebuild the vault.

Making heartbeat work means redesigning the action. One option is to have the heir join the
check-in, like `createVault`, which defeats the point of a one-person heartbeat. Another is a
template whose new output reuses the keys from the old one. We left that for after the
hackathon, rather than change a working template the night before the deadline.

## Run it yourself

**Prerequisites:** Node 22 and a chipnet wallet with about 0.001 tBCH.

```bash
cd xo
npm install
```

1. **Find the owner's funding address.** This also creates two throwaway seed phrases in
   `.data/seeds.json`, which is git-ignored.

   ```bash
   node vault.mjs owner address
   ```

   Send about 100,000 chipnet sats to the address it prints. Run it again until it shows
   `coins: 1`. The first run can stop with "Connection lost" while the engine catches up
   on block headers; run it again.

2. **The owner opens a vault invitation:** 6-block waiting period, 20,000 sats.

   ```bash
   node vault.mjs owner start 6 20000
   ```

3. **The heir joins and adds their key.**

   ```bash
   node vault.mjs heir join
   ```

4. **The owner funds, signs and broadcasts.** It prints the transaction.

   ```bash
   node vault.mjs owner fund
   ```

5. **The heir loads the finished invitation** and sees the vault coin.

   ```bash
   node vault.mjs heir sync
   ```

6. **Wait about an hour**, then the heir claims. A claim sent too early is refused with
   `non-BIP68-final`. Nothing is lost when that happens, so try again later.

   ```bash
   node vault.mjs heir claim
   ```

   Or, instead of the claim, the owner takes the money back at any time, with no wait:

   ```bash
   node vault.mjs owner reclaim
   ```

The two parties pass the invitation to each other as files in `.data/invitations/`, in
XO's own JSON format (`serializeInvitation` from `@xo-cash/utils`). Two people on two
machines would do the same thing by sending each other the file.

If `owner fund` broadcasts but then stops with an error before saving the file (it happened
once, see below), run `node vault.mjs owner export` to write out the owner's stored copy,
then `heir sync`.

To build a spend and print it without broadcasting, put `DRY=1` in front, for example
`DRY=1 node vault.mjs heir claim`.

## Open it in blaze.xo.cash

1. Go to [blaze.xo.cash](https://blaze.xo.cash) and click **Create new account**. Use it
   for testing only. Check under **Settings** that the network is **chipnet**.
2. Under **Templates**, click **Import Template** and paste `heartbeat-vault.template.json`.
3. On **Home**, click **Join Invitation** and paste `invitations/create-vault.json`. This
   shows all 9 signed commits, the owner and heir roles, and the vault transaction as the
   result.
4. Under **Inspect**, paste either transaction ID. The inspector decodes the vault's
   script, shows `OP_6 OP_CHECKSEQUENCEVERIFY` on the heir's path, and reports the
   transaction as known on chipnet.

## Notes on the engine

- **Pinned versions.** All packages are pinned exactly. The working engine is published
  under npm's `next` tag (`0.1.1-next.18170561234`); the `latest` tag is an older 0.0.1.
- **Storage.** `vault.mjs` uses IndexedDB storage, which also works under Node. The
  SQLite storage in `@xo-cash/state` 0.0.5 isn't finished yet.
- **One account per process.** Only one engine can run in a process, because the network
  connection is shared. That's why each command runs as one party.
- **An error after the broadcast.** Funding vault 3 broadcast correctly, then threw
  `UnspentOutputNotFoundInStoreError` while the engine updated its records: a coin it had
  just spent was already gone from its store. Check the chain before retrying, so you don't
  pay twice.
- **Failed spends are cleaned up.** If a spend fails, `vault.mjs` archives its invitation,
  which frees the vault coin for the next try. The engine otherwise keeps the coin
  reserved for the failed invitation.
