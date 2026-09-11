"use client";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { computeStandings } from "@/lib/standings";
import type { ScoringConfig } from "@/lib/scoring";
import { entryName } from "@/lib/display";
import type { EntryLookup } from "./MatchRow";

/** A group or round-robin table, in the BWF tiebreak order. */
export function StandingsTable({
  matches,
  entries,
  scoring,
}: {
  matches: Doc<"matches">[];
  entries: EntryLookup;
  scoring: ScoringConfig;
}) {
  const ids = [
    ...new Set(
      matches
        .flatMap((m) => [m.aId, m.bId])
        .filter((id): id is Id<"entries"> => id !== null),
    ),
  ];
  if (ids.length === 0) return null;

  const rows = computeStandings(
    ids,
    matches.map((m) => ({
      aId: m.aId,
      bId: m.bId,
      sets: m.sets,
      status: m.status,
      walkoverWinnerId: m.winnerId,
    })),
    scoring,
    (id) => entryName(entries.get(id as Id<"entries">)),
  );

  return (
    <div className="overflow-x-auto px-4">
      <table className="table">
        <thead>
          <tr>
            <th className="pl-0">Pair</th>
            <th className="text-right">P</th>
            <th className="text-right">W</th>
            <th className="text-right">L</th>
            <th className="text-right">Sets</th>
            <th className="pr-0 text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entryId}>
              <td className="pl-0">
                <span className="num mr-2 opacity-50">{row.rank}</span>
                {entryName(entries.get(row.entryId as Id<"entries">))}
              </td>
              <td className="num text-right">{row.played}</td>
              <td className="num text-right font-extrabold">{row.won}</td>
              <td className="num text-right">{row.lost}</td>
              <td className="num text-right opacity-75">
                {row.setsWon}–{row.setsLost}
              </td>
              <td className="num pr-0 text-right opacity-75">
                {row.pointsFor}–{row.pointsAgainst}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 mb-0 text-[11px] opacity-55">
        Ranked by matches won, then wins minus losses, set difference, point difference and finally
        the head-to-head result. A walkover counts as a played match — a win for one side and a
        loss for the other — but adds no sets and no points, so it never moves the difference
        columns.
      </p>
    </div>
  );
}
