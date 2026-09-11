"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Alert, Button, Checkbox, Field, Input, Section, Select } from "@/components/ui";
import { ScoringFields } from "./ScoringFields";
import { DEFAULT_SCORING, type ScoringConfig } from "@/lib/scoring";
import { looksLikeDoubles } from "@/lib/display";
import { errorMessage } from "@/lib/useSession";

type Format = Doc<"events">["format"];

interface Draft {
  name: string;
  teamSize: number;
  format: Format;
  scoring: ScoringConfig;
  /** null means the closing round is played to the category's own rules. */
  semiFinalScoring: ScoringConfig | null;
  finalScoring: ScoringConfig | null;
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
      semiFinalScoring: null,
      finalScoring: null,
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
    semiFinalScoring: (event.semiFinalScoring as ScoringConfig | null | undefined) ?? null,
    finalScoring: (event.finalScoring as ScoringConfig | null | undefined) ?? null,
    thirdPlace: event.thirdPlace,
    groupCount: event.groupCount,
    advancePerGroup: event.advancePerGroup,
    doubleRound: event.doubleRound,
  };
}

/** Create a category, or edit the one passed in. */
export function EventForm({
  tournamentId,
  token,
  event,
  onDone,
}: {
  tournamentId: Id<"tournaments">;
  token: string;
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
      if (event) await update({ eventId: event._id, token, ...draft });
      else await create({ tournamentId, token, ...draft });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  // "Mens Doubles" left on Singles is the single easiest way to lose every
  // partner name, so the form says so before the entrants are typed in.
  const teamSizeMismatch = looksLikeDoubles(draft.name) && draft.teamSize !== 2;

  const usesGroups = draft.format === "groups_knockout";
  const usesRoundRobin = draft.format === "round_robin" || usesGroups;
  const usesKnockout = draft.format !== "round_robin";

  // Once the draw exists the rules it was built from are fixed, and the server
  // refuses to change them. The form says so rather than letting the organiser
  // type into a field whose value will be rejected on save.
  const locked = Boolean(event?.drawGeneratedAt);

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
              disabled={locked}
              value={draft.teamSize}
              onChange={(e) => setDraft({ ...draft, teamSize: Number(e.target.value) })}
            >
              <option value={1}>Singles</option>
              <option value={2}>Doubles</option>
            </Select>
          </Field>
        </div>

        {teamSizeMismatch ? (
          <Alert kind="info">
            This category is named like a doubles event but is set to Singles, so only one
            name per entry will be kept. Switch it to Doubles if entrants play in pairs.
          </Alert>
        ) : null}

        <Field label="Draw format">
          <Select
            disabled={locked}
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
          disabled={locked}
          onChange={(scoring) => setDraft({ ...draft, scoring })}
        />

        {usesKnockout ? (
          <div className="flex flex-col gap-3.5">
            <Checkbox
              checked={draft.semiFinalScoring !== null}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  semiFinalScoring: e.target.checked ? { ...draft.scoring } : null,
                })
              }
              label="Play the semi-finals to different rules"
            />
            {draft.semiFinalScoring ? (
              <ScoringFields
                label="Semi-final scoring"
                value={draft.semiFinalScoring}
                onChange={(semiFinalScoring) => setDraft({ ...draft, semiFinalScoring })}
              />
            ) : null}

            <Checkbox
              checked={draft.finalScoring !== null}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  finalScoring: e.target.checked ? { ...draft.scoring } : null,
                })
              }
              label="Play the final to different rules"
            />
            {draft.finalScoring ? (
              <ScoringFields
                label="Final scoring"
                value={draft.finalScoring}
                onChange={(finalScoring) => setDraft({ ...draft, finalScoring })}
              />
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3.5 sm:grid-cols-2">
          {usesGroups ? (
            <>
              <Field label="Number of groups">
                <Input
                  disabled={locked}
                  type="number"
                  min={1}
                  max={32}
                  value={draft.groupCount}
                  onChange={(e) => setDraft({ ...draft, groupCount: Number(e.target.value) })}
                />
              </Field>
              <Field label="Qualify from each group">
                <Input
                  disabled={locked}
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
              disabled={locked}
              checked={draft.doubleRound}
              onChange={(e) => setDraft({ ...draft, doubleRound: e.target.checked })}
              label="Play every pairing twice (home and away)"
            />
          ) : null}

          {usesKnockout ? (
            <Checkbox
              disabled={locked}
              checked={draft.thirdPlace}
              onChange={(e) => setDraft({ ...draft, thirdPlace: e.target.checked })}
              label="Add a third-place playoff"
            />
          ) : null}
        </div>

        {locked ? (
          <Alert kind="info">
            The draw for this category has already been made, so the format, the scoring and the
            group settings are locked — changing them now would invalidate matches that have
            already been played. Clear the draw to change them. The semi-final and final rules can
            still be changed, up until those rounds are played.
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
