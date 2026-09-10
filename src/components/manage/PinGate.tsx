"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/usePin";

/** Asks for the organiser PIN and hands it back only once the server accepts it. */
export function PinGate({
  tournamentId,
  tournamentName,
  onUnlock,
}: {
  tournamentId: Id<"tournaments">;
  tournamentName: string;
  onUnlock: (pin: string) => void;
}) {
  const verify = useMutation(api.tournaments.verifyPin);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verify({ tournamentId, pin });
      onUnlock(pin);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <h1 className="text-xl font-bold tracking-tight">Organiser sign-in</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter the PIN for {tournamentName} to make changes.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="Organiser PIN">
            <Input
              type="password"
              required
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {error ? <Alert kind="error">{error}</Alert> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </form>
        <p className="mt-4 text-xs text-slate-500">
          After eight wrong PINs the tournament locks for ten minutes.
        </p>
      </Card>
    </div>
  );
}
