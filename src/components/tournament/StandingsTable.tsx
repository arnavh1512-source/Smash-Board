"use client";

import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { computeStandings } from "@/lib/standings";
import type { ScoringConfig } from "@/lib/scoring";
import { entryName } from "@/lib/display";
import type { EntryLookup } from "./MatchRow";

const HEADINGS = ["#", "Player", "P", "W", "L", "Sets", "Points"];

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
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[28rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {HEADINGS.map((heading) => (
              <th key={heading} className="px-3 py-2 font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.entryId}>
              <td className="px-3 py-2 tabular-nums text-slate-500">{row.rank}</td>
              <td className="px-3 py-2 font-medium text-slate-900">
                {entryName(entries.get(row.entryId as Id<"entries">))}
              </td>
              <td className="px-3 py-2 tabular-nums">{row.played}</td>
              <td className="px-3 py-2 tabular-nums font-semibold text-emerald-700">{row.won}</td>
              <td className="px-3 py-2 tabular-nums">{row.lost}</td>
              <td className="px-3 py-2 tabular-nums text-slate-600">
                {row.setsWon}–{row.setsLost}
              </td>
              <td className="px-3 py-2 tabular-nums text-slate-600">
                {row.pointsFor}–{row.pointsAgainst}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
