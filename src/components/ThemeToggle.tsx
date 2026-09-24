"use client";

import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

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

function storedTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Private browsing blocks storage; the choice simply lasts one visit.
    return null;
  }
}

/**
 * The design ships two grounds and asks the reader to choose between them, so
 * the theme is an explicit class on <html> rather than a media query. The
 * inline script in the document head applies the stored choice before first
 * paint; this component keeps the button label in step with it.
 */
export function ThemeToggle() {
  // The class on <html> is the source of truth — the head script sets it before
  // React exists — so the button reads it rather than keeping a second copy.
  const dark = useSyncExternalStore(subscribeToTheme, isDark, () => false);

  // When Next renders the root layout on the client (a not-found page, an error
  // recovery), React resets <html>'s className to the layout's and the head
  // script does not run again. Re-apply the stored choice before that paints.
  useLayoutEffect(() => {
    if (storedTheme() === "dark" && !isDark()) {
      document.documentElement.classList.add("sb-dark");
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    }
  }, []);

  const toggle = useCallback(() => {
    const next = !isDark();
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
const THEME_INIT_SCRIPT = `
try {
  var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (stored === "dark") document.documentElement.classList.add("sb-dark");
} catch (e) {}
`;

/**
 * The head script. In the server HTML it is ordinary JavaScript and runs before
 * paint. When React renders it on the client instead (the root layout rendered
 * client-side), it becomes an inert `text/plain` block: React only warns about
 * script tags it would have to execute, and the layout effect above covers that
 * case. The attribute differs between server and hydration by design.
 */
export function ThemeScript() {
  return (
    <script
      id="theme-init"
      suppressHydrationWarning
      type={typeof window === "undefined" ? undefined : "text/plain"}
      dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
    />
  );
}
