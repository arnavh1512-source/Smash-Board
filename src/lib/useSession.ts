"use client";

import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;

/** Components watching one storage key, so a sign-in re-renders all of them. */
const listeners = new Map<string, Set<Listener>>();

function subscribe(key: string, listener: Listener): () => void {
  const forKey = listeners.get(key) ?? new Set<Listener>();
  forKey.add(listener);
  listeners.set(key, forKey);
  return () => {
    forKey.delete(listener);
    if (forKey.size === 0) listeners.delete(key);
  };
}

function readToken(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Private browsing can block storage; the organiser just signs in again.
    return null;
  }
}

function writeToken(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore: the token still works for this page view.
  }
  listeners.get(key)?.forEach((listener) => listener());
}

/** Subscription that never fires — used only to tell the server render apart. */
const noopSubscribe = (): (() => void) => () => {};

/** Which door a screen came in through. The two are stored under separate keys
 * so a referee unlocking on a shared phone can never inherit organiser access. */
export type AccessRole = "organiser" | "referee";

const STORAGE_PREFIX: Record<AccessRole, string> = {
  organiser: "smashboard:tok:",
  referee: "smashboard:reftok:",
};

/** Where a role's session token lives for one tournament, on one device. */
export function sessionKey(slug: string, role: AccessRole = "organiser"): string {
  return `${STORAGE_PREFIX[role]}${slug}`;
}

/**
 * The PIN itself is never stored. Signing in trades it for a short-lived signed
 * token, and that token is what sits in sessionStorage: a page refresh does not
 * force a re-entry, but closing the tab clears it. Nothing is written to a
 * cookie or to localStorage.
 *
 * `ready` is false during the server render and the first hydration pass, so a
 * caller can hold the sign-in screen back instead of flashing it at someone who
 * is already unlocked.
 */
export function useSession(slug: string, role: AccessRole = "organiser") {
  const key = sessionKey(slug, role);

  const token = useSyncExternalStore(
    useCallback((listener: Listener) => subscribe(key, listener), [key]),
    useCallback(() => readToken(key), [key]),
    () => null,
  );

  const ready = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const setToken = useCallback((value: string | null) => writeToken(key, value), [key]);

  return { token, setToken, ready };
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
