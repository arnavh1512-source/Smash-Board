"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { errorMessage } from "@/lib/usePin";

interface TournamentDetails {
  _id: Id<"tournaments">;
  name: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  organiserName?: string;
  organiserPhone?: string;
  isPublic: boolean;
}

function DetailsForm({ tournament, pin }: { tournament: TournamentDetails; pin: string }) {
  const update = useMutation(api.tournaments.update);
  const [draft, setDraft] = useState({
    name: tournament.name,
    venue: tournament.venue ?? "",
    startDate: tournament.startDate ?? "",
    endDate: tournament.endDate ?? "",
    notes: tournament.notes ?? "",
    organiserName: tournament.organiserName ?? "",
    organiserPhone: tournament.organiserPhone ?? "",
    isPublic: tournament.isPublic,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await update({ tournamentId: tournament._id, pin, ...draft });
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-lg font-semibold tracking-tight">Tournament details</h3>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Venue">
            <Input
              maxLength={120}
              value={draft.venue}
              onChange={(e) => setDraft({ ...draft, venue: e.target.value })}
            />
          </Field>
          <Field label="Start date">
            <Input
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            />
          </Field>
          <Field label="End date">
            <Input
              type="date"
              value={draft.endDate}
              onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
            />
          </Field>
          <Field label="Organiser name">
            <Input
              maxLength={80}
              value={draft.organiserName}
              onChange={(e) => setDraft({ ...draft, organiserName: e.target.value })}
            />
          </Field>
          <Field label="Organiser phone">
            <Input
              type="tel"
              maxLength={20}
              value={draft.organiserPhone}
              onChange={(e) => setDraft({ ...draft, organiserPhone: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Notes for players" hint="Shown on the public page. Rules, timings, anything.">
          <Textarea
            maxLength={2000}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={draft.isPublic}
            onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-400"
          />
          List this tournament publicly (unlisted tournaments still work by link)
        </label>

        {error ? <Alert kind="error">{error}</Alert> : null}
        {saved ? <Alert kind="success">Saved.</Alert> : null}

        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save details"}
        </Button>
      </form>
    </Card>
  );
}

function PinForm({
  tournamentId,
  pin,
  onPinChanged,
}: {
  tournamentId: Id<"tournaments">;
  pin: string;
  onPinChanged: (next: string) => void;
}) {
  const changePin = useMutation(api.tournaments.changePin);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (newPin !== confirmPin) {
      setError("The two PINs do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePin({ tournamentId, pin, newPin });
      onPinChanged(newPin);
      setNewPin("");
      setConfirmPin("");
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-lg font-semibold tracking-tight">Organiser PIN</h3>
      <p className="mt-1 text-sm text-slate-600">
        Anyone with this PIN can change the draw and the scores. Share it only with the people
        running the desk.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="New PIN">
          <Input
            type="password"
            required
            minLength={4}
            maxLength={32}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Repeat the new PIN">
          <Input
            type="password"
            required
            minLength={4}
            maxLength={32}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <div className="sm:col-span-2 space-y-3">
          {error ? <Alert kind="error">{error}</Alert> : null}
          {saved ? <Alert kind="success">PIN changed.</Alert> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Changing…" : "Change PIN"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DangerZone({ tournamentId, name, pin }: { tournamentId: Id<"tournaments">; name: string; pin: string }) {
  const remove = useMutation(api.tournaments.remove);
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function destroy() {
    setError(null);
    setBusy(true);
    try {
      await remove({ tournamentId, pin });
      router.push("/");
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Card className="border-rose-200">
      <h3 className="text-lg font-semibold tracking-tight text-rose-700">Delete this tournament</h3>
      <p className="mt-1 text-sm text-slate-600">
        This removes every category, entrant, match and score. It cannot be undone. Type the
        tournament name to confirm.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Tournament name">
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={name} />
        </Field>
        <Button variant="danger" disabled={busy || confirmName.trim() !== name} onClick={destroy}>
          {busy ? "Deleting…" : "Delete permanently"}
        </Button>
      </div>
      {error ? (
        <div className="mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
    </Card>
  );
}

export function TournamentSettings({
  tournament,
  pin,
  onPinChanged,
}: {
  tournament: TournamentDetails;
  pin: string;
  onPinChanged: (next: string) => void;
}) {
  return (
    <div className="space-y-6">
      <DetailsForm tournament={tournament} pin={pin} />
      <PinForm tournamentId={tournament._id} pin={pin} onPinChanged={onPinChanged} />
      <DangerZone tournamentId={tournament._id} name={tournament.name} pin={pin} />
    </div>
  );
}
