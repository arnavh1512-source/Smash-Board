"use client";

import type { Doc } from "../../../convex/_generated/dataModel";
import { knockoutRoundName } from "@/lib/draw";
import { MatchRow, type EntryLookup } from "./MatchRow";

/**
 * The knockout draw, one column per round. It scrolls sideways on a phone
 * rather than squeezing the columns, so names stay readable.
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
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex min-w-max gap-4">
        {rounds.map((roundMatches, round) => (
          <div key={round} className="w-64 shrink-0 space-y-3">
            <h4 className="text-sm font-semibold text-slate-700">
              {knockoutRoundName(round, totalRounds)}
            </h4>
            {roundMatches.map((match) => (
              <MatchRow
                key={match._id}
                match={match}
                entries={entries}
                title={`Match ${match.slot + 1}`}
                action={renderAction?.(match)}
              />
            ))}
          </div>
        ))}

        {thirdPlace ? (
          <div className="w-64 shrink-0 space-y-3">
            <h4 className="text-sm font-semibold text-slate-700">Third place</h4>
            <MatchRow
              match={thirdPlace}
              entries={entries}
              title="Playoff"
              action={renderAction?.(thirdPlace)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
