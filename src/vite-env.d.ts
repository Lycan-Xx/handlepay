/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ELECTRUM_CHIPNET?: string;
  readonly VITE_ELECTRUM_MAINNET?: string;
  /** Base URL of the NIP-05 CORS proxy Worker, e.g. https://handlepay-nip05.<acct>.workers.dev */
  readonly VITE_NIP05_PROXY?: string;
}
