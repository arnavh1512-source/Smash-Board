"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { whatsappShareLink } from "@/lib/site";
import { Input } from "@/components/ui";

type CopyState = "idle" | "copied" | "failed";

const noopSubscribe = (): (() => void) => () => {};

/** Older browsers and non-secure contexts have no async clipboard. */
function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/** Copy the public link, or send it straight to a WhatsApp group. */
export function ShareBar({
  name,
  path,
  compact,
}: {
  name: string;
  path: string;
  /** The organiser console packs these into a tighter header. */
  compact?: boolean;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // Read the origin only once hydrated, so the server and client render the same markup.
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
  const url = `${origin}${path}`;
  const size = compact ? "text-[12px]" : "text-[13px]";

  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState(legacyCopy(url) ? "copied" : "failed");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={copy} className={`btn btn-secondary flex-1 justify-start ${size}`}>
          {copyState === "copied" ? "Link copied" : "Copy link"}
        </button>
        <a
          href={whatsappShareLink(`Live scores for ${name}: ${url}`)}
          target="_blank"
          rel="noopener noreferrer"
          className={`btn ${compact ? "btn-secondary" : "btn-primary"} flex-1 justify-start ${size}`}
        >
          Share on WhatsApp
        </a>
      </div>
      <p aria-live="polite" className="m-0 text-[12px] text-muted empty:hidden">
        {copyState === "failed" ? (
          <>
            Copying is blocked here. Select the link to copy it:{" "}
            <Input
              readOnly
              value={url}
              aria-label="Tournament link"
              onFocus={(event) => event.currentTarget.select()}
              className="mt-1 w-full font-mono text-[12px]"
            />
          </>
        ) : copyState === "copied" ? (
          <span className="sr-only">Link copied to the clipboard.</span>
        ) : null}
      </p>
    </div>
  );
}
