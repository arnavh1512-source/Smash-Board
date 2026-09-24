"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { EntryLookup } from "@/components/tournament/MatchRow";
import { Alert, Badge, Button, Field, Input, Sheet, cx } from "@/components/ui";
import { scoringSummary, sideName, STATUS_LABELS } from "@/lib/display";
import { errorMessage } from "@/lib/errors";
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
  startDate,
  endDate,
  onClose,
}: {
  match: Doc<"matches">;
  event: Doc<"events">;
  /** The rules this match is played to, which may differ from the category's. */
  scoring: ScoringConfig;
  entries: EntryLookup;
  token: string;
  /** The tournament's dates, which bound the time picker as the server does. */
  startDate?: string;
  endDate?: string;
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
  const [confirmReset, setConfirmReset] = useState(false);

  const aEntry = match.aId ? entries.get(match.aId) : undefined;
  const bEntry = match.bId ? entries.get(match.bId) : undefined;
  const aName = sideName(aEntry, match.aLabel);
  const bName = sideName(bEntry, match.bLabel);
  const bothDecided = Boolean(match.aId && match.bId);
  // The same question the server asks before it refuses a walkover, so the
  // buttons go quiet instead of throwing an error the organiser has to read.
  const played = hasPlayedResult(match);
  /**
   * Three different jobs wear the same dialog, and they are not equally
   * reversible. Picking up a match mid-game is ordinary work. Rewriting a
   * result that has already been published is not: the winner may already have
   * been moved into the next round, and saving will move somebody else there
   * instead. So the dialog says which of the three the organiser is doing
   * before they touch anything.
   */
  const decided = match.status === "completed" || match.status === "walkover";
  const inProgress = !decided && match.sets.length > 0;
  const heading = decided
    ? "Correct the score"
    : inProgress
      ? "Continue scoring"
      : "Enter the score";

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
  const current = sets[sets.length - 1];

  return (
    <Sheet label={heading} onClose={onClose}>
      <header className="rule-b2 flex items-start gap-3 bg-[var(--color-surface)] px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h6 className="m-0">{heading}</h6>
          <p className="m-0 mt-1 truncate text-[11px] text-muted">
            {event.name} · {scoringSummary(scoring)}
          </p>
        </div>
        <Button variant="ghost" className="text-[12px]" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        {decided ? (
          <Alert kind="warning">
            <strong>This match already has a result.</strong> Saving replaces it. Whoever the
            change makes the winner is carried into the next round, and anybody the old result
            had sent through is taken back out of it.
          </Alert>
        ) : null}

        {!bothDecided ? (
          <Alert kind="info">
            Both sides must be decided before a score can be entered. Finish the earlier matches
            first.
          </Alert>
        ) : null}

        {/* Each side gets half the width and a thumb-sized target, so a scorer
            watching the rally can tap without looking down for long. */}
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { side: "a" as const, name: aName },
              { side: "b" as const, name: bName },
            ]
          ).map(({ side, name }) => (
            <div key={side} className="flex min-w-0 flex-col gap-2">
              <p className="m-0 break-words text-[14px] font-extrabold leading-tight">{name}</p>
              <p
                className="num m-0 text-[48px] font-extrabold leading-none"
                aria-label={`${name}: ${current[side]} in set ${sets.length}`}
              >
                {current[side]}
              </p>
              <Button
                block
                className="min-h-16 justify-center text-[20px]"
                disabled={!bothDecided}
                onClick={() => tapPoint(side)}
                aria-label={`Add a point for ${name}`}
              >
                +1
              </Button>
              <Button
                variant="ghost"
                className="self-start text-[12px]"
                disabled={!bothDecided}
                onClick={() => undoPoint(side)}
                aria-label={`Take a point back from ${name}`}
              >
                Undo
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
              <div key={index} className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0 text-[11px] uppercase tracking-[0.08em] text-muted">
                  Set {index + 1}
                </span>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  inputMode="numeric"
                  value={set.a}
                  onChange={(e) => editSet(index, "a", e.target.value)}
                  className={cx("num w-20 min-h-11", decided === "a" && "font-extrabold")}
                  aria-label={`${aName} score in set ${index + 1}`}
                />
                <span className="text-muted">–</span>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  inputMode="numeric"
                  value={set.b}
                  onChange={(e) => editSet(index, "b", e.target.value)}
                  className={cx("num w-20 min-h-11", decided === "b" && "font-extrabold")}
                  aria-label={`${bName} score in set ${index + 1}`}
                />
                {sets.length > 1 ? (
                  <Button
                    variant="ghost"
                    className="btn-icon"
                    onClick={() => setSets(sets.filter((_, i) => i !== index))}
                    aria-label={`Remove set ${index + 1}`}
                  >
                    ✕
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
          <p className="m-0 text-[12px] text-muted">{outcomeLabel(cleanSets(), scoring)}</p>
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
            {busy ? "Saving…" : decided ? "Save correction" : "Save score"}
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
          <summary className="flex min-h-11 cursor-pointer items-center text-[12px] uppercase tracking-[0.08em]">
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
                min={startDate ? `${startDate}T00:00` : undefined}
                max={endDate ? `${endDate}T23:59` : undefined}
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
            <p className="m-0 mt-1 text-[12px] text-muted">
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
            {confirmReset ? (
              <div className="flex flex-col gap-2">
                <Alert kind="warning">
                  Clear this match back to scheduled? Its score will be lost.
                </Alert>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    className="min-h-12"
                    disabled={busy}
                    onClick={() => run(() => resetMatch({ matchId: match._id, token }), true)}
                  >
                    Yes, clear it
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-12"
                    disabled={busy}
                    onClick={() => setConfirmReset(false)}
                  >
                    Keep the score
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="danger"
                className="min-h-12"
                disabled={busy}
                onClick={() => setConfirmReset(true)}
              >
                Reset this match
              </Button>
            )}
          </div>
        </details>

        <p className="m-0 flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-muted">
          Status now
          <Badge tone="neutral">{STATUS_LABELS[match.status] ?? match.status}</Badge>
        </p>
      </div>
    </Sheet>
  );
}
