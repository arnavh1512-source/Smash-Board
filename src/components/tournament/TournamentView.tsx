"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Badge, LiveDot, Spinner, cx } from "@/components/ui";
import { CourtGrid } from "./CourtGrid";
import { EventPanel } from "./EventPanel";
import { MatchRow } from "./MatchRow";
import { OrderOfPlay } from "./OrderOfPlay";
import { PlayerPickProvider, usePlayerParam } from "./PlayerPick";
import { PlayerSheet } from "./PlayerSheet";
import { ShareBar } from "./ShareBar";
import { StaleScheduleNotice } from "./StaleScheduleNotice";
import { useTournamentData } from "./useTournamentData";
import { DEFAULT_SCHEDULE } from "@/lib/schedule";

function formatRange(start?: string, end?: string): string | null {
  const fmt = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };
  if (!start && !end) return null;
  if (start && end && start !== end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt((start ?? end) as string);
}

export function TournamentView({ slug }: { slug: string }) {
  const { tournament, events, matches, entryMap, loading } = useTournamentData(slug);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [view, setView] = useState<"categories" | "order" | "courts">("categories");
  const [player, setPlayer] = usePlayerParam();
  const closePlayer = useCallback(() => setPlayer(null), [setPlayer]);

  if (loading) {
    return <Spinner label="Loading tournament" />;
  }

  if (!tournament) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h3>Tournament not found</h3>
        <p className="text-[13px] opacity-75">
          The link may be wrong, or the organiser may have deleted it.
        </p>
        <Link href="/" className="text-[13px]">
          Back to all tournaments
        </Link>
      </div>
    );
  }

  const activeEvent = events.find((e) => e._id === activeEventId) ?? events[0];
  const eventMatches = activeEvent ? matches.filter((m) => m.eventId === activeEvent._id) : [];
  const liveMatches = matches.filter((m) => m.status === "live");
  const timetabled = matches.some((m) => m.scheduledAt !== undefined);
  const showOrder = timetabled && view === "order";
  const showCourts = timetabled && view === "courts";
  const dates = formatRange(tournament.startDate, tournament.endDate);
  const where = [tournament.venue, dates].filter(Boolean).join(" · ");

  return (
    <PlayerPickProvider onPick={setPlayer}>
    <div className="mx-auto w-full max-w-3xl">
      <header className="rule-b2 flex flex-col gap-3 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="m-0 text-[26px]">{tournament.name}</h2>
          <Link
            href={`/t/${tournament.slug}/manage`}
            className="shrink-0 whitespace-nowrap text-[12px]"
          >
            Organiser sign-in
          </Link>
        </div>
        {where ? <p className="m-0 text-[13px] opacity-75">{where}</p> : null}
        {tournament.organiserName ? (
          <p className="m-0 text-[13px] opacity-75">
            Organised by {tournament.organiserName}
            {tournament.organiserPhone ? ` · ${tournament.organiserPhone}` : ""}
          </p>
        ) : null}
        <ShareBar name={tournament.name} path={`/t/${tournament.slug}`} />
        {events.length > 0 ? (
          <p className="m-0 text-[12px] opacity-60">
            Tap any player&apos;s name to see their matches, times and courts.
          </p>
        ) : null}
      </header>

      {tournament.notes ? (
        <p className="rule-b2 m-0 whitespace-pre-line border-l-2 border-l-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 text-[13px] leading-relaxed">
          {tournament.notes}
        </p>
      ) : null}

      {liveMatches.length > 0 ? (
        <section className="rule-b2">
          <header className="flex items-center gap-2 px-4 py-2.5">
            <LiveDot />
            <h6 className="m-0">On court now</h6>
            <Badge tone="accent">{liveMatches.length}</Badge>
          </header>
          {liveMatches.map((match) => (
            <MatchRow
              key={match._id}
              match={match}
              entries={entryMap}
              title={events.find((e) => e._id === match.eventId)?.name}
            />
          ))}
        </section>
      ) : null}

      {events.length === 0 ? (
        <p className="note m-4">
          No categories have been added yet. Check back once the organiser sets up the draw.
        </p>
      ) : (
        <section>
          {timetabled ? (
            <nav className="rule-b2 flex">
              {(["categories", "order", "courts"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  aria-pressed={view === option}
                  className={cx(
                    "btn min-h-12 flex-1 justify-center border-0 border-b-2 text-[12px]",
                    view === option
                      ? "border-b-[var(--color-accent)] font-extrabold"
                      : "border-b-transparent opacity-55",
                  )}
                >
                  {option === "categories"
                    ? "By category"
                    : option === "order"
                      ? "Order of play"
                      : "By court"}
                </button>
              ))}
            </nav>
          ) : null}

          {showOrder || showCourts ? (
            <StaleScheduleNotice
              tournamentId={tournament._id}
              audience="public"
              className="rule-b2 px-4 py-3.5"
            />
          ) : null}

          {showCourts ? (
            <CourtGrid
              matches={matches}
              events={events}
              entries={entryMap}
              matchMinutes={tournament.schedule?.matchMinutes ?? DEFAULT_SCHEDULE.matchMinutes}
            />
          ) : showOrder ? (
            <OrderOfPlay
              matches={matches}
              events={events}
              entries={entryMap}
              matchMinutes={tournament.schedule?.matchMinutes ?? DEFAULT_SCHEDULE.matchMinutes}
            />
          ) : (
            <>
          <div className="rule-b2 flex overflow-x-auto">
            {events.map((event) => (
              <button
                key={event._id}
                type="button"
                onClick={() => setActiveEventId(event._id)}
                aria-pressed={event._id === activeEvent?._id}
                className={cx(
                  "min-h-12 shrink-0 whitespace-nowrap border-0 border-b-2 px-3.5 text-[13px]",
                  event._id === activeEvent?._id
                    ? "border-b-[var(--color-accent)] font-extrabold"
                    : "border-b-transparent opacity-55",
                )}
              >
                {event.name}
              </button>
            ))}
          </div>

          {activeEvent ? (
            <EventPanel event={activeEvent} matches={eventMatches} entries={entryMap} />
          ) : null}
            </>
          )}
        </section>
      )}

      <p className="rule-t2 m-0 flex items-center gap-2 px-4 py-3.5 text-[12px] opacity-60">
        <LiveDot size={6} />
        Updating live · no need to refresh
      </p>

      {player ? (
        <PlayerSheet
          name={player}
          matches={matches}
          events={events}
          entries={entryMap}
          onClose={closePlayer}
        />
      ) : null}
    </div>
    </PlayerPickProvider>
  );
}
