"use client";

import type { Doc } from "../../../convex/_generated/dataModel";
import { Badge, LiveDot } from "@/components/ui";
import { sideName, STATUS_LABELS } from "@/lib/display";
import { clockOf, dayOf, formatDuration } from "@/lib/schedule";
import type { EntryLookup } from "./MatchRow";

/**
 * The same timetable read court by court.
 *
 * The chronological order of play answers "what happens next"; this answers
 * "what is my court doing all day", which is the question an umpire posted to
 * one court and an organiser checking the hall is not over-booked both ask.
 */

interface CourtRow {
  match: Doc<"matches">;
  startMinute: number;
  scheduledAt: string;
}

/** Matches grouped by the court they are on, each court in time order. */
function byCourt(matches: readonly Doc<"matches">[]): Map<string, CourtRow[]> {
  const grouped = new Map<string, CourtRow[]>();
  for (const match of matches) {
    if (match.scheduledAt === undefined || match.scheduleOffset === undefined) continue;
    const court = match.court ?? "Unassigned";
    grouped.set(court, [
      ...(grouped.get(court) ?? []),
      { match, startMinute: match.scheduleOffset, scheduledAt: match.scheduledAt },
    ]);
  }
  for (const rows of grouped.values()) rows.sort((a, b) => a.startMinute - b.startMinute);
  return new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })));
}

function CourtColumn({
  court,
  rows,
  eventName,
  entries,
  matchMinutes,
}: {
  court: string;
  rows: readonly CourtRow[];
  eventName: Map<string, string>;
  entries: EntryLookup;
  matchMinutes: number;
}) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const onCourt = rows.length * matchMinutes;

  return (
    <section className="border border-[var(--color-divider)]">
      <header className="rule-b2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-[var(--color-surface)] px-3.5 py-2.5">
        <h6 className="m-0">{court}</h6>
        <span className="num text-[11px] opacity-55">
          {rows.length} {rows.length === 1 ? "match" : "matches"} · {formatDuration(onCourt)} on
          court · {clockOf(first.scheduledAt)}–{clockOf(last.scheduledAt)}
        </span>
      </header>
      <ul className="m-0 list-none p-0">
        {rows.map((row) => {
          const a = row.match.aId ? entries.get(row.match.aId) : undefined;
          const b = row.match.bId ? entries.get(row.match.bId) : undefined;
          const live = row.match.status === "live";
          return (
            <li key={row.match._id} className="rule-b flex items-start gap-3 px-3.5 py-2.5 last:border-b-0">
              <span className="num w-[46px] shrink-0 pt-0.5 text-[14px] font-extrabold">
                {clockOf(row.scheduledAt)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] opacity-55">
                  {live ? <LiveDot size={6} /> : null}
                  <span className="truncate">{eventName.get(row.match.eventId) ?? "Category"}</span>
                </p>
                <p className="m-0 truncate text-[14px] leading-tight">
                  {sideName(a, row.match.aLabel)} <span className="opacity-45">v</span>{" "}
                  {sideName(b, row.match.bLabel)}
                </p>
              </div>
              <span className="shrink-0">
                <Badge tone={live ? "accent" : "neutral"}>
                  {STATUS_LABELS[row.match.status] ?? row.match.status}
                </Badge>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CourtGrid({
  matches,
  events,
  entries,
  matchMinutes,
}: {
  matches: readonly Doc<"matches">[];
  events: readonly Doc<"events">[];
  entries: EntryLookup;
  /** How long one match holds a court, for the load figure in each heading. */
  matchMinutes: number;
}) {
  const courts = byCourt(matches);

  if (courts.size === 0) {
    return (
      <p className="note m-4">
        No courts have been allotted yet. Plan the order of play and each match gets a court.
      </p>
    );
  }

  const eventName = new Map(events.map((event) => [event._id, event.name] as const));
  const days = new Set(
    [...courts.values()].flatMap((rows) => rows.map((row) => row.scheduledAt.slice(0, 10))),
  );

  return (
    <div className="flex flex-col gap-3.5 px-4 py-4">
      {days.size > 1 ? (
        <p className="m-0 text-[11px] uppercase tracking-[0.08em] opacity-55">
          {days.size} days of play
        </p>
      ) : (
        <p className="m-0 text-[11px] uppercase tracking-[0.08em] opacity-55">
          {dayOf([...courts.values()][0][0].scheduledAt)}
        </p>
      )}
      {[...courts.entries()].map(([court, rows]) => (
        <CourtColumn
          key={court}
          court={court}
          rows={rows}
          eventName={eventName}
          entries={entries}
          matchMinutes={matchMinutes}
        />
      ))}
    </div>
  );
}
