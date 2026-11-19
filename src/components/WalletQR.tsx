import { WizardConnectQRDialog } from "@wizardconnect/react";
import type { Wallet } from "../hooks/useWallet";

/** The pairing QR dialog, shown while a connection is being set up. */
export function WalletQR({ wallet }: { wallet: Wallet }) {
  const { wc, showQR, setShowQR, connected } = wallet;
  if (!wc.uri || !wc.qrUri) return null;
  return (
    <WizardConnectQRDialog
      show={showQR && !connected}
      onClose={() => setShowQR(false)}
      uri={wc.uri}
      qrUri={wc.qrUri}
      title="Connect your BCH wallet"
    />
  );
}
