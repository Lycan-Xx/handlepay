// Independent check of what the relays hold for a Nostr key, outside the app.
// Usage: node scripts/check-binding.mjs <64-char hex pubkey>
import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";

const pubkey = (process.argv[2] ?? "").toLowerCase();
if (!/^[0-9a-f]{64}$/.test(pubkey)) {
  console.error("Usage: node scripts/check-binding.mjs <64-char hex pubkey>");
  process.exit(1);
}

const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const pool = new SimplePool();

for (const relay of relays) {
  const events = await pool.querySync([relay], { authors: [pubkey], kinds: [30145, 10133] }, { maxWait: 5000 });
  console.log(`\n${relay}: ${events.length} event(s)`);
  for (const e of events.sort((a, b) => b.created_at - a.created_at)) {
    const { id, pubkey: pk, created_at, kind, tags, content, sig } = e;
    const valid = verifyEvent({ id, pubkey: pk, created_at, kind, tags, content, sig });
    console.log(`  kind ${kind} · ${new Date(created_at * 1000).toISOString()} · signature ${valid ? "valid" : "INVALID"}`);
    for (const t of tags) console.log(`    tag ${JSON.stringify(t)}`);
    if (content) console.log(`    content ${content}`);
  }
}

pool.destroy();
process.exit(0);
