import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card WhatsApp, X and search previews show for the home page.
 *
 * Drawn rather than shipped as a file so the wording never drifts from
 * `src/lib/site.ts`. Deliberately plain: this is read at thumbnail size in a
 * chat list, so it is a name, a line, and nothing else.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fbfaf7",
          color: "#16150f",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 4, textTransform: "uppercase" }}>
          {SITE.name}
        </div>
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1, fontWeight: 800 }}>
          {SITE.tagline}
        </div>
        <div style={{ display: "flex", fontSize: 28, opacity: 0.7 }}>
          Draws, live scores and standings — free, no sign-up for players
        </div>
      </div>
    ),
    size,
  );
}
