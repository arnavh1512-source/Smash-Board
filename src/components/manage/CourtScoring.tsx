"use client";

import type { Doc } from "../../../convex/_generated/dataModel";
import { Alert, Button, cx } from "@/components/ui";
import { MatchRow, type EntryLookup } from "@/components/tournament/MatchRow";
import { courtQueue } from "@/lib/courtQueue";

/**
 * Scoring one court at a time.
 *
 * An umpire is posted to a court, not to a category. This lists every match
 * booked on that court across all categories, puts the one on court now at the
 * top with the next ones under it, and keeps what has been played underneath
 * for correcting a score. The chosen court lives in the address bar, so an
 * organiser can hand each umpire a link that opens straight onto their court.
 */
export function CourtScoring({
  courts,
  court,
  onCourt,
  matches,
  events,
  entries,
  onScore,
}: {
  courts: readonly string[];
  court: string;
  onCourt: (court: string) => void;
  matches: readonly Doc<"matches">[];
  events: readonly Doc<"events">[];
  entries: EntryLookup;
  onScore: (match: Doc<"matches">) => void;
}) {
  const eventName = new Map(events.map((event) => [event._id, event.name] as const));
  const queue = courts.includes(court) ? courtQueue(matches, court) : null;

  const row = (match: Doc<"matches">, label: string, primary = false) => (
    <MatchRow
      key={match._id}
      match={match}
      entries={entries}
      title={eventName.get(match.eventId) ?? "Category"}
      action={
        <Button
          variant={primary ? "primary" : "secondary"}
          className="text-[12px]"
          onClick={() => onScore(match)}
        >
          {label}
        </Button>
      }
    />
  );

  return (
    <div>
      <div className="rule-b scroll-hint flex overflow-x-auto" role="group" aria-label="Courts">
        {courts.map((option) => {
          const left = courtQueue(matches, option);
          const remaining = left.upNext.length + (left.now ? 1 : 0);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onCourt(option)}
              aria-pressed={option === court}
              className={cx(
                "btn min-h-11 shrink-0 gap-1.5 whitespace-nowrap border-0 border-b-2 px-3.5 text-[12px]",
                option === court
                  ? "border-b-[var(--color-accent)] font-extrabold"
                  : "border-b-transparent text-muted hover:border-b-[var(--color-divider)]",
              )}
            >
              {option}
              <span className="num text-[10px] text-muted" aria-label={`${remaining} to play`}>
                {remaining}
              </span>
            </button>
          );
        })}
      </div>

      {!queue ? (
        <div className="px-4 py-5">
          <Alert kind="info">Pick the court you are umpiring.</Alert>
        </div>
      ) : (
        <>
          <header className="rule-b bg-[var(--color-surface)] px-4 py-2.5">
            <h6 className="m-0">
              {queue.now?.status === "live" ? `On ${court} now` : `Next on ${court}`}
            </h6>
          </header>
          {queue.now ? (
            row(queue.now, "Score this match", true)
          ) : (
            <p className="note m-4">Nothing left to play on {court}.</p>
          )}

          {queue.upNext.length > 0 ? (
            <>
              <header className="rule-t2 rule-b bg-[var(--color-surface)] px-4 py-2.5">
                <h6 className="m-0">Then on {court}</h6>
              </header>
              {queue.upNext.map((match) => row(match, "Score this match"))}
            </>
          ) : null}

          {queue.finished.length > 0 ? (
            <details className="rule-t2">
              <summary className="btn min-h-11 w-full justify-between border-0 px-4 text-[12px]">
                Played on {court} ({queue.finished.length})
              </summary>
              {queue.finished.map((match) => row(match, "Correct the score"))}
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
