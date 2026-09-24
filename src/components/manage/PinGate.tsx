"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/errors";
import type { AccessRole } from "@/lib/useSession";
import { clientId } from "@/lib/clientId";

/**
 * Asks for a PIN and trades it with the server for a session token.
 *
 * The PIN never leaves this component: what is handed back, and what every
 * later mutation carries, is the token.
 */
export function PinGate({
  tournamentId,
  tournamentName,
  slug,
  role = "organiser",
  onUnlock,
}: {
  tournamentId: Id<"tournaments">;
  tournamentName: string;
  slug: string;
  role?: AccessRole;
  onUnlock: (token: string) => void;
}) {
  const referee = role === "referee";
  const signIn = useMutation(api.tournaments.signIn);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signIn({ tournamentId, pin, role, client: clientId() });
      if (!result.ok || !result.token) {
        setError(result.error ?? "That PIN was not recognised.");
        return;
      }
      onUnlock(result.token);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-6">
      <h6 className="m-0 text-muted">{tournamentName}</h6>
      <h3 className="m-0">{referee ? "Referee sign-in" : "Organiser sign-in"}</h3>
      <p className="m-0 text-[13px] text-muted">
        {referee
          ? "Enter the referee PIN the organiser gave you. It lets you enter scores and nothing else."
          : "The PIN unlocks the console for this device only."}{" "}
        After five wrong tries this device is locked out for fifteen minutes.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={referee ? "Referee PIN" : "Organiser PIN"}>
          <Input
            type="password"
            required
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoComplete="current-password"
            className="min-h-[54px] text-[22px] tracking-[0.5em]"
          />
        </Field>

        {error ? (
          <p role="alert" className="m-0 text-[13px] text-[var(--color-accent-ink)]">
            {error}
          </p>
        ) : null}

        <Button type="submit" block disabled={busy} className="min-h-[50px] text-[15px]">
          {busy ? "Checking…" : referee ? "Start scoring" : "Unlock the console"}
        </Button>
      </form>

      <Link href={`/t/${slug}`} className="btn btn-secondary btn-block min-h-[46px]">
        Back to the scoreboard
      </Link>
    </div>
  );
}
