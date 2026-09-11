"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Alert, Button, Field, Input, Section, cx } from "@/components/ui";
import { CourtGrid } from "@/components/tournament/CourtGrid";
import { OrderOfPlay } from "@/components/tournament/OrderOfPlay";
import type { EntryLookup } from "@/components/tournament/MatchRow";
import { DEFAULT_SCHEDULE, clockOf, dayOf } from "@/lib/schedule";
import { errorMessage } from "@/lib/usePin";

interface ScheduleSettings {
  dayStart: string;
  matchMinutes: number;
  restMinutes: number;
  courts: number;
}

/**
 * Planning the order of play.
 *
 * The organiser sets four numbers; the server lays every category out on the
 * available courts so that no player goes back on before their rest is up, and
 * writes the resulting times onto the matches.
 */
export function SchedulePanel({
  tournamentId,
  startDate,
  schedule,
  pin,
  matches,
  events,
  entries,
}: {
  tournamentId: Id<"tournaments">;
  startDate?: string;
  schedule?: { dayStart: string; matchMinutes: number; restMinutes: number; courts: number };
  pin: string;
  matches: readonly Doc<"matches">[];
  events: readonly Doc<"events">[];
  entries: EntryLookup;
}) {
  const generate = useMutation(api.schedule.generate);
  const clear = useMutation(api.schedule.clear);
  const [draft, setDraft] = useState<ScheduleSettings>({
    dayStart: schedule?.dayStart ?? DEFAULT_SCHEDULE.dayStart,
    matchMinutes: schedule?.matchMinutes ?? DEFAULT_SCHEDULE.matchMinutes,
    restMinutes: schedule?.restMinutes ?? DEFAULT_SCHEDULE.restMinutes,
    courts: schedule?.courts ?? DEFAULT_SCHEDULE.courts,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"time" | "court">("time");

  const planned = matches.some((match) => match.scheduledAt !== undefined);
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
        <p className="m-0 text-[13px] opacity-70">
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
        </div>

        {error ? <Alert kind="error">{error}</Alert> : null}
        {notice ? <Alert kind="success">{notice}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-12"
            disabled={busy || !startDate}
            onClick={() =>
              run(async () => {
                const outcome = await generate({ tournamentId, pin, ...draft });
                setNotice(
                  `${outcome.scheduled} matches timetabled. Last match ends at ${clockOf(
                    outcome.lastFinish,
                  )} on ${dayOf(outcome.lastFinish)}.`,
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
                  await clear({ tournamentId, pin });
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
                  : "border-b-transparent opacity-55",
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
