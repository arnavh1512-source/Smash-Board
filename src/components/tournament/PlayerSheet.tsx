"use client";

import { useEffect } from "react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Badge, Button, LiveDot, cx } from "@/components/ui";
import { STATUS_LABELS } from "@/lib/display";
import {
  isFinished,
  matchesOfPerson,
  nextMatchOf,
  partnerOf,
  roundTitle,
  sideOf,
} from "@/lib/playerMatches";
import { clockOf, dayOf } from "@/lib/schedule";
import { PlayerName, SideNames } from "./PlayerPick";
import type { EntryLookup } from "./MatchRow";

/**
 * One player's matches across the whole tournament: when, on which court,
 * against whom, and how the finished ones went.
 *
 * Opened by tapping a name anywhere on the public scoreboard. It is the answer
 * to the question a player otherwise walks up to the desk to ask.
 */

function when(match: Doc<"matches">, showDay: boolean): string | null {
  if (!match.scheduledAt) return null;
  return showDay ? `${dayOf(match.scheduledAt)} · ${clockOf(match.scheduledAt)}` : clockOf(match.scheduledAt);
}

/** The score from the player's own side of the net: their points first. */
function scoreLine(match: Doc<"matches">, side: "a" | "b"): string {
  return match.sets
    .map((set) => (side === "a" ? `${set.a}–${set.b}` : `${set.b}–${set.a}`))
    .join(", ");
}

function outcome(match: Doc<"matches">, side: "a" | "b"): "Won" | "Lost" | null {
  if (!isFinished(match) || match.winnerId === null) return null;
  return match.winnerId === (side === "a" ? match.aId : match.bId) ? "Won" : "Lost";
}

function MatchLine({
  match,
  side,
  title,
  entries,
  showDay,
}: {
  match: Doc<"matches">;
  side: "a" | "b";
  title: string;
  entries: EntryLookup;
  showDay: boolean;
}) {
  const opponentId = side === "a" ? match.bId : match.aId;
  const opponentLabel = side === "a" ? match.bLabel : match.aLabel;
  const opponent = opponentId ? entries.get(opponentId) : undefined;
  const live = match.status === "live";
  const result = outcome(match, side);
  const time = when(match, showDay);

  return (
    <li className="rule-b flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] opacity-55">
          {live ? <LiveDot size={6} /> : null}
          <span className="truncate">{title}</span>
        </p>
        <p className="m-0 mt-1 text-[14px] leading-snug">
          <span className="opacity-45">v </span>
          <SideNames entry={opponent} label={opponentLabel} />
        </p>
        <p className="num m-0 mt-1 text-[13px]">
          {match.court ? <strong>{match.court}</strong> : <span className="opacity-55">Court not set</span>}
          <span className="opacity-45"> · </span>
          {time ? <span>{time}</span> : <span className="opacity-55">Time not set</span>}
        </p>
        {match.sets.length > 0 ? (
          <p className="num m-0 mt-1 text-[13px] opacity-75">{scoreLine(match, side)}</p>
        ) : null}
      </div>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={live ? "accent" : "neutral"}>{STATUS_LABELS[match.status] ?? match.status}</Badge>
        {result ? (
          <span className={cx("text-[11px] uppercase tracking-[0.08em]", result === "Won" ? "font-extrabold" : "opacity-55")}>
            {result}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function PlayerSheet({
  name,
  matches,
  events,
  entries,
  onClose,
}: {
  name: string;
  matches: readonly Doc<"matches">[];
  events: readonly Doc<"events">[];
  entries: EntryLookup;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mine = matchesOfPerson(name, matches, entries);
  const next = nextMatchOf(mine);
  const eventOf = new Map<string, Doc<"events">>(events.map((event) => [event._id, event]));
  const days = new Set(mine.flatMap((m) => (m.scheduledAt ? [m.scheduledAt.slice(0, 10)] : [])));
  const showDay = days.size > 1;

  const titleOf = (match: Doc<"matches">) => {
    const event = eventOf.get(match.eventId);
    const categoryMatches = matches.filter((m) => m.eventId === match.eventId);
    const round = roundTitle(match, categoryMatches, event?.format ?? "knockout");
    return `${event?.name ?? "Category"} · ${round}`;
  };

  // Categories the person is in, with a partner named for each doubles pair.
  const categories = [...new Set(mine.map((m) => m.eventId))].map((eventId) => {
    const match = mine.find((m) => m.eventId === eventId)!;
    const side = sideOf(match, name, entries)!;
    const entry = entries.get((side === "a" ? match.aId : match.bId)!);
    return { eventId, name: eventOf.get(eventId)?.name ?? "Category", partner: entry ? partnerOf(entry, name) : null };
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s matches`}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[color-mix(in_srgb,#201e1d_55%,transparent)] sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto border border-[var(--color-divider)] bg-[var(--color-bg)]">
        <header className="rule-b2 sticky top-0 z-10 flex items-start gap-3 bg-[var(--color-surface)] px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h6 className="m-0 truncate">{name}</h6>
            <p className="m-0 mt-1 text-[11px] opacity-60">
              {categories.length === 0
                ? "Not in any draw"
                : categories.map((c, i) => (
                    <span key={c.eventId}>
                      {i > 0 ? " · " : ""}
                      {c.name}
                      {c.partner ? (
                        <>
                          {" "}with <PlayerName name={c.partner} />
                        </>
                      ) : null}
                    </span>
                  ))}
            </p>
          </div>
          <Button variant="ghost" className="min-h-10 text-[12px]" onClick={onClose} autoFocus>
            Close
          </Button>
        </header>

        {mine.length === 0 ? (
          <p className="note m-4">
            No matches for {name} yet. The draw may not have been made, or the name may be spelled
            differently on the entry list.
          </p>
        ) : (
          <>
            {next ? (
              <section className="rule-b2 border-l-2 border-l-[var(--color-accent)] px-4 py-3">
                <p className="m-0 text-[11px] uppercase tracking-[0.08em] opacity-60">
                  {next.status === "live" ? "On court now" : "Next match"}
                </p>
                <p className="num m-0 mt-1 text-[20px] font-extrabold leading-tight">
                  {next.court ?? "Court to be announced"}
                  {when(next, showDay) ? ` · ${when(next, showDay)}` : ""}
                </p>
                <p className="m-0 mt-1 text-[12px] opacity-70">{titleOf(next)}</p>
              </section>
            ) : (
              <p className="rule-b2 m-0 px-4 py-3 text-[13px] opacity-70">
                All of {name}&apos;s matches are finished.
              </p>
            )}
            <ul className="m-0 list-none p-0">
              {mine.map((match) => (
                <MatchLine
                  key={match._id}
                  match={match}
                  side={sideOf(match, name, entries)!}
                  title={titleOf(match)}
                  entries={entries}
                  showDay={showDay}
                />
              ))}
            </ul>
            <p className="m-0 px-4 py-3 text-[11px] opacity-55">
              Times follow the order of play and move if the organiser replans it. Listen for your
              name at the desk before walking on.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
