"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/**
 * One query-string value, kept in the address bar so the view it selects is a
 * link someone can be sent, and the phone's back button behaves.
 *
 * `push` adds a history entry, `replace` does not. Either way every reader of
 * the same parameter re-renders, because a popstate is dispatched after the
 * write - history.pushState does not fire one on its own.
 */
export function useSearchParam(
  name: string,
): [string | null, (value: string | null, mode?: "push" | "replace") => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
  const setValue = useCallback(
    (next: string | null, mode: "push" | "replace" = "replace") => {
      const url = new URL(window.location.href);
      if (next === null) url.searchParams.delete(name);
      else url.searchParams.set(name, next);
      if (mode === "push") window.history.pushState(window.history.state, "", url);
      else window.history.replaceState(window.history.state, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [name],
  );
  return [value, setValue];
}
