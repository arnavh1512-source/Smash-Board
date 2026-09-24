"use client";

import { Fragment } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Badge, LiveDot } from "@/components/ui";
import { STATUS_LABELS } from "@/lib/display";
import { clockOf, dayOf, formatDuration, gapMinutes } from "@/lib/schedule";
import type { EntryLookup } from "./MatchRow";
import { SideNames } from "./PlayerPick";

/**
 * The whole tournament in one list: every category merged, in the order the
 * matches actually go on court, with the gaps between them shown as breaks.
 *
 * The breaks are the point of the page. The scheduler guarantees each player a
 * rest period, and it fills those rests by putting another category on court —
 * so a reader needs to see one timeline, not one per category.
 */

interface Row {
  match: Doc<"matches">;
  startMinute: number;
  scheduledAt: string;
}

/** Only scheduled matches belong on a timeline, in start order, court order. */
function rowsOf(matches: readonly Doc<"matches">[]): Row[] {
  return matches
    .flatMap((match) =>
      match.scheduledAt !== undefined && match.scheduleOffset !== undefined
        ? [{ match, startMinute: match.scheduleOffset, scheduledAt: match.scheduledAt }]
        : [],
    )
    .sort(
      (a, b) => a.startMinute - b.startMinute || (a.match.court ?? "").localeCompare(b.match.court ?? ""),
    );
}

function BreakRow({ minutes }: { minutes: number }) {
  return (
    <li className="rule-b flex items-center gap-2 bg-[var(--color-surface)] px-4 py-2 text-[11px] uppercase tracking-[0.08em] text-muted">
      Break · {formatDuration(minutes)}
    </li>
  );
}

function MatchLine({
  match,
  scheduledAt,
  eventName,
  entries,
}: {
  match: Doc<"matches">;
  scheduledAt: string;
  eventName: string;
  entries: EntryLookup;
}) {
  const a = match.aId ? entries.get(match.aId) : undefined;
  const b = match.bId ? entries.get(match.bId) : undefined;
  const live = match.status === "live";

  return (
    <li className="rule-b flex items-start gap-3 px-4 py-3">
      <span className="num w-[68px] shrink-0 whitespace-nowrap pt-0.5 text-[15px] font-extrabold">
        {clockOf(scheduledAt)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-muted">
          {live ? <LiveDot size={6} /> : null}
          <span className="min-w-0 break-words">{eventName}</span>
          {match.court ? <span className="shrink-0">· {match.court}</span> : null}
        </p>
        <p className="m-0 break-words text-[14px] leading-tight">
          <SideNames entry={a} label={match.aLabel} /> <span className="text-muted">v</span>{" "}
          <SideNames entry={b} label={match.bLabel} />
        </p>
        {match.sets.length > 0 ? (
          <p className="num m-0 mt-1 text-[13px] text-muted">
            {match.sets.map((set) => `${set.a}–${set.b}`).join(", ")}
          </p>
        ) : null}
      </div>
      <span className="shrink-0">
        <Badge tone={live ? "accent" : "neutral"}>
          {STATUS_LABELS[match.status] ?? match.status}
        </Badge>
      </span>
    </li>
  );
}

export function OrderOfPlay({
  matches,
  events,
  entries,
  matchMinutes,
}: {
  matches: readonly Doc<"matches">[];
  events: readonly Doc<"events">[];
  entries: EntryLookup;
  /** How long one match holds a court, so the gap rows can be measured. */
  matchMinutes: number;
}) {
  const rows = rowsOf(matches);

  if (rows.length === 0) {
    return (
      <p className="note m-4">
        No order of play yet. Generate the draws, then plan the timings from the Setup tab.
      </p>
    );
  }

  const eventName = new Map(events.map((event) => [event._id, event.name] as const));
  const days = new Map<string, Row[]>();
  for (const row of rows) {
    const day = row.scheduledAt.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), row]);
  }

  return (
    <div>
      {[...days.entries()].map(([day, dayRows]) => {
        // The court with the latest finish so far: play only truly pauses when
        // every court is empty, so that is what a break is measured from.
        let latestEnd = dayRows[0].startMinute;
        return (
          <section key={day}>
            <header className="rule-t2 rule-b sticky top-[var(--nav-h)] z-10 bg-[var(--color-surface)] px-4 py-2.5">
              <h6 className="m-0">{dayOf(dayRows[0].scheduledAt)}</h6>
            </header>
            <ul className="m-0 list-none p-0">
              {dayRows.map((row) => {
                const gap = gapMinutes(latestEnd, row.startMinute);
                latestEnd = Math.max(latestEnd, row.startMinute + matchMinutes);
                return (
                  <Fragment key={row.match._id}>
                    {gap > 0 ? <BreakRow minutes={gap} /> : null}
                    <MatchLine
                      match={row.match}
                      scheduledAt={row.scheduledAt}
                      eventName={eventName.get(row.match.eventId) ?? "Category"}
                      entries={entries}
                    />
                  </Fragment>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
