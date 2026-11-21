/** The strip at the top of every page: slides, source code and the vote address. */
import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { SITE } from "../config";

/** An SVG QR code for the vote address, so a voter on a phone wallet can scan instead of copying. */
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export function Banner() {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  // Built from our own config constant, never from user input, so it is safe to inject as markup.
  const svg = useMemo(() => (SITE.voteAddress ? qrSvg(SITE.voteAddress) : ""), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SITE.voteAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the address is on screen to copy by hand */
    }
  };

  return (
    <aside className="banner" aria-label="Project links">
      {SITE.slides && (
        <a href={SITE.slides} target="_blank" rel="noreferrer">
          Slides
        </a>
      )}
      <a href={SITE.source} target="_blank" rel="noreferrer">
        Source code
      </a>
      {SITE.voteAddress && (
        <span className="vote">
          Vote with {SITE.voteCode}: <code>{SITE.voteAddress}</code>
          <button className="link" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="link" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
            {showQr ? "Hide QR" : "QR"}
          </button>
        </span>
      )}
      {SITE.voteAddress && showQr && (
        <figure className="vote-qr">
          <div role="img" aria-label={`QR code for ${SITE.voteAddress}`} dangerouslySetInnerHTML={{ __html: svg }} />
          <figcaption className="muted small">Scan with a CashTokens wallet, then send {SITE.voteCode}.</figcaption>
        </figure>
      )}
    </aside>
  );
}
