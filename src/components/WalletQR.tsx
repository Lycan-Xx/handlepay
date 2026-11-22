import { WizardConnectQRDialog, type WizardConnectQRTheme } from "@wizardconnect/react";
import type { Wallet } from "../hooks/useWallet";

/**
 * The pairing dialog in HandlePay's palette. WizardConnect's default is a dark
 * navy theme; it takes colours inline, so these mirror the tokens on :root in
 * App.css (CSS variables can't be passed through). The code itself stays
 * near-black on white with its quiet zone, which every scanner reads best.
 */
const THEME: WizardConnectQRTheme = {
  backdropColor: "rgba(23, 19, 19, 0.44)", // --scrim
  dialogBackground: "#ffffff", // --surface
  headerBackground: "#fff9f6", // --paper
  titleColor: "#171313", // --ink
  subtitleColor: "#6b625e", // --muted
  qrForeground: "#171313", // --ink
  qrBackground: "#ffffff",
  uriRowBackground: "#f8f3f0", // --surface2
  uriTextColor: "#6b625e", // --muted
  borderColor: "#f0e0d9", // --line
  closeButtonColor: "#6b625e", // --muted
  copyButtonColor: "#c9360a", // --accent-strong
};

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
      subtitle="Scan with Paytaca, Cashonize or Selene"
      theme={THEME}
    />
  );
}
