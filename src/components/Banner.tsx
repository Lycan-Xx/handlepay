/** The strip at the top of every page: slides, source code and the vote address. */
import { useState } from "react";
import { SITE } from "../config";

export function Banner() {
  const [copied, setCopied] = useState(false);

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
        </span>
      )}
    </aside>
  );
}
