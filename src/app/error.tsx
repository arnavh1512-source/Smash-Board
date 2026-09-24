"use client";

import Link from "next/link";
import { useEffect } from "react";
import { whatsappLink } from "@/lib/site";

/**
 * What a player or organiser sees when a page throws.
 *
 * The realistic moment for this is mid-tournament, on a phone, on hall wifi:
 * a query that could not reach the deployment. So the first thing offered is
 * the retry — `reset` re-renders the segment without a full page load, which
 * is usually all a dropped connection needs. The WhatsApp link is there
 * because the alternative for an organiser standing at the desk is nothing.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which the
    // browser is never shown. Logging it gives a bug report something to name.
    console.error("Page error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h3>Something went wrong</h3>
      <p className="text-[13px] text-muted">
        The page could not be loaded. On a patchy connection, trying again in a moment usually
        works.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4 text-[13px]">
        <button
          type="button"
          onClick={reset}
          className="min-h-[44px] cursor-pointer border-0 bg-transparent p-0 text-[13px] text-[var(--color-accent-ink)] underline"
        >
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-[44px] items-center">
          Back to all tournaments
        </Link>
        <a
          href={whatsappLink("Hi, I hit an error on SmashBoard.")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center"
        >
          WhatsApp us
        </a>
      </div>
      {error.digest ? (
        <p className="mt-6 text-[11px] uppercase tracking-[0.08em] text-muted">
          Reference {error.digest}
        </p>
      ) : null}
    </div>
  );
}
