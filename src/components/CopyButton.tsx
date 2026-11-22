import { useState } from "react";
import { Icon } from "./Icon";

/** A small Copy button. If the clipboard is blocked the text is still on screen to copy by hand. */
export function CopyButton({ text, label = "Copy", className = "ghost" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <button type="button" className={`${className} with-icon`} onClick={copy} aria-live="polite">
      <Icon name={copied ? "check" : "content_copy"} />
      {copied ? "Copied" : label}
    </button>
  );
}
