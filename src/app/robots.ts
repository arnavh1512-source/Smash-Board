import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * The console and the score sheet are behind a PIN and have nothing to offer a
 * crawler, so they are kept out of the index; the public boards are the point
 * of the site and stay in.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/t/*/manage", "/t/*/score"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
