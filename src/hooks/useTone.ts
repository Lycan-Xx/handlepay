import { useEffect } from "react";

export type Tone = "ok" | "amber" | "neutral" | "checking" | "blue";

/** Sets the colour of the soft glow behind the page to match the badge on screen. */
export function useTone(tone: Tone | null) {
  useEffect(() => {
    const root = document.documentElement;
    if (tone) root.setAttribute("data-tone", tone);
    return () => root.removeAttribute("data-tone");
  }, [tone]);
}
