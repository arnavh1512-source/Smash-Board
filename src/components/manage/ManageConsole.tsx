"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Alert, Button, Card, Spinner, cx } from "@/components/ui";
import { EventPanel } from "@/components/tournament/EventPanel";
import { ShareBar } from "@/components/tournament/ShareBar";
import { useTournamentData } from "@/components/tournament/useTournamentData";
import { usePin, errorMessage } from "@/lib/usePin";
import { scoringSummary } from "@/lib/display";
import type { ScoringConfig } from "@/lib/scoring";
import { PinGate } from "./PinGate";
import { EventForm } from "./EventForm";
import { EntryManager } from "./EntryManager";
import { DrawPanel } from "./DrawPanel";
import { ScoreDialog } from "./ScoreDialog";
import { TournamentSettings } from "./TournamentSettings";

const TABS = [
  { id: "scores", label: "Scores" },
  { id: "entrants", label: "Entrants" },
  { id: "draw", label: "Draw" },
  { id: "categories", label: "Categories" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function EventTabs({
  events,
  activeId,
  onSelect,
}: {
  events: Doc<"events">[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {events.map((event) => (
        <button
          key={event._id}
          onClick={() => onSelect(event._id)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition",
            event._id === activeId ? "bg-emerald-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100",
          )}
        >
          {event.name}
        </button>
      ))}
    </div>
  );
}

function CategoryList({
  events,
  pin,
  onEdit,
}: {
  events: Doc<"events">[];
  pin: string;
  onEdit: (event: Doc<"events">) => void;
}) {
  const remove = useMutation(api.events.remove);
  const [error, setError] = useState<string | null>(null);

  if (events.length === 0) return null;

  return (
    <Card>
      <h3 className="text-lg font-semibold tracking-tight">Categories</h3>
      {error ? (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      <ul className="mt-4 space-y-2">
        {events.map((event) => (
          <li
            key={event._id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{event.name}</p>
              <p className="truncate text-xs text-slate-500">
                {event.teamSize === 2 ? "Doubles" : "Singles"} ·{" "}
                {scoringSummary(event.scoring as ScoringConfig)}
              </p>
            </div>
            <Button variant="ghost" className="px-2 py-1" onClick={() => onEdit(event)}>
              Edit
            </Button>
            <Button
              variant="danger"
              className="px-2 py-1"
              onClick={async () => {
                if (!window.confirm(`Delete ${event.name} with all its entrants and scores?`)) return;
                setError(null);
                try {
                  await remove({ eventId: event._id, pin });
                } catch (caught) {
                  setError(errorMessage(caught));
                }
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The organiser's whole workspace: PIN gate, then one tab per job. Every panel
 * reads the same live subscriptions as the public page, so a saved score shows
 * up on the scoreboard immediately.
 */
export function ManageConsole({ slug }: { slug: string }) {
  const { pin, setPin, ready } = usePin(slug);
  const { tournament, events, entries, matches, entryMap, loading } = useTournamentData(slug);
  const [tab, setTab] = useState<TabId>("scores");
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<Doc<"events"> | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [scoringMatch, setScoringMatch] = useState<Doc<"matches"> | null>(null);

  if (!ready || loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Spinner label="Loading console" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Tournament not found</h1>
        <Link href="/" className="mt-4 inline-block text-emerald-700 hover:underline">
          Back to all tournaments
        </Link>
      </div>
    );
  }

  if (!pin) {
    return (
      <PinGate
        tournamentId={tournament._id}
        tournamentName={tournament.name}
        onUnlock={setPin}
      />
    );
  }

  const activeEvent = events.find((e) => e._id === activeEventId) ?? events[0] ?? null;
  const eventEntries = activeEvent ? entries.filter((e) => e.eventId === activeEvent._id) : [];
  const eventMatches = activeEvent ? matches.filter((m) => m.eventId === activeEvent._id) : [];
  // The live dialog needs the freshest copy of the match, not the one captured on click.
  const openMatch = scoringMatch ? matches.find((m) => m._id === scoringMatch._id) ?? null : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            Organiser console
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tournament.name}</h1>
          <Link
            href={`/t/${tournament.slug}`}
            className="mt-1 inline-block text-sm text-slate-500 hover:text-emerald-700"
          >
            View the public scoreboard
          </Link>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <ShareBar name={tournament.name} path={`/t/${tournament.slug}`} />
          <Button variant="ghost" className="px-2 py-1" onClick={() => setPin(null)}>
            Lock the console
          </Button>
        </div>
      </header>

      <nav className="mt-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map((option) => (
          <button
            key={option.id}
            onClick={() => setTab(option.id)}
            className={cx(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              tab === option.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {events.length === 0 && tab !== "settings" ? (
        <div className="mt-6 space-y-4">
          <Alert kind="info">
            Add a category first — Men&apos;s Singles, U-17 Doubles, whatever your event needs. Each
            one carries its own scoring rules and its own draw.
          </Alert>
          <EventForm
            tournamentId={tournament._id}
            pin={pin}
            event={null}
            onDone={() => setShowEventForm(false)}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {tab !== "settings" && tab !== "categories" ? (
            <EventTabs
              events={events}
              activeId={activeEvent?._id ?? null}
              onSelect={setActiveEventId}
            />
          ) : null}

          {tab === "scores" && activeEvent ? (
            <EventPanel
              event={activeEvent}
              matches={eventMatches}
              entries={entryMap}
              renderAction={(match) => (
                <Button variant="secondary" className="px-2 py-1" onClick={() => setScoringMatch(match)}>
                  Score
                </Button>
              )}
            />
          ) : null}

          {tab === "entrants" && activeEvent ? (
            <EntryManager event={activeEvent} entries={eventEntries} pin={pin} />
          ) : null}

          {tab === "draw" && activeEvent ? (
            <DrawPanel
              event={activeEvent}
              playingCount={eventEntries.filter((entry) => !entry.withdrawn).length}
              hasMatches={eventMatches.length > 0}
              pin={pin}
            />
          ) : null}

          {tab === "categories" ? (
            <>
              {showEventForm || editingEvent ? (
                <EventForm
                  tournamentId={tournament._id}
                  pin={pin}
                  event={editingEvent}
                  onDone={() => {
                    setShowEventForm(false);
                    setEditingEvent(null);
                  }}
                />
              ) : (
                <Button onClick={() => setShowEventForm(true)}>Add a category</Button>
              )}
              <CategoryList
                events={events}
                pin={pin}
                onEdit={(event) => {
                  setEditingEvent(event);
                  setShowEventForm(false);
                }}
              />
            </>
          ) : null}

          {tab === "settings" ? (
            <TournamentSettings tournament={tournament} pin={pin} onPinChanged={setPin} />
          ) : null}
        </div>
      )}

      {openMatch && activeEvent ? (
        <ScoreDialog
          match={openMatch}
          event={events.find((e) => e._id === openMatch.eventId) ?? activeEvent}
          entries={entryMap}
          pin={pin}
          onClose={() => setScoringMatch(null)}
        />
      ) : null}
    </div>
  );
}
