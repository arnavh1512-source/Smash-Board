import type { MetadataRoute } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { SITE } from "@/lib/site";

/** Hidden tournaments are never listed, so this is exactly the public boards. */
const LIMIT = 100;

/** Rebuilt hourly: new tournaments should be findable the same weekend. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const home = {
    url: SITE.url,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: 1,
  };

  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return [home];

  try {
    const tournaments = await new ConvexHttpClient(url).query(api.tournaments.listPublic, {
      limit: LIMIT,
    });
    return [
      home,
      ...tournaments.map((tournament) => ({
        url: `${SITE.url}/t/${tournament.slug}`,
        lastModified: new Date(tournament.updatedAt),
        changeFrequency: "hourly" as const,
        priority: 0.8,
      })),
    ];
  } catch {
    // A build or a crawl must not fail because the backend blinked.
    return [home];
  }
}
