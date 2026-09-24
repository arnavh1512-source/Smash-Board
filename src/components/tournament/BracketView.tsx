"use client";

import type { Doc } from "../../../convex/_generated/dataModel";
import { knockoutRoundName } from "@/lib/draw";
import { MatchRow, type EntryLookup } from "./MatchRow";

/** One round of the draw: a surface-coloured header, then its matches. */
function Round({
  title,
  meta,
  matches,
  entries,
  renderAction,
}: {
  title: string;
  meta: string;
  matches: Doc<"matches">[];
  entries: EntryLookup;
  renderAction?: (match: Doc<"matches">) => React.ReactNode;
}) {
  return (
    <div>
      <header className="rule-t2 rule-b flex items-baseline justify-between gap-3 bg-[var(--color-surface)] px-4 py-2.5">
        <h6 className="m-0">{title}</h6>
        <span className="text-[11px] text-muted">{meta}</span>
      </header>
      {matches.map((match) => (
        <MatchRow
          key={match._id}
          match={match}
          entries={entries}
          title={`Match ${match.slot + 1}`}
          action={renderAction?.(match)}
        />
      ))}
    </div>
  );
}

/**
 * The knockout draw, read top to bottom one round at a time. A phone cannot
 * show a side-by-side bracket without shrinking the names past readability,
 * so the design stacks the rounds instead.
 */
export function BracketView({
  matches,
  entries,
  renderAction,
}: {
  matches: Doc<"matches">[];
  entries: EntryLookup;
  renderAction?: (match: Doc<"matches">) => React.ReactNode;
}) {
  const main = matches.filter((m) => !m.isThirdPlace);
  const thirdPlace = matches.find((m) => m.isThirdPlace);
  if (main.length === 0) return null;

  const totalRounds = Math.max(...main.map((m) => m.round)) + 1;
  const rounds = Array.from({ length: totalRounds }, (_, round) =>
    main.filter((m) => m.round === round).sort((a, b) => a.slot - b.slot),
  );

  return (
    <div>
      {rounds.map((roundMatches, round) => (
        <Round
          key={round}
          title={knockoutRoundName(round, totalRounds)}
          meta={`${roundMatches.length} ${roundMatches.length === 1 ? "match" : "matches"}`}
          matches={roundMatches}
          entries={entries}
          renderAction={renderAction}
        />
      ))}

      {thirdPlace ? (
        <Round
          title="Third place"
          meta="Playoff"
          matches={[thirdPlace]}
          entries={entries}
          renderAction={renderAction}
        />
      ) : null}
    </div>
  );
}
