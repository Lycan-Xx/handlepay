/**
 * Runs the Heartbeat Vault XO template on chipnet with two XO engine accounts, an owner and an heir.
 * Each command runs as one party, the way two people would each run their own wallet. They hand the
 * invitation to each other as a file in .data/invitations/, in XO's own serialized format.
 *
 *   node vault.mjs owner address            owner's chipnet wallet address and balance (fund this)
 *   node vault.mjs heir address             heir's chipnet wallet address (claims are paid here)
 *   node vault.mjs owner start <blocks> <sats>
 *                                            owner opens a createVault invitation  -> create.json
 *   node vault.mjs heir join                 heir joins it and adds their key      -> create.json
 *   node vault.mjs owner fund                owner adds the vault output, pays in, signs, broadcasts
 *   node vault.mjs heir sync                 heir stores the executed invitation, so it sees the vault
 *   node vault.mjs owner export              re-save the owner's stored create invitation (if fund
 *                                            broadcast but then failed before saving it)
 *   node vault.mjs <owner|heir> vaults       vault coins this party can see, and how old they are
 *   node vault.mjs owner heartbeat           owner moves the vault back into itself (restarts the clock)
 *   node vault.mjs owner reclaim             owner takes the money out to their own wallet, with no wait
 *   node vault.mjs heir claim                heir takes the vault, once it is <blocks> old
 *
 *   DRY=1 node vault.mjs heir claim         build and print a spend without broadcasting it
 *
 * Both seed phrases are throwaway chipnet test seeds, made on first run and kept in .data/ (git-ignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine, XO_SUPPORTED_NETWORKS } from "@xo-cash/engine";
import { StorageType } from "@xo-cash/state";
import { p2pkhTemplate } from "@xo-cash/templates";
import { deserializeInvitation, serializeInvitation } from "@xo-cash/utils";
import { generateBip39Mnemonic, hexToBin, lockingBytecodeToCashAddress } from "@bitauth/libauth";

const DATA = fileURLToPath(new URL("./.data/", import.meta.url));
const INVITATIONS = `${DATA}invitations/`;
const TEMPLATE = readFileSync(new URL("./heartbeat-vault.template.json", import.meta.url), "utf8");
mkdirSync(INVITATIONS, { recursive: true });

function seeds() {
  const file = `${DATA}seeds.json`;
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({ owner: generateBip39Mnemonic(), heir: generateBip39Mnemonic() }, null, 2));
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Engine calls return a stored invitation, which wraps the invitation itself. */
const idOf = (stored) => (stored.invitation ?? stored).invitationIdentifier;
const log = (label, value) => console.dir({ [label]: value }, { depth: 8 });

/** Opens one account: its engine, the plain wallet template for funding and change, and the vault template. */
async function open(who) {
  const engine = await Engine.create(seeds()[who], {
    network: XO_SUPPORTED_NETWORKS.chipnet,
    // The SQLite store in @xo-cash/state 0.0.5 is unfinished; under Node, IndexedDB runs on SQLite anyway.
    storageType: StorageType.INDEXEDDB,
    databasePath: DATA,
    databaseFilename: who,
  });
  const { templateIdentifier: wallet } = await engine.importTemplate(p2pkhTemplate);
  const { templateIdentifier: vault } = await engine.importTemplate(TEMPLATE);
  await engine.setDefaultPolicies({
    receive: { templateIdentifier: wallet },
    change: { templateIdentifier: wallet },
    address: { templateIdentifier: wallet },
  });
  return { who, engine, wallet, vault };
}

const toAddress = (hex) => {
  const result = lockingBytecodeToCashAddress({ bytecode: hexToBin(hex), prefix: "bchtest" });
  return typeof result === "string" ? result : result.address;
};

const readInvitation = (name) => deserializeInvitation(readFileSync(`${INVITATIONS}${name}.json`, "utf8"));
function writeInvitation(name, invitation) {
  const path = `${INVITATIONS}${name}.json`;
  writeFileSync(path, serializeInvitation(invitation.invitation ?? invitation));
  console.log(`saved ${path}`);
}

async function receiveAddress({ engine }) {
  return toAddress(await engine.generateLockingBytecodeFromDefaultPolicy("receive"));
}

async function walletCoins({ engine, wallet }) {
  return engine.listSpendableUnspentOutputs({ templateIdentifier: wallet });
}

async function showMissing(engine, invitation, label) {
  log(`missing (${label})`, await engine.listMissingRequirements(idOf(invitation)));
}

// ---------- commands ----------

async function address(account) {
  const coins = await walletCoins(account);
  const satoshis = coins.reduce((sum, coin) => sum + BigInt(coin.valueSatoshis), 0n);
  log(account.who, { address: await receiveAddress(account), coins: coins.length, satoshis: satoshis.toString() });
  log("chain", await account.engine.getChainStatus());
}

async function start({ engine, vault }, blocks, sats) {
  if (!blocks || !sats) throw new Error("Usage: owner start <blocks> <sats>");
  const intent = (await engine.getTemplate(vault)).start[0];
  let invitation = await engine.createInvitation({ templateIdentifier: vault, actionIdentifier: "createVault", intent });
  invitation = await engine.appendInvitation(idOf(invitation), {
    variables: [
      { variableIdentifier: "timeoutBlocks", roleIdentifier: "owner", value: Number(blocks) },
      { variableIdentifier: "vaultSatoshis", roleIdentifier: "owner", value: BigInt(sats) },
    ],
  });
  await showMissing(engine, invitation, "after owner start");
  writeInvitation("create", invitation);
}

async function join({ engine }) {
  let invitation = await engine.acceptInvitation(readInvitation("create"), { roleIdentifier: "heir" });
  const id = idOf(invitation);
  log("vault output needs (heir view)", await engine.listOutputResolutions(id, "vaultOutput", "heir"));
  invitation = await engine.appendOwnOutputResolutions(id, "vaultOutput", "heir");
  await showMissing(engine, invitation, "after heir join");
  writeInvitation("create", invitation);
}

async function fund(account) {
  const { engine } = account;
  let invitation = await engine.updateInvitation(readInvitation("create"));
  const id = idOf(invitation);
  log("vault output needs (owner view)", await engine.listOutputResolutions(id, "vaultOutput", "owner"));
  // Share the owner key for the vault output too, so the heir can rebuild the same vault address.
  invitation = await engine.appendOwnOutputResolutions(id, "vaultOutput", "owner");
  invitation = await engine.appendInvitation(id, { outputs: [{ outputIdentifier: "vaultOutput", roleIdentifier: "owner" }] });

  const coins = await walletCoins(account);
  if (coins.length === 0) throw new Error(`The owner wallet has no coins. Send chipnet BCH to ${await receiveAddress(account)}`);
  invitation = await engine.appendInvitation(id, {
    inputs: coins.map((coin) => ({
      outpointTransactionHash: hexToBin(coin.outpointTransactionHash),
      outpointIndex: coin.outpointIndex,
    })),
  });
  log("fee estimate", await engine.estimateTransactionFee(id));
  invitation = await engine.addChangeToInvitation(id);
  for (const index of await engine.listOwnInputIndexes(id)) {
    invitation = await engine.signInvitation(id, index);
  }
  await showMissing(engine, invitation, "before broadcast");
  const result = await engine.executeAction(id, { broadcastTransaction: true });
  log("broadcast", result.builtTransaction);
  writeInvitation("create", result.storedInvitation);
}

/**
 * Re-save this account's stored copy of the create invitation. The engine can broadcast and
 * then throw while updating its own records, before `fund` saves the file. The stored copy
 * still has the result, so this writes it out for the other party to sync.
 */
async function exportCreate({ engine }) {
  const stored = await engine.getInvitation(idOf(readInvitation("create")));
  if (!stored) throw new Error("This account has no stored copy of the create invitation.");
  writeInvitation("create", stored);
}

async function sync(account) {
  const invitation = await account.engine.updateInvitation(readInvitation("create"));
  log(`${account.who} stored`, idOf(invitation));
  await vaults(account);
}

async function vaultCoins({ engine, vault }) {
  return engine.listUnspentOutputs({ templateIdentifier: vault });
}

async function vaults(account) {
  const { engine } = account;
  const chain = await engine.getChainStatus();
  const coins = await vaultCoins(account);
  log(
    `${account.who ?? "heir"} vault coins`,
    coins.map((coin) => ({ ...coin, ageBlocks: coin.minedAtHeight ? chain.currentHeight - coin.minedAtHeight + 1 : 0 })),
  );
}

/** The waiting period the owner chose, read from the createVault invitation both parties hold. */
function vaultTimeoutBlocks() {
  for (const commit of readInvitation("create").commits) {
    const found = commit.data?.variables?.find((v) => v.variableIdentifier === "timeoutBlocks");
    if (found) return Number(found.value);
  }
  throw new Error("The vault invitation does not state its waiting period.");
}

async function spend(account, action, outputIdentifier, roleIdentifier, recipient) {
  const { engine, vault } = account;
  const [coin] = await vaultCoins(account);
  if (!coin) throw new Error("No vault coin found for this account.");
  if (coin.reservedBy) {
    // A spend that failed part-way still holds the coin. Archiving it clears the reservation.
    console.log(`releasing the vault coin from unfinished invitation ${coin.reservedBy}`);
    await engine.archiveInvitation(coin.reservedBy);
  }
  let invitation = await engine.createInvitation({ templateIdentifier: vault, actionIdentifier: action, roleIdentifier });
  const id = idOf(invitation);
  try {
    await finishSpend(engine, id, coin, action, outputIdentifier, roleIdentifier, recipient);
  } catch (error) {
    await engine.archiveInvitation(id);
    throw error;
  }
}

async function finishSpend(engine, id, coin, action, outputIdentifier, roleIdentifier, recipient) {
  let invitation;
  const variables = [
    { variableIdentifier: "vaultSatoshis", roleIdentifier, value: BigInt(coin.valueSatoshis) },
    // The waiting period is part of the vault's script, and the heir's input also uses it as its
    // sequence number (the time lock), so each spend restates it from the invitation that made the vault.
    { variableIdentifier: "timeoutBlocks", roleIdentifier, value: vaultTimeoutBlocks() },
  ];
  if (recipient) variables.push({ variableIdentifier: "recipientLockingScript", roleIdentifier, value: recipient });
  invitation = await engine.appendInvitation(id, {
    variables,
    inputs: [
      {
        outpointTransactionHash: hexToBin(coin.outpointTransactionHash),
        outpointIndex: coin.outpointIndex,
        inputIdentifier: action === "claim" ? "heirInput" : "ownerInput",
        roleIdentifier,
      },
    ],
    outputs: [{ outputIdentifier, roleIdentifier }],
  });
  for (const index of await engine.listOwnInputIndexes(id)) {
    invitation = await engine.signInvitation(id, index);
  }
  await showMissing(engine, invitation, `before ${action}`);
  if (process.env.DRY) {
    const built = await engine.buildInvitationTransactionFromMergedCommit(id);
    log("built (not broadcast)", built);
    throw new Error("DRY run: not broadcast");
  }
  const result = await engine.executeAction(id, { broadcastTransaction: true });
  log("broadcast", result.builtTransaction);
  writeInvitation(action, result.storedInvitation);
}

async function main() {
  const [who, command = "address", ...args] = process.argv.slice(2);
  if (who !== "owner" && who !== "heir") throw new Error("First argument must be owner or heir.");
  const account = await open(who);
  try {
    const run = {
      address: () => address(account),
      start: () => start(account, ...args),
      join: () => join(account),
      fund: () => fund(account),
      sync: () => sync(account),
      export: () => exportCreate(account),
      vaults: () => vaults(account),
      heartbeat: () => spend(account, "heartbeat", "renewedVaultOutput", "owner"),
      // The owner takes the money out, with no wait, to a fresh address in the owner's own wallet.
      reclaim: async () =>
        spend(account, "reclaim", "payoutOutput", "owner", await account.engine.generateLockingBytecodeFromDefaultPolicy("receive")),
      claim: async () =>
        spend(account, "claim", "payoutOutput", "heir", await account.engine.generateLockingBytecodeFromDefaultPolicy("receive")),
    }[command];
    if (!run) throw new Error(`Unknown command: ${command}`);
    await run();
  } finally {
    await account.engine.stop();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);

