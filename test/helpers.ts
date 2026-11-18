import { binToHex, cashAddressToLockingBytecode, publicKeyToP2pkhCashAddress, secp256k1, sha256, utf8ToBin } from "@bitauth/libauth";
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
