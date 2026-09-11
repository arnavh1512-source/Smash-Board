"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Alert, Button, Checkbox, Field, Input, Section, Select } from "@/components/ui";
import { ScoringFields } from "./ScoringFields";
import { DEFAULT_SCORING, type ScoringConfig } from "@/lib/scoring";
import { errorMessage } from "@/lib/usePin";

type Format = Doc<"events">["format"];

interface Draft {
  name: string;
  teamSize: number;
  format: Format;
  scoring: ScoringConfig;
  thirdPlace: boolean;
  groupCount: number;
  advancePerGroup: number;
  doubleRound: boolean;
}

function draftFrom(event: Doc<"events"> | null): Draft {
  if (!event) {
    return {
      name: "",
      teamSize: 1,
      format: "knockout",
      scoring: { ...DEFAULT_SCORING },
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    };
  }
  return {
    name: event.name,
    teamSize: event.teamSize,
    format: event.format,
    scoring: event.scoring as ScoringConfig,
    thirdPlace: event.thirdPlace,
    groupCount: event.groupCount,
    advancePerGroup: event.advancePerGroup,
    doubleRound: event.doubleRound,
  };
}

/** Create a category, or edit the one passed in. */
export function EventForm({
  tournamentId,
  pin,
  event,
  onDone,
}: {
  tournamentId: Id<"tournaments">;
  pin: string;
  event: Doc<"events"> | null;
  onDone: () => void;
}) {
  const create = useMutation(api.events.create);
  const update = useMutation(api.events.update);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(event));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (event) await update({ eventId: event._id, pin, ...draft });
      else await create({ tournamentId, pin, ...draft });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  const usesGroups = draft.format === "groups_knockout";
  const usesRoundRobin = draft.format === "round_robin" || usesGroups;
  const usesKnockout = draft.format !== "round_robin";

  return (
    <Section>
      <h6 className="m-0">{event ? `Edit ${event.name}` : "Add a category"}</h6>

      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Category name">
            <Input
              required
              minLength={2}
              maxLength={80}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Men's Singles U19"
            />
          </Field>

          <Field label="Singles or doubles">
            <Select
              value={draft.teamSize}
              onChange={(e) => setDraft({ ...draft, teamSize: Number(e.target.value) })}
            >
              <option value={1}>Singles</option>
              <option value={2}>Doubles</option>
            </Select>
          </Field>
        </div>

        <Field label="Draw format">
          <Select
            value={draft.format}
            onChange={(e) => setDraft({ ...draft, format: e.target.value as Format })}
          >
            <option value="knockout">Knockout</option>
            <option value="round_robin">Round robin (everyone plays everyone)</option>
            <option value="groups_knockout">Groups, then knockout</option>
          </Select>
        </Field>

        <ScoringFields
          value={draft.scoring}
          onChange={(scoring) => setDraft({ ...draft, scoring })}
        />

        <div className="grid gap-3.5 sm:grid-cols-2">
          {usesGroups ? (
            <>
              <Field label="Number of groups">
                <Input
                  type="number"
                  min={1}
                  max={32}
                  value={draft.groupCount}
                  onChange={(e) => setDraft({ ...draft, groupCount: Number(e.target.value) })}
                />
              </Field>
              <Field label="Qualify from each group">
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={draft.advancePerGroup}
                  onChange={(e) => setDraft({ ...draft, advancePerGroup: Number(e.target.value) })}
                />
              </Field>
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          {usesRoundRobin ? (
            <Checkbox
              checked={draft.doubleRound}
              onChange={(e) => setDraft({ ...draft, doubleRound: e.target.checked })}
              label="Play every pairing twice (home and away)"
            />
          ) : null}

          {usesKnockout ? (
            <Checkbox
              checked={draft.thirdPlace}
              onChange={(e) => setDraft({ ...draft, thirdPlace: e.target.checked })}
              label="Add a third-place playoff"
            />
          ) : null}
        </div>

        {event?.drawGeneratedAt ? (
          <Alert kind="info">
            The draw is already made. Changing the format or the group settings only takes effect
            when you generate the draw again.
          </Alert>
        ) : null}

        {error ? <Alert kind="error">{error}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="min-h-12" disabled={busy}>
            {busy ? "Saving…" : event ? "Save changes" : "Add category"}
          </Button>
          <Button type="button" variant="ghost" className="min-h-12" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}
