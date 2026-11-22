# HandlePay threat model

**In short:**
- **Stopped outright:** someone claiming another person's address, and someone tampering
  with a pay link. The `/security` page runs both attacks live.
- **Limited, but not stopped:** a stolen Nostr key and a hijacked domain. This document says
  where those limits are.

The protocol is described in [SPEC.md](SPEC.md).

## What we protect

The payer's money: when a name shows **Verified**, the money goes to an address that the
name's owner proved they control.

## Who we assume can attack

- **Mallory**, who can create her own Nostr keys, BCH addresses and domains, publish to any
  relay, and send people links.
- **A relay or chain server** that is down, slow, or hiding events.
- **Someone who has stolen a user's Nostr key**, or taken over a domain. These are handled
  partly; see below.

We don't defend against a compromised browser or device, or a wallet that signs something
other than what it shows.

## Threats

| # | Threat | What happens | Why it fails, or how it's limited | Left over |
|---|---|---|---|---|
| 1 | Mallory publishes a binding naming Sani's address as hers | Her event is validly signed by her key | She can't make a transaction spent from Sani's address that names her key. The **spends** and **commits** checks fail, so the result is **Claimed**, shown amber with the reason | None for HandlePay users |
| 2 | Mallory reuses Sani's real proof txid in her event | Same as 1 | Sani's proof commits to Sani's key, not Mallory's, so **commits** fails and the result is **Claimed** | None |
| 3 | Mallory makes a proof that also spends her own coins | The proof has inputs from two addresses | v1 requires **every** input to come from the bound address, so the result is **Claimed** | None |
| 4 | A pay link is edited: `?to=<Mallory>`, or a changed `amount` or `memo` | The page loads with those values | The recipient comes only from the resolver, and `to=` is ignored. Amount and memo are visible and editable, and the wallet shows the real output before signing | A careless user could approve a wrong *amount*, but never a wrong *recipient* |
| 5 | Mallory serves a fake proof transaction from a chain server | — | The proof and each parent transaction are re-hashed against their txids, so a server can't invent transactions. It can only withhold them, which shows as "couldn't check", not Verified | A lying server could misreport the confirmation count |
| 6 | Relays hide the newest binding or serve an old one | An older binding is used, or none is found | We query the name's own relays plus three defaults and take the newest valid event. Signatures are checked locally | Every queried relay colluding |
| 7 | A domain owner, or someone who took over the domain, changes `nostr.json` to another key | The name now resolves to a different key | That key needs its own proof from its own address. A returning payer sees **Changed** and must acknowledge it | A payer's first-ever visit can't tell |
| 8 | Someone steals a user's Nostr key | They can publish a new binding to an address *they* prove | The new address must carry its own proof. A returning payer sees **Changed**. The owner can revoke and bind again | Payers with no history can be fooled |
| 9 | Look-alike names (`sanl@`, Unicode homoglyphs) | A different name with its own valid binding | The domain is shown prominently, and non-ASCII names are flagged | Social engineering remains |
| 10 | Replay of a sign-in | An old signed event is sent again | The challenge is random per attempt, the origin is checked, and `created_at` must be within 5 minutes | A real site must store the challenge it issued |
| 11 | A wallet broadcasts to the wrong network, or its backend fails | Payment errors, or a transaction lost | The wallet only signs (`broadcast: false`). HandlePay broadcasts on the page's network and treats "already known" as success | — |
| 12 | Privacy: a bound address is public and reused | Payments to it can be linked | Documented | Reusable payment addresses are future work |
| 13 | Free names: someone claims a name for a key they don't hold, or takes over a claimed name | A name points at the wrong key | A claim must be signed by the key it registers (NIP-98 HTTP auth: the signature covers the URL, method and a hash of the body, is under a minute old and works once). A name already held can only be released by its own key | None found |
| 14 | Free names: the host (HandlePay's server) lists a different key for a name, or is taken over | Same as 7: the name now resolves to another key | That key still needs its own BCH proof from an address it controls. It can't make one for the real owner's address, so the real owner's address is never shown as Verified for it. A returning payer sees **Changed** | The same first-visit limit as 7. A payer with no history trusts the host for the name-to-key link, like any domain owner |
| 15 | Free names: squatting and abuse (grabbing many names, scripted claiming) | Good names disappear, storage fills | A reserved list, 3 names per key, 10 writes per network address per hour, first come first served | A determined attacker with many addresses and keys can still take many names. Best-effort limits, not a market |
| 16 | A key kept in the browser is stolen or lost | An attacker can sign as the name, or the owner loses the name | The key never controls money. A stolen key is limited as in 8 (a new binding needs its own proof, and returning payers see **Changed**). Backup and restore are built in; replacing a different saved key needs an explicit tick | A lost key without a backup can't be recovered; anyone who can read this browser's storage can use the key |

## Heartbeat Vault (XO, chipnet)

The vault runs as an XO template ([xo/README.md](../xo/README.md)). It is unaudited and is
used only with small test amounts.

| Threat | Why it fails | Left over |
|---|---|---|
| Someone other than the owner or heir spends it | Both paths need a Schnorr signature from the owner's or the heir's key | None found |
| The heir claims early | The heir's path checks `OP_CHECKSEQUENCEVERIFY` against the input's sequence number, so the network refuses an early claim. This was seen live on chipnet: `non-BIP68-final` until the wait had passed | None |
| The heir loses their key | The owner can still take the money out at any time | If the owner is also gone, the funds are stuck |

## Out of scope

- **Death:** proving the owner has died. The vault measures silence only.
- **Key rotation:** rotating keys on chain, for example with a CashToken-based identity.
  This is a design note only.
- **Audit:** none has been done.
- **Binding kind:** 30145 is a placeholder until a number is agreed with Paytaca.

## How it's tested

- **Unit tests** (`npm test`) cover every badge state, and threats 1–4 run against real
  signed events and real transaction bytes.
- **The `/security` page** runs threats 1, 2 and 4 live against a real name (Sani on mainnet, lycan on chipnet), with
  a fresh attacker each time.
- **Live runs** are recorded in [milestone-1-test-log.md](milestone-1-test-log.md).
