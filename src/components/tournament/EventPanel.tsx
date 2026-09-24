"use client";

import type { Doc } from "../../../convex/_generated/dataModel";
import type { ScoringConfig } from "@/lib/scoring";
import { scoringSummary } from "@/lib/display";
import { groupLabel } from "@/lib/draw";
import { BracketView } from "./BracketView";
import { StandingsTable } from "./StandingsTable";
import { MatchRow, type EntryLookup } from "./MatchRow";

const FORMAT_LABELS: Record<string, string> = {
  knockout: "Knockout",
  round_robin: "Round robin",
  groups_knockout: "Groups into a knockout",
};

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
  // The closing rounds may be played to their own rules, so the header says so
  // rather than leaving a spectator to work it out from the score.
  const semiFinalScoring = (event.semiFinalScoring as ScoringConfig | null | undefined) ?? null;
  const finalScoring = (event.finalScoring as ScoringConfig | null | undefined) ?? null;

  if (matches.length === 0) {
    return (
      <p className="note mx-4 my-4">The draw for {event.name} has not been made yet.</p>
    );
  }

  const groupIndexes = [...new Set(groupMatches.map((m) => m.groupIndex ?? 0))].sort((a, b) => a - b);
  const isRoundRobinOnly = event.format === "round_robin";
  const entrants = new Set(matches.flatMap((m) => [m.aId, m.bId]).filter(Boolean)).size;

  return (
    <div>
      <p className="m-0 px-4 py-2.5 text-[11px] tracking-[0.04em] text-muted">
        {FORMAT_LABELS[event.format] ?? event.format} · {entrants} entrants ·{" "}
        {scoringSummary(scoring)}
        {semiFinalScoring ? ` · Semi-finals ${scoringSummary(semiFinalScoring)}` : ""}
        {finalScoring ? ` · Final ${scoringSummary(finalScoring)}` : ""}
      </p>

      {groupIndexes.map((groupIndex) => {
        const inGroup = groupMatches.filter((m) => (m.groupIndex ?? 0) === groupIndex);
        const heading = isRoundRobinOnly
          ? "Standings"
          : `Group ${groupLabel(groupIndex)}`;
        return (
          <section key={groupIndex}>
            <header className="rule-t2 rule-b bg-[var(--color-surface)] px-4 py-2.5">
              <h6 className="m-0">{heading}</h6>
            </header>
            <div className="py-3">
              <StandingsTable
                matches={inGroup}
                entries={entries}
                scoring={scoring}
                teamSize={event.teamSize}
              />
            </div>
            {inGroup.map((match) => (
              <MatchRow
                key={match._id}
                match={match}
                entries={entries}
                title={`Round ${match.round + 1}`}
                action={renderAction?.(match)}
              />
            ))}
          </section>
        );
      })}

      {knockoutMatches.length > 0 ? (
        <BracketView matches={knockoutMatches} entries={entries} renderAction={renderAction} />
      ) : null}
    </div>
  );
}
