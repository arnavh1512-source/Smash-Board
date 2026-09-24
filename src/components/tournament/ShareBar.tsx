"use client";

import { useState } from "react";
import { whatsappLink } from "@/lib/site";

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
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  const size = compact ? "text-[12px]" : "text-[13px]";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the WhatsApp button still works.
    }
  }

  return (
    <div className="flex gap-2">
      <button type="button" onClick={copy} className={`btn btn-secondary flex-1 justify-start ${size}`}>
        {copied ? "Link copied" : "Copy link"}
      </button>
      <a
        href={whatsappLink(`Live scores for ${name}: ${url}`)}
        target="_blank"
        rel="noopener noreferrer"
        className={`btn ${compact ? "btn-secondary" : "btn-primary"} flex-1 justify-start ${size}`}
      >
        Share on WhatsApp
      </a>
    </div>
  );
}
