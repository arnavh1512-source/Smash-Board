"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, Button, Checkbox, Field, Input, Section, Textarea } from "@/components/ui";
import { ShareBar } from "@/components/tournament/ShareBar";
import { errorMessage } from "@/lib/usePin";

export interface TournamentDetails {
  _id: Id<"tournaments">;
  slug: string;
  name: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  organiserName?: string;
  organiserPhone?: string;
  isPublic: boolean;
  hasRefereePin: boolean;
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
    <Section>
      <h6 className="m-0">Tournament details</h6>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
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
          <Field label="Start date" hint="Needed before the order of play can be planned.">
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

        <Checkbox
          checked={draft.isPublic}
          onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })}
          label="List this tournament publicly (unlisted tournaments still work by link)"
        />

        {error ? <Alert kind="error">{error}</Alert> : null}
        {saved ? <Alert kind="success">Saved.</Alert> : null}

        <div>
          <Button type="submit" className="min-h-12" disabled={busy}>
            {busy ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PinForm({
  tournamentId,
  pin,
  hasRefereePin,
  onPinChanged,
}: {
  tournamentId: Id<"tournaments">;
  pin: string;
  hasRefereePin: boolean;
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
    <Section>
      <h6 className="m-0">Organiser PIN</h6>
      <p className="m-0 text-[13px] opacity-70">
        Anyone with this PIN can change the draw and the scores. Share it only with the people
        running the desk.
      </p>
      {hasRefereePin ? (
        <Alert kind="info">
          Changing this PIN also clears the referee PIN. You will need to set a new one for your
          umpires afterwards.
        </Alert>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
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
        </div>
        {error ? <Alert kind="error">{error}</Alert> : null}
        {saved ? <Alert kind="success">PIN changed.</Alert> : null}
        <div>
          <Button type="submit" variant="secondary" className="min-h-12" disabled={busy}>
            {busy ? "Changing…" : "Change PIN"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/**
 * The referee PIN.
 *
 * A second PIN that opens the scoring console and nothing else, so umpires can
 * enter their own results without being handed the keys to the draw.
 */
function RefereePinForm({
  tournament,
  pin,
}: {
  tournament: TournamentDetails;
  pin: string;
}) {
  const setRefereePin = useMutation(api.tournaments.setRefereePin);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await setRefereePin({ tournamentId: tournament._id, pin, refereePin: value });
      setValue("");
      setNotice("Referee PIN saved. Share it with your umpires along with the scoring link.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!window.confirm("Remove the referee PIN? Umpires will lose access to the scoring page.")) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await setRefereePin({ tournamentId: tournament._id, pin, refereePin: null });
      setNotice("Referee PIN removed.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section>
      <h6 className="m-0">Referee PIN</h6>
      <p className="m-0 text-[13px] opacity-70">
        Umpires with this PIN can enter scores and nothing else — they cannot touch the draw, the
        entrants or the settings. It must be different from your organiser PIN.
      </p>

      {tournament.hasRefereePin ? (
        <>
          <Alert kind="success">A referee PIN is set. Give your umpires this link:</Alert>
          <ShareBar
            name={`${tournament.name} — referee scoring`}
            path={`/t/${tournament.slug}/score`}
            compact
          />
        </>
      ) : (
        <Alert kind="info">No referee PIN yet. Only you can enter scores.</Alert>
      )}

      <form onSubmit={save} className="flex flex-col gap-3.5">
        <Field
          label={tournament.hasRefereePin ? "Replace the referee PIN" : "Referee PIN"}
          hint="4 to 32 characters."
        >
          <Input
            type="password"
            required
            minLength={4}
            maxLength={32}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="new-password"
          />
        </Field>

        {error ? <Alert kind="error">{error}</Alert> : null}
        {notice ? <Alert kind="success">{notice}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" className="min-h-12" disabled={busy}>
            {busy ? "Saving…" : tournament.hasRefereePin ? "Replace PIN" : "Set referee PIN"}
          </Button>
          {tournament.hasRefereePin ? (
            <Button type="button" variant="ghost" className="min-h-12" disabled={busy} onClick={clear}>
              Remove
            </Button>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

function DangerZone({
  tournamentId,
  name,
  pin,
}: {
  tournamentId: Id<"tournaments">;
  name: string;
  pin: string;
}) {
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
    <Section className="border-b-0">
      <h6 className="m-0 text-[var(--color-accent-ink)]">Danger</h6>
      <p className="m-0 text-[13px] opacity-70">
        Deleting removes every category, entrant, match and score. It cannot be undone. Type the
        tournament name to confirm.
      </p>
      <Field label="Tournament name">
        <Input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={name}
        />
      </Field>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <Button
        block
        className="min-h-12"
        disabled={busy || confirmName.trim() !== name}
        onClick={destroy}
      >
        {busy ? "Deleting…" : "Delete this tournament"}
      </Button>
    </Section>
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
    <div>
      <DetailsForm tournament={tournament} pin={pin} />
      <PinForm
        tournamentId={tournament._id}
        pin={pin}
        hasRefereePin={tournament.hasRefereePin}
        onPinChanged={onPinChanged}
      />
      <RefereePinForm tournament={tournament} pin={pin} />
      <DangerZone tournamentId={tournament._id} name={tournament.name} pin={pin} />
    </div>
  );
}
