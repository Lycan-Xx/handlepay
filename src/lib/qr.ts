import qrcode from "qrcode-generator";

/** An SVG QR code for `text`. Only ever fed a wallet address, so it is safe to inject as markup. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/** Quiet zone, in modules, around the pairing code: the 4 the QR standard asks for. */
export const PAIRING_QR_MARGIN = 4;

/**
 * The WizardConnect pairing code as SVG. `qrUri` is the uppercase WIZ://… form,
 * encoded in Alphanumeric mode (smaller and easier to scan than bytes), at error
 * correction H (30% recoverable), which leaves room for the logo drawn over
 * its centre. The same choices WizardConnect's own dialog makes.
 */
export function pairingQrSvg(qrUri: string): string {
  const qr = qrcode(0, "H");
  qr.addData(qrUri, "Alphanumeric");
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: PAIRING_QR_MARGIN, scalable: true });
}

/** Dollars worth suggesting for the test on mainnet: plenty for the proof and its fee. */
export const SUGGESTED_USD = 0.25;
