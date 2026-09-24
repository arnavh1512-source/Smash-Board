"use client";

import { useCallback, useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "smashboard:theme";

/** Fired when the toggle flips the class, so the button re-reads it. */
const THEME_CHANGE_EVENT = "smashboard:theme-change";

function isDark(): boolean {
  return document.documentElement.classList.contains("sb-dark");
}

function subscribeToTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

/**
 * The design ships two grounds and asks the reader to choose between them, so
 * the theme is an explicit class on <html> rather than a media query. The
 * inline script in the document head applies the stored choice before first
 * paint; this component only keeps the button label in step with it.
 */
export function ThemeToggle() {
  // The class on <html> is the source of truth — the head script sets it before
  // React exists — so the button reads it rather than keeping a second copy.
  const dark = useSyncExternalStore(subscribeToTheme, isDark, () => false);

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("sb-dark");
    document.documentElement.classList.toggle("sb-dark", next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Private browsing blocks storage; the choice simply lasts one visit.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      className="btn btn-secondary px-2.5 text-[12px]"
    >
      {dark ? "Light" : "Dark"}
    </button>
  );
}

/**
 * Runs before the first paint so a dark reader never sees a flash of the light
 * ground. Kept as a string because it has to be inlined into the document.
 */
export const THEME_INIT_SCRIPT = `
try {
  var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (stored === "dark") document.documentElement.classList.add("sb-dark");
} catch (e) {}
`;
