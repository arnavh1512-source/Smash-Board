import { ImageResponse } from "next/og";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { SITE } from "@/lib/site";

export const alt = "Live badminton scores";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card a shared tournament link shows in WhatsApp.
 *
 * The tournament's own name is the whole point: a club shares four links in a
 * group chat and they must not all look the same. If the backend cannot be
 * reached the card still renders, with the site name instead of a blank image.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;

  let name: string = SITE.name;
  let venue: string | undefined;
  if (url) {
    try {
      const tournament = await new ConvexHttpClient(url).query(api.tournaments.getBySlug, { slug });
      if (tournament) {
        name = tournament.name;
        venue = tournament.venue;
      }
    } catch {
      // A preview image is not worth failing the request over.
    }
  }

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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 72, lineHeight: 1.1, fontWeight: 800 }}>{name}</div>
          {venue ? <div style={{ display: "flex", fontSize: 32, opacity: 0.7 }}>{venue}</div> : null}
        </div>
        <div style={{ display: "flex", fontSize: 28, opacity: 0.7 }}>
          Draws, live scores and standings
        </div>
      </div>
    ),
    size,
  );
}
