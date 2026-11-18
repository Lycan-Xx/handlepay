import {
  binToHex,
  cashAddressToLockingBytecode,
  encodeTransaction,
  hashTransaction,
  hexToBin,
  publicKeyToP2pkhCashAddress,
  secp256k1,
  sha256,
  utf8ToBin,
} from "@bitauth/libauth";
import { getPublicKey as nostrPublicKey } from "nostr-tools/pure";
import type { WalletAddress, WalletCoin } from "../src/lib/wallet";
import type { BchNetwork } from "../src/lib/network";
import { PREFIX } from "../src/lib/network";

/** Deterministic test key from a label. Never use for real funds. */
export function testKey(label: string) {
  const privateKey = sha256.hash(utf8ToBin(`handlepay-test:${label}`));
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === "string") throw new Error(publicKey);
  return { privateKey, publicKey };
}

export function testAddress(label: string, network: BchNetwork = "chipnet"): string {
  return publicKeyToP2pkhCashAddress({ publicKey: testKey(label).publicKey, prefix: PREFIX[network] }).address;
}

export function lockingHex(address: string): string {
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === "string") throw new Error(decoded);
  return binToHex(decoded.bytecode);
}

let counter = 0;
/** A fake wallet coin at `address` with a unique outpoint. */
export function testCoin(owner: WalletAddress, satoshis: bigint): WalletCoin {
  counter++;
  return {
    txid: binToHex(sha256.hash(utf8ToBin(`coin:${counter}`))),
    vout: 0,
    satoshis,
    lockingBytecode: lockingHex(owner.address),
    owner,
  };
}

export function owner(label: string, path: "receive" | "change" = "receive", index = 0, network: BchNetwork = "chipnet"): WalletAddress {
  return { path, index, address: testAddress(label, network) };
}

// --- transactions -----------------------------------------------------------


/**
 * A fake parent transaction with one output to each address given. Returns its
 * hex, txid, and wallet coins spending those outputs.
 */
export function fundingTx(outputs: { owner: WalletAddress; satoshis: bigint }[], salt = "") {
  const tx = {
    version: 2,
    locktime: 0,
    inputs: [
      {
        outpointTransactionHash: sha256.hash(utf8ToBin(`parent:${salt}:${counter++}`)),
        outpointIndex: 0,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array(),
      },
    ],
    outputs: outputs.map((o) => ({ lockingBytecode: hexToBin(lockingHex(o.owner.address)), valueSatoshis: o.satoshis })),
  };
  const bin = encodeTransaction(tx);
  const hex = binToHex(bin);
  const txid = hashTransaction(bin);
  const coins: WalletCoin[] = outputs.map((o, vout) => ({
    txid,
    vout,
    satoshis: o.satoshis,
    lockingBytecode: lockingHex(o.owner.address),
    owner: o.owner,
  }));
  return { hex, txid, coins };
}

/** Deterministic Nostr secret key + x-only pubkey from a label. */
export function nostrKey(label: string) {
  const secretKey = sha256.hash(utf8ToBin(`handlepay-nostr:${label}`));
  return { secretKey, pubkey: nostrPublicKey(secretKey) };
}
