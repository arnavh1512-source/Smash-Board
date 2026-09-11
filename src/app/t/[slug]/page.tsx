import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { TournamentView } from "@/components/tournament/TournamentView";
import { SITE } from "@/lib/site";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type Tournament = Awaited<ReturnType<typeof queryTournament>>;

function queryTournament(slug: string) {
  return new ConvexHttpClient(convexUrl!).query(api.tournaments.getBySlug, { slug });
}

/**
 * Fetched on the server so search engines and link previews see real content.
 *
 * "missing" and "unavailable" are deliberately different answers: a slug the
 * backend does not know is a dead link and must answer 404, while a backend
 * hiccup must not turn a real tournament into one — the page renders and the
 * client subscription retries.
 */
async function loadTournament(
  slug: string,
): Promise<{ state: "found"; tournament: NonNullable<Tournament> } | { state: "missing" } | { state: "unavailable" }> {
  if (!convexUrl) return { state: "unavailable" };
  try {
    const tournament = await queryTournament(slug);
    return tournament ? { state: "found", tournament } : { state: "missing" };
  } catch {
    return { state: "unavailable" };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadTournament(slug);
  if (result.state !== "found") {
    return { title: "Tournament", description: SITE.description };
  }
  const { tournament } = result;

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
  // A link that points at nothing has to say 404, or a dead tournament URL is
  // indexed and shared as if it were a live one.
  if ((await loadTournament(slug)).state === "missing") notFound();
  return <TournamentView slug={slug} />;
}
