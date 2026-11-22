/**
 * Links and names shown on every page. The hackathon requires the banner to
 * carry the slides, the source code and the Community Choice vote address;
 * an empty value is left out of the banner until it's filled in.
 */
import type { BchNetwork } from "./lib/network";

export const SITE = {
  /** The live app. Used where an outside party must fetch something from us whatever page we run on. */
  url: "https://handlepay.lycanforge.com.ng",
  source: "https://github.com/Lycan-Xx/handlepay",
  /** Pitch slides; empty until they're published. */
  slides: "",
  /** Token-aware BCH address for Community Choice votes (EMBER2026); empty until set. */
  voteAddress: "bitcoincash:zrum8dtm0z7ehsfh0lg87ze32ny0rdxnxs8al3zt76",
  voteCode: "EMBER2026",
};

/** The seeded demo name judges pay, and the network its binding is on. */
export const DEMO_PAYEE: { handle: string; name: string; network: BchNetwork; amountUsd: string } = {
  handle: "sani@lycanforge.com.ng",
  name: "Sani",
  network: "mainnet",
  amountUsd: "0.25",
};
