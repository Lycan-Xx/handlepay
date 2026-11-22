/**
 * The thin strip above the header on every page: slides (when set), source
 * code, and the EMBER2026 vote address with Copy and QR. The hackathon's rules
 * require it, so it stays on every route.
 */
import { useMemo, useState } from "react";
import { SITE } from "../config";
import { qrSvg } from "../lib/qr";
import { Icon } from "./Icon";

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
      <div className="banner-in">
        {SITE.slides && (
          <a href={SITE.slides} target="_blank" rel="noreferrer">
            <Icon name="slideshow" /> Slides
          </a>
        )}
        <a href={SITE.source} target="_blank" rel="noreferrer">
          <Icon name="code" /> Source code
        </a>
        {SITE.voteAddress && (
          <span className="vote">
            <Icon name="how_to_vote" />
            <span>
              Vote with <strong className="vote-code">{SITE.voteCode}</strong>:
            </span>
            <code title={SITE.voteAddress}>
              {/* The whole address where there's room; a phone gets the short form (Copy and QR carry the full one). */}
              <span className="desktop-only">{SITE.voteAddress}</span>
              <span className="desktop-hide">
                {SITE.voteAddress.replace(/^bitcoincash:/, "").slice(0, 8)}…{SITE.voteAddress.slice(-6)}
              </span>
            </code>
            <button className="link" onClick={copy}>
              <Icon name={copied ? "check" : "content_copy"} /> {copied ? "Copied" : "Copy"}
            </button>
            <button className="link" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
              <Icon name="qr_code" /> {showQr ? "Hide QR" : "QR"}
            </button>
          </span>
        )}
        {SITE.voteAddress && showQr && (
          <figure className="vote-qr">
            <div className="qr" role="img" aria-label={`QR code for ${SITE.voteAddress}`} dangerouslySetInnerHTML={{ __html: svg }} />
            <figcaption className="small">Scan with a CashTokens wallet, then send {SITE.voteCode}.</figcaption>
          </figure>
        )}
      </div>
    </aside>
  );
}
