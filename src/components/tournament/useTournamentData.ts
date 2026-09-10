"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

/**
 * The three subscriptions every tournament screen needs. Convex pushes updates
 * to all of them, so a score entered on the organiser console reaches every
 * open scoreboard without polling.
 */
export function useTournamentData(slug: string) {
  const tournament = useQuery(api.tournaments.getBySlug, { slug });
  const tournamentId = tournament?._id;

  const events = useQuery(
    api.events.listByTournament,
    tournamentId ? { tournamentId } : "skip",
  );
  const entries = useQuery(
    api.entries.listByTournament,
    tournamentId ? { tournamentId } : "skip",
  );
  const matches = useQuery(
    api.matches.listByTournament,
    tournamentId ? { tournamentId } : "skip",
  );

  const entryMap = useMemo(() => {
    const map = new Map<Id<"entries">, Doc<"entries">>();
    for (const entry of entries ?? []) map.set(entry._id, entry);
    return map;
  }, [entries]);

  const loading =
    tournament === undefined ||
    (tournamentId !== undefined &&
      (events === undefined || entries === undefined || matches === undefined));

  return {
    tournament,
    events: events ?? [],
    entries: entries ?? [],
    matches: matches ?? [],
    entryMap,
    loading,
  };
}
