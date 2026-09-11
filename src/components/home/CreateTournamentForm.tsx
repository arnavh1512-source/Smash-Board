"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Alert, Button, Checkbox, Field, Input, Textarea } from "@/components/ui";
import { errorMessage, sessionKey } from "@/lib/useSession";

/** A section heading in the form: an accent numeral and a title, as the design sets them. */
function Step({ number, title }: { number: string; title: string }) {
  return (
    <h6 className="m-0 text-[var(--color-accent-ink)]">
      {number} — {title}
    </h6>
  );
}

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
        // `create` signs the organiser in, so the console opens straight away.
        window.sessionStorage.setItem(sessionKey(result.slug), result.token);
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
    <section className="rule-b2 bg-[var(--color-surface)] px-4 py-5">
      <h4 className="m-0">Create a tournament</h4>
      <p className="mb-4 mt-1.5 text-[13px] opacity-75">
        Takes under a minute. The PIN is the only thing that lets you edit it later, so keep it safe.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Step number="01" title="The tournament" />

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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Notes for players" hint="Entry fee, reporting time, rules — anything worth saying.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>

        <hr className="hr" style={{ margin: 0 }} />
        <Step number="02" title="You" />

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

        <hr className="hr" style={{ margin: 0 }} />
        <Step number="03" title="Your key" />

        <p className="note note-accent m-0">
          The PIN is the only way back into the console. There is no email reset — write it down before
          you carry on.
        </p>

        <Field label="Organiser PIN" hint="At least 4 characters.">
          <Input
            type="password"
            required
            minLength={4}
            maxLength={64}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoComplete="new-password"
            className="tracking-[0.3em]"
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
            className="tracking-[0.3em]"
          />
        </Field>

        <Checkbox
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          label="Listed publicly on the home page"
        />

        {error ? <Alert kind="error">{error}</Alert> : null}

        <Button type="submit" block disabled={busy} className="min-h-[50px] text-[15px]">
          {busy ? "Creating…" : "Create and get my link"}
        </Button>
      </form>
    </section>
  );
}
