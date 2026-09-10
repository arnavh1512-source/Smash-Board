"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { EntryLookup } from "@/components/tournament/MatchRow";
import { Alert, Badge, Button, Field, Input, cx } from "@/components/ui";
import { scoringSummary, sideName } from "@/lib/display";
import { errorMessage } from "@/lib/usePin";
import {
  addPoint,
  evaluateMatch,
  ScoringError,
  setsToWin,
  setWinner,
  undoPointForSide,
  type ScoringConfig,
  type SetScore,
  type Side,
} from "@/lib/scoring";

/** Sets padded out to at least one row so the organiser always has a place to type. */
function withBlankRow(sets: SetScore[]): SetScore[] {
  return sets.length === 0 ? [{ a: 0, b: 0 }] : sets;
}

function outcomeLabel(sets: SetScore[], scoring: ScoringConfig): string {
  try {
    const outcome = evaluateMatch(sets, scoring);
    if (outcome.winner) return `Sets ${outcome.setsWon.a}-${outcome.setsWon.b}`;
    return `Sets ${outcome.setsWon.a}-${outcome.setsWon.b}, first to ${setsToWin(scoring)}`;
  } catch (error) {
    return error instanceof ScoringError ? error.message : "Check the scores";
  }
}

/**
 * Everything an organiser can do to one match: tap points in as they are played,
 * type a finished score, record a walkover, set the court, or start over.
 */
export function ScoreDialog({
  match,
  event,
  entries,
  pin,
  onClose,
}: {
  match: Doc<"matches">;
  event: Doc<"events">;
  entries: EntryLookup;
  pin: string;
  onClose: () => void;
}) {
  const setScore = useMutation(api.matches.setScore);
  const setWalkover = useMutation(api.matches.setWalkover);
  const resetMatch = useMutation(api.matches.reset);
  const setDetails = useMutation(api.matches.setDetails);

  const scoring = event.scoring as ScoringConfig;
  const [sets, setSets] = useState<SetScore[]>(() =>
    withBlankRow(match.sets.map((set) => ({ ...set }))),
  );
  const [court, setCourt] = useState(match.court ?? "");
  const [scheduledAt, setScheduledAt] = useState(match.scheduledAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const aEntry = match.aId ? entries.get(match.aId) : undefined;
  const bEntry = match.bId ? entries.get(match.bId) : undefined;
  const aName = sideName(aEntry, match.aLabel);
  const bName = sideName(bEntry, match.bLabel);
  const bothDecided = Boolean(match.aId && match.bId);

  async function run(action: () => Promise<unknown>, close = false) {
    setError(null);
    setBusy(true);
    try {
      await action();
      if (close) onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  /** Drop trailing 0-0 rows so an untouched blank set is never saved. */
  function cleanSets(): SetScore[] {
    const next = [...sets];
    while (next.length > 0) {
      const last = next[next.length - 1];
      if (last.a === 0 && last.b === 0) next.pop();
      else break;
    }
    return next;
  }

  function tapPoint(side: Side) {
    setError(null);
    try {
      setSets(withBlankRow(addPoint(cleanSets(), side, scoring)));
    } catch (caught) {
      setError(caught instanceof ScoringError ? caught.message : "Could not add that point.");
    }
  }

  function undoPoint(side: Side) {
    setError(null);
    setSets(withBlankRow(undoPointForSide(cleanSets(), side)));
  }

  function editSet(index: number, side: Side, raw: string) {
    const value = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    setSets(sets.map((set, i) => (i === index ? { ...set, [side]: Math.floor(value) } : set)));
  }

  const canAddSet = sets.length < scoring.bestOf;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Enter the score</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {event.name} · {scoringSummary(scoring)}
            </p>
          </div>
          <Button variant="ghost" className="px-2 py-1" onClick={onClose}>
            Close
          </Button>
        </div>

        {!bothDecided ? (
          <div className="mt-4">
            <Alert kind="info">
              Both sides must be decided before a score can be entered. Finish the earlier matches
              first.
            </Alert>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {([
            { side: "a" as const, name: aName },
            { side: "b" as const, name: bName },
          ]).map(({ side, name }) => (
            <div key={side} className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{name}</p>
              <Button
                variant="secondary"
                className="px-2 py-1"
                disabled={!bothDecided}
                onClick={() => undoPoint(side)}
                aria-label={`Remove a point from ${name}`}
              >
                −1
              </Button>
              <Button
                className="px-3 py-1"
                disabled={!bothDecided}
                onClick={() => tapPoint(side)}
                aria-label={`Add a point for ${name}`}
              >
                +1
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sets</p>
          {sets.map((set, index) => {
            const decided = (() => {
              try {
                return setWinner(set, scoring);
              } catch {
                return null;
              }
            })();
            return (
              <div key={index} className="flex items-center gap-2">
                <span className="w-14 text-xs text-slate-500">Set {index + 1}</span>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={set.a}
                  onChange={(e) => editSet(index, "a", e.target.value)}
                  className={cx("w-20 tabular-nums", decided === "a" && "font-bold")}
                  aria-label={`${aName} score in set ${index + 1}`}
                />
                <span className="text-slate-400">–</span>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={set.b}
                  onChange={(e) => editSet(index, "b", e.target.value)}
                  className={cx("w-20 tabular-nums", decided === "b" && "font-bold")}
                  aria-label={`${bName} score in set ${index + 1}`}
                />
                {sets.length > 1 ? (
                  <Button
                    variant="ghost"
                    className="px-2 py-1"
                    onClick={() => setSets(sets.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            );
          })}
          {canAddSet ? (
            <Button
              variant="ghost"
              className="px-2 py-1"
              onClick={() => setSets([...sets, { a: 0, b: 0 }])}
            >
              Add a set
            </Button>
          ) : null}
          <p className="text-xs text-slate-500">{outcomeLabel(cleanSets(), scoring)}</p>
        </div>

        {error ? (
          <div className="mt-4">
            <Alert kind="error">{error}</Alert>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            disabled={busy || !bothDecided}
            onClick={() => run(() => setScore({ matchId: match._id, pin, sets: cleanSets() }), true)}
          >
            {busy ? "Saving…" : "Save score"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !bothDecided}
            onClick={() =>
              run(() => setScore({ matchId: match._id, pin, sets: cleanSets(), markLive: false }))
            }
          >
            Save and keep open
          </Button>
        </div>

        <details className="mt-5 rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Court, time, walkover and reset
          </summary>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Court">
              <Input
                value={court}
                maxLength={40}
                onChange={(e) => setCourt(e.target.value)}
                placeholder="Court 2"
              />
            </Field>
            <Field label="Start time">
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => setDetails({ matchId: match._id, pin, court, scheduledAt }))}
            >
              Save court and time
            </Button>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3">
            <p className="text-sm font-medium text-slate-700">Walkover</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Records a win with no score. Use it when one side does not turn up.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {aEntry ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() => setWalkover({ matchId: match._id, pin, winnerId: aEntry._id }), true)
                  }
                >
                  {aName} wins
                </Button>
              ) : null}
              {bEntry ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() => setWalkover({ matchId: match._id, pin, winnerId: bEntry._id }), true)
                  }
                >
                  {bName} wins
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3">
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Clear this match back to scheduled? Its score will be lost.")) {
                  return;
                }
                void run(() => resetMatch({ matchId: match._id, pin }), true);
              }}
            >
              Reset this match
            </Button>
          </div>
        </details>

        <p className="mt-4 text-xs text-slate-400">
          Status now: <Badge>{match.status}</Badge>
        </p>
      </div>
    </div>
  );
}
