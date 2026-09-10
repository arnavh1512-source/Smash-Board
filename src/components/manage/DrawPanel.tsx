"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Alert, Button, Card } from "@/components/ui";
import { errorMessage } from "@/lib/usePin";

/** Generate or clear the draw for one category. Both actions are confirmed. */
export function DrawPanel({
  event,
  playingCount,
  hasMatches,
  pin,
}: {
  event: Doc<"events">;
  playingCount: number;
  hasMatches: boolean;
  pin: string;
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

  const regenerating = hasMatches;

  return (
    <Card>
      <h3 className="text-lg font-semibold tracking-tight">Draw</h3>
      <p className="mt-1 text-sm text-slate-600">
        {playingCount} entrant{playingCount === 1 ? "" : "s"} are available for the draw. Withdrawn
        entrants are left out.
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={randomise}
          onChange={(e) => setRandomise(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-400"
        />
        Shuffle the unseeded entrants (seeds stay in their standard positions)
      </label>

      {error ? (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3">
          <Alert kind="success">{notice}</Alert>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy || playingCount < 2}
          onClick={() =>
            run(async () => {
              const outcome = await generate({ eventId: event._id, pin, randomise });
              setNotice(`Draw made: ${outcome.matches} matches.`);
            }, regenerating
              ? "Generating the draw again deletes every match and score in this category. Continue?"
              : "Generate the draw for this category?")
          }
        >
          {busy ? "Working…" : regenerating ? "Generate again" : "Generate draw"}
        </Button>

        {hasMatches ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await clear({ eventId: event._id, pin });
                setNotice("Draw cleared.");
              }, "Clear the draw? Every match and score in this category will be deleted.")
            }
          >
            Clear draw
          </Button>
        ) : null}
      </div>

      {playingCount < 2 ? (
        <p className="mt-3 text-sm text-slate-500">Add at least two entrants to make a draw.</p>
      ) : null}
    </Card>
  );
}
