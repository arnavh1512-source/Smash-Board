"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Alert, Button, Spinner, cx } from "@/components/ui";
import { EventPanel } from "@/components/tournament/EventPanel";
import { ShareBar } from "@/components/tournament/ShareBar";
import { useTournamentData } from "@/components/tournament/useTournamentData";
import { useSession, errorMessage } from "@/lib/useSession";
import { scoringSummary } from "@/lib/display";
import { scoringForRound, type RoundScoring, type ScoringConfig } from "@/lib/scoring";
import { countKnockoutRounds } from "@/lib/draw";
import { PinGate } from "./PinGate";
import { EventForm } from "./EventForm";
import { EntryManager } from "./EntryManager";
import { DrawPanel } from "./DrawPanel";
import { SchedulePanel } from "./SchedulePanel";
import { ScoreDialog } from "./ScoreDialog";
import { TournamentSettings } from "./TournamentSettings";
import { DEFAULT_SCHEDULE } from "@/lib/schedule";

/** Who is holding the console. A referee may enter scores and nothing else. */
export type ConsoleRole = "organiser" | "referee";

const TABS = [
  { id: "scores", label: "Scores" },
  { id: "entrants", label: "Entrants" },
  { id: "draw", label: "Draw" },
  { id: "schedule", label: "Order" },
  { id: "categories", label: "Events" },
  { id: "settings", label: "Setup" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** The category strip. Referees see it too — they still have to pick a court. */
function EventTabs({
  events,
  activeId,
  onSelect,
}: {
  events: Doc<"events">[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (events.length < 2) return null;
  return (
    <div className="rule-b flex overflow-x-auto">
      {events.map((event) => (
        <button
          key={event._id}
          type="button"
          onClick={() => onSelect(event._id)}
          aria-pressed={event._id === activeId}
          className={cx(
            "btn min-h-11 shrink-0 whitespace-nowrap border-0 border-b-2 px-3.5 text-[12px]",
            event._id === activeId
              ? "border-b-[var(--color-accent)] font-extrabold"
              : "border-b-transparent opacity-55",
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
  token,
  onEdit,
}: {
  events: Doc<"events">[];
  token: string;
  onEdit: (event: Doc<"events">) => void;
}) {
  const remove = useMutation(api.events.remove);
  const [error, setError] = useState<string | null>(null);

  if (events.length === 0) return null;

  return (
    <div>
      <header className="rule-t2 rule-b bg-[var(--color-surface)] px-4 py-2.5">
        <h6 className="m-0">All categories</h6>
      </header>
      {error ? (
        <div className="px-4 pt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      <ul className="m-0 list-none p-0">
        {events.map((event) => (
          <li key={event._id} className="rule-b flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[14px] font-extrabold leading-tight">{event.name}</p>
              <p className="m-0 truncate text-[11px] opacity-55">
                {event.teamSize === 2 ? "Doubles" : "Singles"} ·{" "}
                {scoringSummary(event.scoring as ScoringConfig)}
              </p>
            </div>
            <Button variant="ghost" className="min-h-10" onClick={() => onEdit(event)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              className="min-h-10 opacity-70"
              onClick={async () => {
                if (!window.confirm(`Delete ${event.name} with all its entrants and scores?`)) return;
                setError(null);
                try {
                  await remove({ eventId: event._id, token });
                } catch (caught) {
                  // A category holding played matches is refused the first time.
                  // Deleting a record of a competition is not undoable from
                  // anywhere in the product, so the organiser is told exactly
                  // what is about to be thrown away and has to say yes again.
                  const message = errorMessage(caught);
                  if (!message.includes("has results in it")) {
                    setError(message);
                    return;
                  }
                  if (
                    !window.confirm(
                      `${event.name} has matches that have already been played. Deleting it throws those results away for good. Delete it anyway?`,
                    )
                  ) {
                    return;
                  }
                  try {
                    await remove({ eventId: event._id, token, force: true });
                  } catch (forced) {
                    setError(errorMessage(forced));
                  }
                }
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The console behind a PIN: one tab per job for an organiser, and the scores
 * tab alone for a referee. Every panel reads the same live subscriptions as the
 * public page, so a saved score shows up on the scoreboard immediately.
 */
export function ManageConsole({
  slug,
  role = "organiser",
}: {
  slug: string;
  role?: ConsoleRole;
}) {
  const referee = role === "referee";
  const { token, setToken, ready } = useSession(slug, role);
  const { tournament, events, entries, matches, entryMap, loading } = useTournamentData(slug);
  const [tab, setTab] = useState<TabId>("scores");
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<Doc<"events"> | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [scoringMatch, setScoringMatch] = useState<Doc<"matches"> | null>(null);

  if (!ready || loading) return <Spinner label="Loading console" />;

  if (!tournament) {
    return (
      <div className="px-4 py-10">
        <h3 className="m-0">Tournament not found</h3>
        <p className="mt-2 text-[13px] opacity-70">
          The link may be wrong, or the tournament has been deleted.
        </p>
        <Link href="/">Back to all tournaments</Link>
      </div>
    );
  }

  if (!token) {
    return (
      <PinGate
        slug={slug}
        role={role}
        tournamentId={tournament._id}
        tournamentName={tournament.name}
        onUnlock={setToken}
      />
    );
  }

  const visibleTabs = referee ? TABS.filter((option) => option.id === "scores") : TABS;
  const activeEvent = events.find((e) => e._id === activeEventId) ?? events[0] ?? null;
  const eventEntries = activeEvent ? entries.filter((e) => e.eventId === activeEvent._id) : [];
  const eventMatches = activeEvent ? matches.filter((m) => m.eventId === activeEvent._id) : [];
  const matchMinutes = tournament.schedule?.matchMinutes ?? DEFAULT_SCHEDULE.matchMinutes;
  // The live dialog needs the freshest copy of the match, not the one captured on click.
  const openMatch = scoringMatch ? matches.find((m) => m._id === scoringMatch._id) ?? null : null;
  const openEvent = openMatch
    ? events.find((e) => e._id === openMatch.eventId) ?? activeEvent
    : null;
  // The closing rounds may be played to their own rules, so the dialog is told
  // which configuration this particular match is governed by.
  const openScoring =
    openMatch && openEvent
      ? scoringForRound(
          openEvent as unknown as RoundScoring,
          openMatch,
          countKnockoutRounds(matches.filter((m) => m.eventId === openMatch.eventId)),
        )
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="rule-b2 flex flex-col gap-3 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[11px] uppercase tracking-[0.08em] text-[var(--color-accent-ink)]">
              {referee ? "Referee console" : "Organiser console"}
            </p>
            <h2 className="m-0 mt-1 text-[26px]">{tournament.name}</h2>
            <Link href={`/t/${tournament.slug}`} className="text-[12px]">
              View the public scoreboard
            </Link>
          </div>
          <Button variant="ghost" className="min-h-10 text-[12px]" onClick={() => setToken(null)}>
            Lock
          </Button>
        </div>
        <ShareBar name={tournament.name} path={`/t/${tournament.slug}`} compact />
      </header>

      {visibleTabs.length > 1 ? (
        <nav className="rule-b2 flex">
          {visibleTabs.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTab(option.id)}
              aria-pressed={tab === option.id}
              className={cx(
                "btn min-h-12 flex-1 justify-center border-0 border-b-2 px-1 text-[12px]",
                tab === option.id
                  ? "border-b-[var(--color-accent)] font-extrabold"
                  : "border-b-transparent opacity-55",
              )}
            >
              {option.label}
            </button>
          ))}
        </nav>
      ) : null}

      {events.length === 0 && tab !== "settings" ? (
        referee ? (
          <div className="px-4 py-5">
            <Alert kind="info">
              Nothing to score yet — the organiser has not added a category.
            </Alert>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-4 py-5">
            <Alert kind="info">
              Add a category first — Men&apos;s Singles, U-17 Doubles, whatever your event needs.
              Each one carries its own scoring rules and its own draw.
            </Alert>
            <EventForm
              tournamentId={tournament._id}
              token={token}
              event={null}
              onDone={() => setShowEventForm(false)}
            />
          </div>
        )
      ) : (
        <div>
          {tab !== "settings" && tab !== "categories" && tab !== "schedule" ? (
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
                <Button
                  variant="secondary"
                  className="min-h-10 text-[12px]"
                  onClick={() => setScoringMatch(match)}
                >
                  Score this match
                </Button>
              )}
            />
          ) : null}

          {tab === "entrants" && activeEvent ? (
            <EntryManager event={activeEvent} entries={eventEntries} token={token} />
          ) : null}

          {tab === "draw" && activeEvent ? (
            <DrawPanel
              event={activeEvent}
              playingCount={eventEntries.filter((entry) => !entry.withdrawn).length}
              matches={eventMatches}
              entries={entryMap}
              matchMinutes={matchMinutes}
              token={token}
            />
          ) : null}

          {tab === "schedule" ? (
            <SchedulePanel
              tournamentId={tournament._id}
              startDate={tournament.startDate}
              schedule={tournament.schedule}
              token={token}
              matches={matches}
              events={events}
              entries={entryMap}
            />
          ) : null}

          {tab === "categories" ? (
            <div className="flex flex-col gap-4 pt-4">
              {showEventForm || editingEvent ? (
                <EventForm
                  tournamentId={tournament._id}
                  token={token}
                  event={editingEvent}
                  onDone={() => {
                    setShowEventForm(false);
                    setEditingEvent(null);
                  }}
                />
              ) : (
                <div className="px-4">
                  <Button block className="min-h-12" onClick={() => setShowEventForm(true)}>
                    Add a category
                  </Button>
                </div>
              )}
              <CategoryList
                events={events}
                token={token}
                onEdit={(event) => {
                  setEditingEvent(event);
                  setShowEventForm(false);
                }}
              />
            </div>
          ) : null}

          {tab === "settings" ? (
            <TournamentSettings tournament={tournament} token={token} onReissued={setToken} />
          ) : null}
        </div>
      )}

      {openMatch && openEvent && openScoring ? (
        <ScoreDialog
          match={openMatch}
          event={openEvent}
          scoring={openScoring}
          entries={entryMap}
          token={token}
          onClose={() => setScoringMatch(null)}
        />
      ) : null}
    </div>
  );
}
