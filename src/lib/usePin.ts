"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The organiser PIN is kept in sessionStorage so a page refresh does not force
 * a re-entry, but closing the tab clears it. It is never written to a cookie or
 * to localStorage, and never leaves the device except as a mutation argument.
 */
export function usePin(slug: string) {
  const key = `smashboard:pin:${slug}`;
  const [pin, setPinState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setPinState(window.sessionStorage.getItem(key));
    } catch {
      // Private browsing can block storage; the organiser just re-enters the PIN.
    }
    setReady(true);
  }, [key]);

  const setPin = useCallback(
    (value: string | null) => {
      setPinState(value);
      try {
        if (value === null) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, value);
      } catch {
        // Ignore: the PIN still works for this page view.
      }
    },
    [key],
  );

  return { pin, setPin, ready };
}

/** Turn any thrown value into a message worth showing an organiser. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data: unknown }).data;
    if (typeof data === "string") return data;
  }
  if (error instanceof Error) {
    // Convex prefixes server errors; keep only the readable part.
    const match = error.message.match(/Uncaught ConvexError:\s*(.*)/);
    if (match) return match[1].split("\n")[0];
    return error.message.split("\n")[0];
  }
  return "Something went wrong. Please try again.";
}
