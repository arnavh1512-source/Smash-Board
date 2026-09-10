"use client";

import type { Doc } from "../../../convex/_generated/dataModel";
import type { ScoringConfig } from "@/lib/scoring";
import { scoringSummary } from "@/lib/display";
import { BracketView } from "./BracketView";
import { StandingsTable } from "./StandingsTable";
import { MatchRow, type EntryLookup } from "./MatchRow";

/**
 * One category's draw: groups and their tables first (when the format has
 * them), then the knockout bracket. Used by both the public page and the
 * organiser console, which passes a per-match action.
 */
export function EventPanel({
  event,
  matches,
  entries,
  renderAction,
}: {
  event: Doc<"events">;
  matches: Doc<"matches">[];
  entries: EntryLookup;
  renderAction?: (match: Doc<"matches">) => React.ReactNode;
}) {
  const groupMatches = matches.filter((m) => m.stage === "group");
  const knockoutMatches = matches.filter((m) => m.stage === "knockout");
  const scoring = event.scoring as ScoringConfig;

  if (matches.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
        The draw for {event.name} has not been made yet.
      </p>
    );
  }

  const groupIndexes = [...new Set(groupMatches.map((m) => m.groupIndex ?? 0))].sort((a, b) => a - b);
  const isRoundRobinOnly = event.format === "round_robin";

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600">{scoringSummary(scoring)}</p>

      {groupIndexes.map((groupIndex) => {
        const inGroup = groupMatches.filter((m) => (m.groupIndex ?? 0) === groupIndex);
        const heading = isRoundRobinOnly
          ? "Standings"
          : `Group ${String.fromCharCode(65 + groupIndex)}`;
        return (
          <section key={groupIndex} className="space-y-3">
            <h3 className="text-lg font-semibold tracking-tight">{heading}</h3>
            <StandingsTable matches={inGroup} entries={entries} scoring={scoring} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {inGroup.map((match) => (
                <MatchRow
                  key={match._id}
                  match={match}
                  entries={entries}
                  title={`Round ${match.round + 1}`}
                  action={renderAction?.(match)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {knockoutMatches.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold tracking-tight">Knockout draw</h3>
          <BracketView matches={knockoutMatches} entries={entries} renderAction={renderAction} />
        </section>
      ) : null}
    </div>
  );
}
