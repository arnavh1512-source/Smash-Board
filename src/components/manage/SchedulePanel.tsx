"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Alert, Button, Field, Input, Section, cx } from "@/components/ui";
import { CourtGrid } from "@/components/tournament/CourtGrid";
import { OrderOfPlay } from "@/components/tournament/OrderOfPlay";
import { StaleScheduleNotice } from "@/components/tournament/StaleScheduleNotice";
import type { EntryLookup } from "@/components/tournament/MatchRow";
import {
  DEFAULT_SCHEDULE,
  clockOf,
  dayCapacity,
  dayOf,
  dayWindowMinutes,
  formatClock,
} from "@/lib/schedule";
import { errorMessage } from "@/lib/useSession";

interface ScheduleSettings {
  dayStart: string;
  dayEnd: string;
  matchMinutes: number;
  restMinutes: number;
  courts: number;
  categoriesAtOnce: number;
}

/**
 * "9:00 AM to 9:00 PM fits 48 matches a day on 2 courts", or the reason the
 * hours given cannot hold a match. Read live off the form, so the organiser
 * sees what a later finish or another court buys before planning anything.
 */
function daySummary(draft: ScheduleSettings): { ok: boolean; text: string } | null {
  if (!draft.dayStart || !draft.dayEnd) return null;
  let window: number;
  try {
    window = dayWindowMinutes(draft.dayStart, draft.dayEnd);
  } catch (caught) {
    return { ok: false, text: errorMessage(caught) };
  }
  const fits = dayCapacity(window, draft.matchMinutes, draft.courts);
  if (fits === 0) {
    return { ok: false, text: "The day is shorter than one match." };
  }
  return {
    ok: true,
    text: `${formatClock(draft.dayStart)} to ${formatClock(draft.dayEnd)} fits up to ${fits} ${
      fits === 1 ? "match" : "matches"
    } a day on ${draft.courts} ${draft.courts === 1 ? "court" : "courts"}. Rest between a player's matches can lower that; a match that would run past the finish moves to the next morning.`,
  };
}

/**
 * Planning the order of play.
 *
 * The organiser sets the hours of the day and five numbers; the server lays every category out on the
 * available courts so that no player goes back on before their rest is up and
 * the hall never holds more categories than it can seat, then writes the
 * resulting times onto the matches.
 */
export function SchedulePanel({
  tournamentId,
  startDate,
  schedule,
  token,
  matches,
  events,
  entries,
}: {
  tournamentId: Id<"tournaments">;
  startDate?: string;
  schedule?: {
    dayStart: string;
    dayEnd?: string;
    matchMinutes: number;
    restMinutes: number;
    courts: number;
    categoriesAtOnce?: number;
  };
  token: string;
  matches: readonly Doc<"matches">[];
  events: readonly Doc<"events">[];
  entries: EntryLookup;
}) {
  const generate = useMutation(api.schedule.generate);
  const clear = useMutation(api.schedule.clear);
  const [draft, setDraft] = useState<ScheduleSettings>({
    dayStart: schedule?.dayStart ?? DEFAULT_SCHEDULE.dayStart,
    dayEnd: schedule?.dayEnd ?? DEFAULT_SCHEDULE.dayEnd,
    matchMinutes: schedule?.matchMinutes ?? DEFAULT_SCHEDULE.matchMinutes,
    restMinutes: schedule?.restMinutes ?? DEFAULT_SCHEDULE.restMinutes,
    courts: schedule?.courts ?? DEFAULT_SCHEDULE.courts,
    categoriesAtOnce: schedule?.categoriesAtOnce ?? DEFAULT_SCHEDULE.categoriesAtOnce,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"time" | "court">("time");

  const planned = matches.some((match) => match.scheduledAt !== undefined);
  const capacity = daySummary(draft);
  const minutes = schedule?.matchMinutes ?? draft.matchMinutes;

  async function run(action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Section>
        <h6 className="m-0">Order of play</h6>
        <p className="m-0 text-[13px] text-muted">
          Every category is laid out on one timetable. Each player is guaranteed their rest between
          matches, and another category fills the court while they take it.
        </p>

        {!startDate ? (
          <Alert kind="info">
            Set the tournament start date in Setup before planning the order of play.
          </Alert>
        ) : null}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="First match at">
            <Input
              type="time"
              value={draft.dayStart}
              onChange={(e) => setDraft({ ...draft, dayStart: e.target.value })}
            />
          </Field>
          <Field label="Last match ends by" hint="Nothing is booked to run past this.">
            <Input
              type="time"
              value={draft.dayEnd}
              onChange={(e) => setDraft({ ...draft, dayEnd: e.target.value })}
            />
          </Field>
          <Field label="Courts" hint="How many run at the same time.">
            <Input
              type="number"
              min={1}
              max={24}
              value={draft.courts}
              onChange={(e) => setDraft({ ...draft, courts: Number(e.target.value) })}
            />
          </Field>
          <Field label="Minutes per match" hint="Court time including the knock-up.">
            <Input
              type="number"
              min={5}
              max={240}
              value={draft.matchMinutes}
              onChange={(e) => setDraft({ ...draft, matchMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Rest between matches" hint="Minimum break every player gets.">
            <Input
              type="number"
              min={0}
              max={480}
              value={draft.restMinutes}
              onChange={(e) => setDraft({ ...draft, restMinutes: Number(e.target.value) })}
            />
          </Field>
          <Field
            label="Categories at once"
            hint="Keeps the hall from filling up. The rest wait their turn, so the day runs longer."
          >
            <Input
              type="number"
              min={1}
              max={24}
              value={draft.categoriesAtOnce}
              onChange={(e) => setDraft({ ...draft, categoriesAtOnce: Number(e.target.value) })}
            />
          </Field>
        </div>

        {capacity?.ok ? (
          <p data-testid="day-capacity" className="m-0 text-[12px] text-muted">
            {capacity.text}
          </p>
        ) : capacity ? (
          <Alert kind="warning">{capacity.text}</Alert>
        ) : null}

        {planned ? <StaleScheduleNotice tournamentId={tournamentId} audience="organiser" /> : null}

        {error ? <Alert kind="error">{error}</Alert> : null}
        {notice ? <Alert kind="success">{notice}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-12"
            disabled={busy || !startDate}
            onClick={() =>
              run(async () => {
                const outcome = await generate({ tournamentId, token, ...draft });
                setNotice(
                  `${outcome.scheduled} matches timetabled. Last match ends at ${clockOf(
                    outcome.lastFinish,
                  )} on ${dayOf(outcome.lastFinish)}. At the busiest moment ${
                    outcome.peakInHall
                  } players are in the hall.`,
                );
              })
            }
          >
            {busy ? "Planning…" : planned ? "Plan again" : "Plan the order of play"}
          </Button>
          {planned ? (
            <Button
              variant="ghost"
              className="min-h-12"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!window.confirm("Clear every match time and court?")) return;
                  await clear({ tournamentId, token });
                  setNotice("Timings cleared.");
                })
              }
            >
              Clear timings
            </Button>
          ) : null}
        </div>
      </Section>

      {planned ? (
        <nav className="rule-b2 flex">
          {(["time", "court"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={cx(
                "btn min-h-11 flex-1 justify-center border-0 border-b-2 text-[12px]",
                view === option
                  ? "border-b-[var(--color-accent)] font-extrabold"
                  : "border-b-transparent text-muted hover:border-b-[var(--color-divider)]",
              )}
            >
              {option === "time" ? "In time order" : "Court by court"}
            </button>
          ))}
        </nav>
      ) : null}

      {view === "court" ? (
        <CourtGrid matches={matches} events={events} entries={entries} matchMinutes={minutes} />
      ) : (
        <OrderOfPlay
          matches={matches}
          events={events}
          entries={entries}
          matchMinutes={minutes}
        />
      )}
    </div>
  );
}
