import { useEffect, useState } from "react";

const THEME_KEY = "handlepay-theme";
export type Theme = "light" | "dark" | null;

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/** Light, dark, or (when null) whatever the device prefers. The choice is remembered in this browser. */
export function useTheme(): { dark: boolean; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === "light" || v === "dark" ? v : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.setAttribute("data-theme", theme);
    else root.removeAttribute("data-theme");
  }, [theme]);

  const dark = theme ? theme === "dark" : systemDark();
  const toggle = () => {
    const next: Theme = dark ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* keep in memory only */
    }
  };
  return { dark, toggle };
}
