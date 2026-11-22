/**
 * The wallet pairing dialog: the WizardConnect code with HandlePay's logo in
 * the middle, and the same link to copy for wallets on this device.
 *
 * WizardConnect's own dialog always draws its wizard-hat logo in the code and
 * can't be told otherwise, so HandlePay draws the code itself, the same way:
 * the uppercase WIZ:// URI in Alphanumeric mode at error correction H, with
 * the logo covering well under the 30% the code can lose and still scan. It
 * opens in the app's own Drawer, so it looks and behaves like the network
 * picker (Escape, tap outside, focus moves in).
 *
 * The logo in the code only decorates it. What a wallet shows *after* scanning
 * is the dappIcon sent in useWallet, which wallets load from its URL.
 */
import { useCallback, useMemo } from "react";
import type { Wallet } from "../hooks/useWallet";
import { pairingQrSvg } from "../lib/qr";
import { CopyButton } from "./CopyButton";
import { Drawer } from "./Drawer";

export function WalletQR({ wallet }: { wallet: Wallet }) {
  const { wc, showQR, setShowQR, connected } = wallet;
  const close = useCallback(() => setShowQR(false), [setShowQR]);
  // Made from WizardConnect's own pairing URI (uppercase letters, digits and a few symbols), never from user input.
  const svg = useMemo(() => (wc.qrUri ? pairingQrSvg(wc.qrUri) : ""), [wc.qrUri]);
  if (!wc.uri || !wc.qrUri) return null;

  return (
    <Drawer open={showQR && !connected} title="Connect your BCH wallet" onClose={close}>
      <p className="muted">
        Open Paytaca, Cashonize or Selene and scan this with its <strong>WizardConnect</strong> scanner.
      </p>
      <div className="pair-qr">
        <div className="qr" role="img" aria-label="WizardConnect pairing code" dangerouslySetInnerHTML={{ __html: svg }} />
        <img className="pair-qr-logo" src="/brand/logo-128.png" width="128" height="128" alt="" />
      </div>
      <p className="label">Wallet on this device? Copy the link instead</p>
      <div className="copyrow">
        <code className="addr">{wc.uri}</code>
        <CopyButton text={wc.uri} />
      </div>
      <p className="muted small">Your wallet only signs. It never shares its keys, and nothing moves until you approve.</p>
    </Drawer>
  );
}
