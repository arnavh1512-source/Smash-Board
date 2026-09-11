"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Alert, Button, Checkbox, Section } from "@/components/ui";
import { OrderOfPlay } from "@/components/tournament/OrderOfPlay";
import type { EntryLookup } from "@/components/tournament/MatchRow";
import { errorMessage } from "@/lib/useSession";

/** Generate or clear the draw for one category, and show when it is on court. */
export function DrawPanel({
  event,
  playingCount,
  matches,
  entries,
  matchMinutes,
  token,
}: {
  event: Doc<"events">;
  playingCount: number;
  /** This category's matches, so the draw can show its timings. */
  matches: readonly Doc<"matches">[];
  entries: EntryLookup;
  matchMinutes: number;
  token: string;
}) {
  const generate = useMutation(api.draws.generate);
  const clear = useMutation(api.draws.clear);
  const [randomise, setRandomise] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
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

  const hasMatches = matches.length > 0;
  const timed = matches.some((match) => match.scheduledAt !== undefined);

  return (
    <div>
      <Section>
        <h6 className="m-0">Draw</h6>
        <p className="m-0 text-[13px] opacity-70">
          {playingCount} entrant{playingCount === 1 ? "" : "s"} are available for the draw. Withdrawn
          entrants are left out.
        </p>

        <Checkbox
          checked={randomise}
          onChange={(e) => setRandomise(e.target.checked)}
          label="Shuffle the unseeded entrants (seeds stay in their standard positions)"
        />

        {error ? <Alert kind="error">{error}</Alert> : null}
        {notice ? <Alert kind="success">{notice}</Alert> : null}
        {playingCount < 2 ? (
          <Alert kind="info">Add at least two entrants to make a draw.</Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-12"
            disabled={busy || playingCount < 2}
            onClick={() =>
              run(
                async () => {
                  const outcome = await generate({ eventId: event._id, token, randomise });
                  setNotice(`Draw made: ${outcome.matches} matches.`);
                },
                hasMatches
                  ? "Generating the draw again deletes every match and score in this category. Continue?"
                  : "Generate the draw for this category?",
              )
            }
          >
            {busy ? "Working…" : hasMatches ? "Generate again" : "Generate draw"}
          </Button>

          {hasMatches ? (
            <Button
              variant="ghost"
              className="min-h-12"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await clear({ eventId: event._id, token });
                  setNotice("Draw cleared.");
                }, "Clear the draw? Every match and score in this category will be deleted.")
              }
            >
              Clear draw
            </Button>
          ) : null}
        </div>

        {hasMatches && !timed ? (
          <Alert kind="info">
            No timings yet. Plan the order of play from the Schedule tab and every match here gets a
            court and a start time.
          </Alert>
        ) : null}
      </Section>

      {timed ? (
        <OrderOfPlay
          matches={matches}
          events={[event]}
          entries={entries}
          matchMinutes={matchMinutes}
        />
      ) : null}
    </div>
  );
}
