"use client";

import { Field, Input, Select } from "@/components/ui";
import { SCORING_PRESETS, type ScoringConfig } from "@/lib/scoring";

/**
 * The scoring rules for a category. Presets cover the usual formats; the
 * fields below them let an organiser set anything else — any points target,
 * any number of sets, deuce with or without a cap, or golden point.
 */
export function ScoringFields({
  value,
  onChange,
}: {
  value: ScoringConfig;
  onChange: (next: ScoringConfig) => void;
}) {
  const matchingPreset = SCORING_PRESETS.find(
    (preset) =>
      preset.config.pointsPerSet === value.pointsPerSet &&
      preset.config.bestOf === value.bestOf &&
      preset.config.endMode === value.endMode &&
      preset.config.cap === value.cap,
  );

  return (
    <div className="flex flex-col gap-3.5 border border-[var(--color-divider)] bg-[var(--color-surface)] p-3.5">
      <Field label="Scoring preset">
        <Select
          value={matchingPreset?.id ?? "custom"}
          onChange={(e) => {
            const preset = SCORING_PRESETS.find((p) => p.id === e.target.value);
            if (preset) onChange({ ...preset.config });
          }}
        >
          {SCORING_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom (set the fields below)</option>
        </Select>
      </Field>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Points per set">
          <Input
            type="number"
            min={1}
            max={99}
            value={value.pointsPerSet}
            onChange={(e) => onChange({ ...value, pointsPerSet: Number(e.target.value) })}
          />
        </Field>

        <Field label="Sets">
          <Select
            value={value.bestOf}
            onChange={(e) => onChange({ ...value, bestOf: Number(e.target.value) })}
          >
            <option value={1}>Single set</option>
            <option value={3}>Best of 3</option>
            <option value={5}>Best of 5</option>
            <option value={7}>Best of 7</option>
          </Select>
        </Field>

        <Field label="End of a set">
          <Select
            value={value.endMode}
            onChange={(e) => {
              const endMode = e.target.value as ScoringConfig["endMode"];
              onChange({
                ...value,
                endMode,
                // A golden point set ends exactly on the target, so a cap is meaningless.
                cap: endMode === "golden" ? null : (value.cap ?? value.pointsPerSet + 9),
              });
            }}
          >
            <option value="deuce">Deuce — must win by two</option>
            <option value="golden">Golden point — first to the target wins</option>
          </Select>
        </Field>

        {value.endMode === "deuce" ? (
          <Field label="Cap" hint="The score at which one point is enough. Leave empty for no cap.">
            <Input
              type="number"
              min={value.pointsPerSet + 1}
              max={99}
              value={value.cap ?? ""}
              placeholder="No cap"
              onChange={(e) =>
                onChange({ ...value, cap: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </Field>
        ) : null}
      </div>
    </div>
  );
}
