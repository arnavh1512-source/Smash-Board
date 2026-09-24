"use client";

import { whatsappLink } from "@/lib/site";

/**
 * The last resort: the root layout itself failed.
 *
 * This replaces the whole document, so it has to carry its own html and body
 * and cannot lean on anything from the layout — including the stylesheet.
 * Everything here is inline for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "64px 16px",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#fbfaf7",
          color: "#16150f",
        }}
      >
        <div style={{ margin: "0 auto", maxWidth: "36rem" }}>
          <h1 style={{ margin: "0 0 12px", fontSize: 24 }}>SmashBoard could not load</h1>
          <p style={{ margin: "0 0 24px", fontSize: 14, opacity: 0.75 }}>
            Something failed before the page could be drawn. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: "0 20px",
              fontSize: 14,
              cursor: "pointer",
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
            }}
          >
            Reload
          </button>
          <p style={{ margin: "24px 0 0", fontSize: 13 }}>
            <a href={whatsappLink("Hi, SmashBoard will not load for me.")}>WhatsApp us</a>
            {error.digest ? (
              <span style={{ opacity: 0.45 }}> · Reference {error.digest}</span>
            ) : null}
          </p>
        </div>
      </body>
    </html>
  );
}
