"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { errorMessage } from "@/lib/usePin";

/** Everything the organiser needs to start, on one short form. */
export function CreateTournamentForm() {
  const create = useMutation(api.tournaments.create);
  const router = useRouter();

  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [organiserName, setOrganiserName] = useState("");
  const [organiserPhone, setOrganiserPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (pin !== confirmPin) {
      setError("The two PINs do not match.");
      return;
    }

    setBusy(true);
    try {
      const result = await create({
        name,
        venue: venue || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        notes: notes || undefined,
        organiserName: organiserName || undefined,
        organiserPhone: organiserPhone || undefined,
        pin,
        isPublic,
      });
      try {
        window.sessionStorage.setItem(`smashboard:pin:${result.slug}`, pin);
      } catch {
        // The organiser will simply be asked for the PIN on the next screen.
      }
      router.push(`/t/${result.slug}/manage`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-xl font-bold tracking-tight">Create a tournament</h2>
      <p className="mt-1 text-sm text-slate-600">
        Takes under a minute. The PIN is the only thing that lets you edit it later, so keep it safe.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Tournament name">
          <Input
            required
            minLength={3}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ahmedabad Open 2026"
          />
        </Field>

        <Field label="Venue">
          <Input
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="Sardar Patel Stadium Hall 2"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organiser name">
            <Input value={organiserName} onChange={(e) => setOrganiserName(e.target.value)} />
          </Field>
          <Field label="Organiser phone" hint="Shown to players so they can reach you.">
            <Input
              type="tel"
              value={organiserPhone}
              onChange={(e) => setOrganiserPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </Field>
        </div>

        <Field label="Notes for players" hint="Entry fee, reporting time, rules — anything worth saying.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organiser PIN" hint="At least 4 characters.">
            <Input
              type="password"
              required
              minLength={4}
              maxLength={64}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm PIN">
            <Input
              type="password"
              required
              minLength={4}
              maxLength={64}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-400"
          />
          <span>
            List this tournament publicly. Turn it off and only people with the link can find it — the
            link still works either way.
          </span>
        </label>

        {error ? <Alert kind="error">{error}</Alert> : null}

        <Button type="submit" disabled={busy} className="w-full py-2.5">
          {busy ? "Creating…" : "Create tournament"}
        </Button>
      </form>
    </Card>
  );
}
