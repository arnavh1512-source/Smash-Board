"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Alert, Badge, Button, Field, Input, Section, Textarea, cx } from "@/components/ui";
import { errorMessage } from "@/lib/useSession";
import { entryName } from "@/lib/display";
import { duplicatePeople } from "@/lib/identity";

/** The paste box explains itself differently for a pair than for one player. */
function bulkHint(teamSize: number): string {
  return teamSize === 2
    ? "One pair per line, both names separated by a slash: Anita Rao / Priya Shah"
    : "One entrant per line. This is a singles category, so a line with two names is skipped.";
}

const BULK_PLACEHOLDER: Record<number, string> = {
  1: "Rohan Mehta\nAnita Rao\nDev Patel",
  2: "Anita Rao / Priya Shah\nRohan Mehta / Dev Patel",
};

function AddEntryForm({
  event,
  token,
  onError,
}: {
  event: Doc<"events">;
  token: string;
  onError: (message: string | null) => void;
}) {
  const add = useMutation(api.entries.add);
  const [playerOne, setPlayerOne] = useState("");
  const [playerTwo, setPlayerTwo] = useState("");
  const [club, setClub] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    onError(null);
    setBusy(true);
    try {
      await add({
        eventId: event._id,
        token,
        playerOne,
        playerTwo: event.teamSize === 2 ? playerTwo : undefined,
        club: club || undefined,
        phone: phone || undefined,
      });
      setPlayerOne("");
      setPlayerTwo("");
      setClub("");
      setPhone("");
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
      <Field label={event.teamSize === 2 ? "Player one" : "Player name"}>
        <Input
          required
          maxLength={80}
          value={playerOne}
          onChange={(e) => setPlayerOne(e.target.value)}
          placeholder="Rohan Mehta"
        />
      </Field>

      {event.teamSize === 2 ? (
        <Field label="Player two">
          <Input
            required
            maxLength={80}
            value={playerTwo}
            onChange={(e) => setPlayerTwo(e.target.value)}
            placeholder="Kabir Shah"
          />
        </Field>
      ) : null}

      <Field label="Club or city (optional)">
        <Input maxLength={60} value={club} onChange={(e) => setClub(e.target.value)} />
      </Field>

      <Field label="Phone (optional)" hint="Private. Never shown on the public scoreboard.">
        <Input
          type="tel"
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
        />
      </Field>

      <div className="sm:col-span-2">
        <Button type="submit" className="min-h-12" disabled={busy}>
          {busy ? "Adding…" : "Add entrant"}
        </Button>
      </div>
    </form>
  );
}

function BulkAddForm({
  eventId,
  teamSize,
  token,
  onError,
}: {
  eventId: Id<"events">;
  teamSize: number;
  token: string;
  onError: (message: string | null) => void;
}) {
  const addMany = useMutation(api.entries.addMany);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ added: number; skipped: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    onError(null);
    setResult(null);
    setBusy(true);
    try {
      const outcome = await addMany({ eventId, token, text });
      setResult(outcome);
      if (outcome.skipped.length === 0) setText("");
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <Field label="Paste a list" hint={bulkHint(teamSize)}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={BULK_PLACEHOLDER[teamSize] ?? BULK_PLACEHOLDER[1]}
        />
      </Field>
      {result ? (
        <Alert kind={result.skipped.length > 0 ? "info" : "success"}>
          Added {result.added} entrant{result.added === 1 ? "" : "s"}.
          {result.skipped.length > 0
            ? ` Skipped ${result.skipped.length}: ${result.skipped.slice(0, 5).join(", ")}${
                result.skipped.length > 5 ? "…" : ""
              }`
            : ""}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" className="min-h-12" disabled={busy || text.trim() === ""}>
          {busy ? "Adding…" : "Add all"}
        </Button>
      </div>
    </form>
  );
}

function EntryRow({
  entry,
  teamSize,
  drawExists,
  token,
  onError,
}: {
  entry: Doc<"entries">;
  teamSize: number;
  /** Once the draw is made an entrant withdraws; they cannot be deleted. */
  drawExists: boolean;
  token: string;
  onError: (message: string | null) => void;
}) {
  const update = useMutation(api.entries.update);
  const remove = useMutation(api.entries.remove);
  const revealContact = useMutation(api.entries.revealContact);
  const [editing, setEditing] = useState(false);
  const [playerOne, setPlayerOne] = useState(entry.playerOne);
  const [playerTwo, setPlayerTwo] = useState(entry.playerTwo ?? "");
  const [club, setClub] = useState(entry.club ?? "");
  // Phone numbers never travel with the public entry list, so the editor asks
  // the server for this one entrant's number behind the organiser PIN.
  const [phone, setPhone] = useState("");

  async function run(action: () => Promise<unknown>) {
    onError(null);
    try {
      await action();
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  if (editing) {
    return (
      <li className="rule-b bg-[var(--color-surface)] px-4 py-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={teamSize === 2 ? "Player one" : "Player name"}>
            <Input value={playerOne} onChange={(e) => setPlayerOne(e.target.value)} maxLength={80} />
          </Field>
          {teamSize === 2 ? (
            <Field label="Player two">
              <Input value={playerTwo} onChange={(e) => setPlayerTwo(e.target.value)} maxLength={80} />
            </Field>
          ) : null}
          <Field label="Club or city">
            <Input value={club} onChange={(e) => setClub(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Phone" hint="Private. Never shown on the public scoreboard.">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            onClick={async () => {
              await run(async () => {
                await update({
                  entryId: entry._id,
                  token,
                  playerOne,
                  playerTwo: teamSize === 2 ? playerTwo : "",
                  club,
                  phone,
                });
                setEditing(false);
              });
            }}
          >
            Save
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li
      className={cx(
        "rule-b flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
        entry.withdrawn && "opacity-55",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[14px] font-extrabold leading-tight">
          {entry.seed > 0 ? <span className="mr-1 text-[11px] opacity-50">[{entry.seed}]</span> : null}
          {entryName(entry)}
          {teamSize === 2 && !entry.playerTwo ? (
            <span className="ml-2">
              <Badge tone="accent">Partner missing</Badge>
            </span>
          ) : null}
          {entry.withdrawn ? (
            <span className="ml-2">
              <Badge tone="outline">Withdrawn</Badge>
            </span>
          ) : null}
        </p>
        {entry.club ? <p className="m-0 truncate text-[11px] opacity-55">{entry.club}</p> : null}
      </div>

      <label
        className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] opacity-70"
        title={
          drawExists
            ? "The draw has already been made, so seeds are fixed. Clear the draw to reseed."
            : undefined
        }
      >
        Seed
        <Input
          type="number"
          min={0}
          max={64}
          disabled={drawExists}
          defaultValue={entry.seed}
          className="w-16 min-h-10 px-2 py-1"
          onBlur={(e) => {
            const seed = Number(e.target.value);
            if (seed !== entry.seed) void run(() => update({ entryId: entry._id, token, seed }));
          }}
        />
      </label>

      <Button
        variant="ghost"
        className="min-h-10"
        onClick={async () => {
          await run(async () => {
            setPhone((await revealContact({ entryId: entry._id, token })) ?? "");
            setEditing(true);
          });
        }}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        className="min-h-10"
        disabled={drawExists && entry.withdrawn}
        onClick={() => {
          if (
            !entry.withdrawn &&
            drawExists &&
            !window.confirm(
              `Withdraw ${entryName(entry)}? Their remaining matches will be awarded to their opponents.`,
            )
          ) {
            return;
          }
          void run(() => update({ entryId: entry._id, token, withdrawn: !entry.withdrawn }));
        }}
      >
        {entry.withdrawn ? "Reinstate" : "Withdraw"}
      </Button>
      {drawExists ? null : (
        <Button
          variant="ghost"
          className="min-h-10 opacity-70"
          onClick={() => {
            if (!window.confirm(`Remove ${entryName(entry)} from this category?`)) return;
            void run(() => remove({ entryId: entry._id, token }));
          }}
        >
          Remove
        </Button>
      )}
    </li>
  );
}

/** Add, edit, seed, withdraw and remove the entrants of one category. */
export function EntryManager({
  event,
  entries,
  token,
}: {
  event: Doc<"events">;
  entries: Doc<"entries">[];
  token: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"one" | "bulk">("one");
  const active = entries.filter((entry) => !entry.withdrawn).length;
  // Two entrants of one category under the same name: either somebody has been
  // entered twice, or two different players share a name. Both need sorting out
  // before the draw, because everything downstream — the order of play above
  // all — treats one name as one human being.
  const clashes = duplicatePeople(entries.filter((entry) => !entry.withdrawn));

  return (
    <div>
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h6 className="m-0">Entrants</h6>
          <span className="num text-[11px] opacity-55">
            {active} playing / {entries.length} listed
          </span>
        </div>

        <div className="flex">
          {(["one", "bulk"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={cx(
                "btn min-h-11 flex-1 justify-center border-0 border-b-2 text-[12px]",
                mode === option
                  ? "border-b-[var(--color-accent)] font-extrabold"
                  : "border-b-[var(--color-divider)] opacity-55",
              )}
            >
              {option === "one" ? "One at a time" : "Paste a list"}
            </button>
          ))}
        </div>

        {clashes.length > 0 ? (
          <Alert kind="warning">
            <strong>The same name is entered more than once.</strong>{" "}
            {clashes
              .map((clash) => `${clash.spellings.join(" / ")} (${clash.count} entrants)`)
              .join(", ")}
            . The app reads one name as one player, so these entrants are treated as the same
            person and will never be put on court at the same time. If they really are different
            people, tell them apart — add an initial or a club — before the draw is made.
          </Alert>
        ) : null}

        {event.drawGeneratedAt ? (
          <Alert kind="info">
            The draw is already made, so entrants can no longer be deleted — withdraw them instead
            and their remaining matches are awarded to their opponents. A new entrant only appears
            once you generate the draw again. Seeds are fixed too — the bracket was built from the
            seeds as they stood and does not rearrange itself, so reseeding means drawing again.
          </Alert>
        ) : null}

        {mode === "one" ? (
          <AddEntryForm event={event} token={token} onError={setError} />
        ) : (
          <BulkAddForm
            eventId={event._id}
            teamSize={event.teamSize}
            token={token}
            onError={setError}
          />
        )}

        {error ? <Alert kind="error">{error}</Alert> : null}
      </Section>

      {entries.length === 0 ? (
        <p className="note m-4">No entrants yet.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {entries.map((entry) => (
            <EntryRow
              key={entry._id}
              entry={entry}
              teamSize={event.teamSize}
              drawExists={event.drawGeneratedAt !== null}
              token={token}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
