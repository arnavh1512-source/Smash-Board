"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Alert, Badge, Button, Field, Input, Section, Textarea, cx } from "@/components/ui";
import { errorMessage } from "@/lib/usePin";
import { entryName } from "@/lib/display";

const BULK_HINT =
  "One entrant per line. For doubles, separate the two names with a slash: Anita Rao / Priya Shah";

function AddEntryForm({
  event,
  pin,
  onError,
}: {
  event: Doc<"events">;
  pin: string;
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
        pin,
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
  pin,
  onError,
}: {
  eventId: Id<"events">;
  pin: string;
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
      const outcome = await addMany({ eventId, pin, text });
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
      <Field label="Paste a list" hint={BULK_HINT}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Rohan Mehta\nAnita Rao\nDev Patel"}
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
  pin,
  onError,
}: {
  entry: Doc<"entries">;
  teamSize: number;
  pin: string;
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
                  pin,
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
          {entry.withdrawn ? (
            <span className="ml-2">
              <Badge tone="outline">Withdrawn</Badge>
            </span>
          ) : null}
        </p>
        {entry.club ? <p className="m-0 truncate text-[11px] opacity-55">{entry.club}</p> : null}
      </div>

      <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] opacity-70">
        Seed
        <Input
          type="number"
          min={0}
          max={64}
          defaultValue={entry.seed}
          className="w-16 min-h-10 px-2 py-1"
          onBlur={(e) => {
            const seed = Number(e.target.value);
            if (seed !== entry.seed) void run(() => update({ entryId: entry._id, pin, seed }));
          }}
        />
      </label>

      <Button
        variant="ghost"
        className="min-h-10"
        onClick={async () => {
          await run(async () => {
            setPhone((await revealContact({ entryId: entry._id, pin })) ?? "");
            setEditing(true);
          });
        }}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        className="min-h-10"
        onClick={() => run(() => update({ entryId: entry._id, pin, withdrawn: !entry.withdrawn }))}
      >
        {entry.withdrawn ? "Reinstate" : "Withdraw"}
      </Button>
      <Button
        variant="ghost"
        className="min-h-10 opacity-70"
        onClick={() => {
          if (!window.confirm(`Remove ${entryName(entry)} from this category?`)) return;
          void run(() => remove({ entryId: entry._id, pin }));
        }}
      >
        Remove
      </Button>
    </li>
  );
}

/** Add, edit, seed, withdraw and remove the entrants of one category. */
export function EntryManager({
  event,
  entries,
  pin,
}: {
  event: Doc<"events">;
  entries: Doc<"entries">[];
  pin: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"one" | "bulk">("one");
  const active = entries.filter((entry) => !entry.withdrawn).length;

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

        {event.drawGeneratedAt ? (
          <Alert kind="info">
            The draw is already made. New or removed entrants only appear once you generate the draw
            again.
          </Alert>
        ) : null}

        {mode === "one" ? (
          <AddEntryForm event={event} pin={pin} onError={setError} />
        ) : (
          <BulkAddForm eventId={event._id} pin={pin} onError={setError} />
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
              pin={pin}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
