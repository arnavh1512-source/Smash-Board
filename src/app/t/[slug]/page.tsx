import type { Metadata } from "next";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { TournamentView } from "@/components/tournament/TournamentView";
import { SITE } from "@/lib/site";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

/** Fetched on the server so search engines and link previews see real content. */
async function loadTournament(slug: string) {
  if (!convexUrl) return null;
  try {
    return await new ConvexHttpClient(convexUrl).query(api.tournaments.getBySlug, { slug });
  } catch {
    // A backend hiccup must not break the page; the client subscription retries.
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tournament = await loadTournament(slug);
  if (!tournament) {
    return { title: "Tournament", description: SITE.description };
  }

  const where = tournament.venue ? ` at ${tournament.venue}` : "";
  const description = `Live draws, scores and standings for ${tournament.name}${where}. Updated as each game finishes.`;

  return {
    title: tournament.name,
    description,
    alternates: { canonical: `${SITE.url}/t/${tournament.slug}` },
    openGraph: {
      title: tournament.name,
      description,
      url: `${SITE.url}/t/${tournament.slug}`,
      type: "website",
    },
    robots: { index: tournament.isPublic, follow: tournament.isPublic },
  };
}

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <TournamentView slug={slug} />;
}
