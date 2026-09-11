"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { EntryLookup } from "@/components/tournament/MatchRow";
import { Alert, Badge, Button, Field, Input, cx } from "@/components/ui";
import { scoringSummary, sideName, STATUS_LABELS } from "@/lib/display";
import { errorMessage } from "@/lib/useSession";
import { hasPlayedResult } from "@/lib/results";
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
 * Everything a scorer can do to one match: tap points in as they are played,
 * type a finished score, record a walkover, set the court, or start over.
 */
export function ScoreDialog({
  match,
  event,
  scoring,
  entries,
  token,
  onClose,
}: {
  match: Doc<"matches">;
  event: Doc<"events">;
  /** The rules this match is played to, which may differ from the category's. */
  scoring: ScoringConfig;
  entries: EntryLookup;
  token: string;
  onClose: () => void;
}) {
  const setScore = useMutation(api.matches.setScore);
  const setWalkover = useMutation(api.matches.setWalkover);
  const resetMatch = useMutation(api.matches.reset);
  const setDetails = useMutation(api.matches.setDetails);

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
  // The same question the server asks before it refuses a walkover, so the
  // buttons go quiet instead of throwing an error the organiser has to read.
  const played = hasPlayedResult(match);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enter the score"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_srgb,#201e1d_55%,transparent)] sm:items-center sm:p-4"
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto border border-[var(--color-divider)] bg-[var(--color-bg)]">
        <header className="rule-b2 flex items-start gap-3 bg-[var(--color-surface)] px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h6 className="m-0">Enter the score</h6>
            <p className="m-0 mt-1 truncate text-[11px] opacity-55">
              {event.name} · {scoringSummary(scoring)}
            </p>
          </div>
          <Button variant="ghost" className="min-h-10 text-[12px]" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="flex flex-col gap-4 px-4 py-4">
          {!bothDecided ? (
            <Alert kind="info">
              Both sides must be decided before a score can be entered. Finish the earlier matches
              first.
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            {(
              [
                { side: "a" as const, name: aName },
                { side: "b" as const, name: bName },
              ]
            ).map(({ side, name }) => (
              <div key={side} className="flex items-center gap-2">
                <p className="m-0 min-w-0 flex-1 truncate text-[14px] font-extrabold">{name}</p>
                <Button
                  variant="secondary"
                  className="min-h-12 w-12 justify-center"
                  disabled={!bothDecided}
                  onClick={() => undoPoint(side)}
                  aria-label={`Remove a point from ${name}`}
                >
                  −1
                </Button>
                <Button
                  className="min-h-12 w-12 justify-center"
                  disabled={!bothDecided}
                  onClick={() => tapPoint(side)}
                  aria-label={`Add a point for ${name}`}
                >
                  +1
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 border border-[var(--color-divider)] bg-[var(--color-surface)] p-3.5">
            <p className="field-label m-0">Sets</p>
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
                  <span className="w-14 shrink-0 text-[11px] uppercase tracking-[0.08em] opacity-55">
                    Set {index + 1}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={99}
                    value={set.a}
                    onChange={(e) => editSet(index, "a", e.target.value)}
                    className={cx("num w-20 min-h-11", decided === "a" && "font-extrabold")}
                    aria-label={`${aName} score in set ${index + 1}`}
                  />
                  <span className="opacity-45">–</span>
                  <Input
                    type="number"
                    min={0}
                    max={99}
                    value={set.b}
                    onChange={(e) => editSet(index, "b", e.target.value)}
                    className={cx("num w-20 min-h-11", decided === "b" && "font-extrabold")}
                    aria-label={`${bName} score in set ${index + 1}`}
                  />
                  {sets.length > 1 ? (
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => setSets(sets.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {canAddSet ? (
              <div>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setSets([...sets, { a: 0, b: 0 }])}
                >
                  Add a set
                </Button>
              </div>
            ) : null}
            <p className="m-0 text-[12px] opacity-70">{outcomeLabel(cleanSets(), scoring)}</p>
          </div>

          {error ? <Alert kind="error">{error}</Alert> : null}

          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-12"
              disabled={busy || !bothDecided}
              onClick={() =>
                run(() => setScore({ matchId: match._id, token, sets: cleanSets() }), true)
              }
            >
              {busy ? "Saving…" : "Save score"}
            </Button>
            <Button
              variant="secondary"
              className="min-h-12"
              disabled={busy || !bothDecided}
              onClick={() =>
                run(() => setScore({ matchId: match._id, token, sets: cleanSets(), markLive: false }))
              }
            >
              Save and keep open
            </Button>
          </div>

          <details className="border border-[var(--color-divider)] p-3.5">
            <summary className="cursor-pointer text-[12px] uppercase tracking-[0.08em]">
              Court, time, walkover and reset
            </summary>

            <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
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
            <div className="mt-3.5">
              <Button
                variant="secondary"
                className="min-h-12"
                disabled={busy}
                onClick={() => run(() => setDetails({ matchId: match._id, token, court, scheduledAt }))}
              >
                Save court and time
              </Button>
            </div>

            <div className="rule-t mt-4 pt-3.5">
              <p className="field-label m-0">Walkover</p>
              <p className="m-0 mt-1 text-[12px] opacity-70">
                {played
                  ? "This match already has a result. Reset it below, then award the walkover — a played score is never overwritten in one tap."
                  : "Records a win with no score. Use it when one side does not turn up. It counts as a win and a loss in the group table but adds no sets or points."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {aEntry ? (
                  <Button
                    variant="secondary"
                    className="min-h-12"
                    disabled={busy || played}
                    onClick={() =>
                      run(() => setWalkover({ matchId: match._id, token, winnerId: aEntry._id }), true)
                    }
                  >
                    {aName} wins
                  </Button>
                ) : null}
                {bEntry ? (
                  <Button
                    variant="secondary"
                    className="min-h-12"
                    disabled={busy || played}
                    onClick={() =>
                      run(() => setWalkover({ matchId: match._id, token, winnerId: bEntry._id }), true)
                    }
                  >
                    {bName} wins
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="rule-t mt-4 pt-3.5">
              <Button
                variant="danger"
                className="min-h-12"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Clear this match back to scheduled? Its score will be lost.")) {
                    return;
                  }
                  void run(() => resetMatch({ matchId: match._id, token }), true);
                }}
              >
                Reset this match
              </Button>
            </div>
          </details>

          <p className="m-0 flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] opacity-55">
            Status now
            <Badge tone="neutral">{STATUS_LABELS[match.status] ?? match.status}</Badge>
          </p>
        </div>
      </div>
    </div>
  );
}
