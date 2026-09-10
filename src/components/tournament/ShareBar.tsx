"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { whatsappLink } from "@/lib/site";

/** Copy the public link, or send it straight to a WhatsApp group. */
export function ShareBar({ name, path }: { name: string; path: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;

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
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={copy}>
        {copied ? "Link copied" : "Copy link"}
      </Button>
      <a
        href={whatsappLink(`Live scores for ${name}: ${url}`)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded-lg bg-[#25D366] px-3.5 py-2 text-sm font-medium text-white transition hover:bg-[#1ebe5b]"
      >
        Share on WhatsApp
      </a>
    </div>
  );
}
