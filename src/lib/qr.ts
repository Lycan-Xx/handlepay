import qrcode from "qrcode-generator";

/** An SVG QR code for `text`. Only ever fed a wallet address, so it is safe to inject as markup. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/** Dollars worth suggesting for the test on mainnet: plenty for the proof and its fee. */
export const SUGGESTED_USD = 0.25;
