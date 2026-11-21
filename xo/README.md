# Heartbeat Vault on XO

HandlePay's Heartbeat Vault, rewritten as an [XO](https://xo.cash) template and run on
chipnet with the XO engine.

The vault holds money that the **owner** can spend at any time. It passes to an **heir**
only after the owner has been silent for a set waiting period. Each time the owner checks
in, the clock starts again.

## What's here

| File | What it is |
|---|---|
| [`heartbeat-vault.template.json`](heartbeat-vault.template.json) | The XO template: roles, actions, transactions and scripts |
| [`vault.mjs`](vault.mjs) | Runs the template on chipnet as two separate XO accounts, owner and heir |
| [`invitations/create-vault.json`](invitations/create-vault.json) | The executed invitation that created and funded the vault |
| [`invitations/claim.json`](invitations/claim.json) | The executed invitation for the heir's claim |
| [`screenshots/`](screenshots/) | Both invitations and transactions opened in blaze.xo.cash |

## The template

**Roles:** `owner` and `heir`.

**Actions:**

| Action | Who | What it does |
|---|---|---|
| `createVault` | owner and heir | Each makes a key. The owner sets the waiting period and the amount, then pays in. |
| `heartbeat` | owner | Moves the vault back into itself, which restarts the waiting period. |
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

**Compared with HandlePay's CashScript vault:** that version needs an extra input from the
owner's own wallet, because WizardConnect wallets can't sign a contract input. XO signs the
vault input itself, from the owner key in the template, so this version doesn't need that
workaround.

## The chipnet run

| Step | Invitation | Transaction | Time (UTC) |
|---|---|---|---|
| Owner and heir create the vault, and the owner funds it with 20,000 sats | `4bf7d344ab7e2aa2fa1ebee490e4e6d7` | [`bb11895f…d488`](https://chipnet.imaginary.cash/tx/bb11895f0e873eb1f0bbe8ca24842a19d1e86c2436ff47bd9ac1ae269006d488) | 2026-11-20 20:41 |
| The heir claims 19,500 sats after the waiting period | `4f94d2158865393431d21f5bfcd1c551` | [`5706b227…e1e5`](https://chipnet.imaginary.cash/tx/5706b227f1911c70cfa24f01aaffbf36a727aaccc43e8f8279045edc0233e1e5) | 2026-11-20 22:27 |

The waiting period was 6 blocks. Before it passed, chipnet refused every claim with
`non-BIP68-final`.

> **Chipnet now makes 1-minute blocks.** Chipnet runs the next network upgrade early, and
> blocks there now arrive about every 60 seconds. A relative lock written in blocks keeps
> its old meaning of 10 minutes per block, so "6 blocks" still means about an hour, which
> is roughly 60 chipnet blocks. The vault coin was 27 blocks old and still locked.

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

   Optionally, before the claim, the owner can check in, which restarts the hour:

   ```bash
   node vault.mjs owner heartbeat
   ```

The two parties pass the invitation to each other as files in `.data/invitations/`, in
XO's own JSON format (`serializeInvitation` from `@xo-cash/utils`). Two people on two
machines would do the same thing by sending each other the file.

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
- **Failed spends are cleaned up.** If a spend fails, `vault.mjs` archives its invitation,
  which frees the vault coin for the next try. The engine otherwise keeps the coin
  reserved for the failed invitation.
