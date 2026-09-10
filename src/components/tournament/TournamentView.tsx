"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Spinner, cx } from "@/components/ui";
import { EventPanel } from "./EventPanel";
import { MatchRow } from "./MatchRow";
import { ShareBar } from "./ShareBar";
import { useTournamentData } from "./useTournamentData";

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

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Spinner label="Loading tournament" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Tournament not found</h1>
        <p className="mt-2 text-slate-600">
          The link may be wrong, or the organiser may have deleted it.
        </p>
        <Link href="/" className="mt-4 inline-block text-emerald-700 hover:underline">
          Back to all tournaments
        </Link>
      </div>
    );
  }

  const activeEvent = events.find((e) => e._id === activeEventId) ?? events[0];
  const eventMatches = activeEvent ? matches.filter((m) => m.eventId === activeEvent._id) : [];
  const liveMatches = matches.filter((m) => m.status === "live");
  const dates = formatRange(tournament.startDate, tournament.endDate);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tournament.name}</h1>
          <p className="mt-1 text-slate-600">
            {[tournament.venue, dates].filter(Boolean).join(" · ")}
          </p>
          {tournament.organiserName ? (
            <p className="mt-1 text-sm text-slate-500">
              Organised by {tournament.organiserName}
              {tournament.organiserPhone ? ` · ${tournament.organiserPhone}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <ShareBar name={tournament.name} path={`/t/${tournament.slug}`} />
          <Link
            href={`/t/${tournament.slug}/manage`}
            className="text-sm font-medium text-slate-500 hover:text-emerald-700"
          >
            Organiser sign-in
          </Link>
        </div>
      </header>

      {tournament.notes ? (
        <p className="mt-4 whitespace-pre-line rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          {tournament.notes}
        </p>
      ) : null}

      {liveMatches.length > 0 ? (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            On court now <Badge tone="green">{liveMatches.length}</Badge>
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {liveMatches.map((match) => (
              <MatchRow
                key={match._id}
                match={match}
                entries={entryMap}
                title={events.find((e) => e._id === match.eventId)?.name}
              />
            ))}
          </div>
        </section>
      ) : null}

      {events.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No categories have been added yet. Check back once the organiser sets up the draw.
        </p>
      ) : (
        <section className="mt-8">
          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
            {events.map((event) => (
              <button
                key={event._id}
                onClick={() => setActiveEventId(event._id)}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  event._id === activeEvent?._id
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-100",
                )}
              >
                {event.name}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {activeEvent ? (
              <EventPanel event={activeEvent} matches={eventMatches} entries={entryMap} />
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
