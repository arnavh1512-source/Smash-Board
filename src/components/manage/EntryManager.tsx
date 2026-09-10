"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Alert, Badge, Button, Card, Field, Input, Textarea, cx } from "@/components/ui";
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
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
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

      <Field label="Phone (optional)">
        <Input
          type="tel"
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
        />
      </Field>

      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
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
    <form onSubmit={submit} className="space-y-3">
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
      <Button type="submit" disabled={busy || text.trim() === ""}>
        {busy ? "Adding…" : "Add all"}
      </Button>
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
      <li className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="mt-3 flex gap-2">
          <Button
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
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li
      className={cx(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white p-3",
        entry.withdrawn && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">
          {entry.seed > 0 ? <span className="mr-1 text-xs text-slate-400">[{entry.seed}]</span> : null}
          {entryName(entry)}
          {entry.withdrawn ? (
            <span className="ml-2">
              <Badge tone="rose">Withdrawn</Badge>
            </span>
          ) : null}
        </p>
        {entry.club ? <p className="truncate text-xs text-slate-500">{entry.club}</p> : null}
      </div>

      <label className="flex items-center gap-1 text-xs text-slate-600">
        Seed
        <Input
          type="number"
          min={0}
          max={64}
          defaultValue={entry.seed}
          className="w-16 px-2 py-1"
          onBlur={(e) => {
            const seed = Number(e.target.value);
            if (seed !== entry.seed) void run(() => update({ entryId: entry._id, pin, seed }));
          }}
        />
      </label>

      <Button
        variant="ghost"
        className="px-2 py-1"
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
        className="px-2 py-1"
        onClick={() => run(() => update({ entryId: entry._id, pin, withdrawn: !entry.withdrawn }))}
      >
        {entry.withdrawn ? "Reinstate" : "Withdraw"}
      </Button>
      <Button
        variant="danger"
        className="px-2 py-1"
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
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-tight">
          Entrants <span className="text-slate-400">({active} playing / {entries.length} listed)</span>
        </h3>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(["one", "bulk"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setMode(option)}
              className={cx(
                "rounded-md px-3 py-1 font-medium transition",
                mode === option ? "bg-white text-slate-900 shadow-sm" : "text-slate-600",
              )}
            >
              {option === "one" ? "One at a time" : "Paste a list"}
            </button>
          ))}
        </div>
      </div>

      {event.drawGeneratedAt ? (
        <div className="mt-3">
          <Alert kind="info">
            The draw is already made. New or removed entrants only appear once you generate the draw
            again.
          </Alert>
        </div>
      ) : null}

      <div className="mt-4">
        {mode === "one" ? (
          <AddEntryForm event={event} pin={pin} onError={setError} />
        ) : (
          <BulkAddForm eventId={event._id} pin={pin} onError={setError} />
        )}
      </div>

      {error ? (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
          No entrants yet.
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
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
    </Card>
  );
}
