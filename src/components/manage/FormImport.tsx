"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, Button, Checkbox, Field, Select, Textarea } from "@/components/ui";
import { errorMessage } from "@/lib/useSession";
import {
  categoryOptions,
  guessColumns,
  parseDelimited,
  prepareRows,
  type ColumnMap,
} from "@/lib/csv";

/**
 * Importing the entry list a Google Form collected.
 *
 * The organiser puts a form out, players fill it in, and Google keeps the
 * answers in a sheet. This takes that sheet — downloaded as CSV, or simply
 * selected in the browser and pasted — works out which column is which, shows
 * every row and what will happen to it, and only then writes anything.
 *
 * The preview is the whole point. An import that reports "added 28" and says
 * nothing else leaves the organiser to find the four missing players at the
 * desk on the morning; this one names them and says why, while there is still
 * time to fix the sheet and paste it again.
 */

/** How the column dropdowns say "this sheet has no such column". */
const NONE = "-";

function MappingSelect({
  label,
  hint,
  headers,
  value,
  onChange,
  optional,
}: {
  label: string;
  hint?: string;
  headers: readonly string[];
  value: number | null;
  onChange: (next: number | null) => void;
  optional?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <Select
        value={value === null ? NONE : String(value)}
        onChange={(e) => onChange(e.target.value === NONE ? null : Number(e.target.value))}
      >
        {optional ? <option value={NONE}>Not in this sheet</option> : null}
        {headers.map((header, index) => (
          <option key={index} value={index}>
            {header || `Column ${index + 1}`}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function FormImport({
  eventId,
  teamSize,
  token,
  /** Names already in this category, so a resubmitted form is not a duplicate. */
  existingKeys,
  onError,
}: {
  eventId: Id<"events">;
  teamSize: number;
  token: string;
  existingKeys: readonly string[];
  onError: (message: string | null) => void;
}) {
  const importRows = useMutation(api.entries.importRows);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  // Null means "not chosen yet", which is what lets the guess move when a new
  // sheet is pasted while still leaving a chosen column alone.
  const [chosen, setChosen] = useState<Partial<ColumnMap>>({});
  const [category, setCategory] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: string[] } | null>(null);

  const rows = useMemo(() => (text.trim() ? parseDelimited(text) : []), [text]);
  const headers = useMemo(
    () =>
      rows.length === 0
        ? []
        : hasHeader
          ? rows[0].map((header, index) => header || `Column ${index + 1}`)
          : rows[0].map((_, index) => `Column ${index + 1}`),
    [rows, hasHeader],
  );
  const guess = useMemo(() => guessColumns(headers), [headers]);
  const map: ColumnMap = { ...guess, ...chosen };
  const categories = useMemo(
    () => categoryOptions(rows, map.category, hasHeader),
    [rows, map.category, hasHeader],
  );

  const prepared = useMemo(
    () =>
      rows.length === 0
        ? []
        : prepareRows(rows, map, {
            teamSize,
            hasHeader,
            categoryFilter: category || undefined,
            existingKeys,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, map.playerOne, map.playerTwo, map.club, map.phone, map.category, teamSize, hasHeader, category, existingKeys],
  );
  const ready = prepared.filter((row) => row.entry !== null);
  const rejected = prepared.filter((row) => row.entry === null);

  function set(field: keyof ColumnMap, value: number | null): void {
    setChosen((current) => ({ ...current, [field]: value }));
    setResult(null);
  }

  function load(next: string): void {
    setText(next);
    // A new sheet is a new mapping: keeping the old choices would silently
    // point at columns that have moved.
    setChosen({});
    setCategory("");
    setResult(null);
  }

  async function readFile(file: File): Promise<void> {
    onError(null);
    try {
      load(await file.text());
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }

  async function submit(formEvent: React.FormEvent): Promise<void> {
    formEvent.preventDefault();
    onError(null);
    setBusy(true);
    try {
      const outcome = await importRows({
        eventId,
        token,
        rows: ready.map((row) => row.entry!),
      });
      setResult(outcome);
      if (outcome.skipped.length === 0) {
        setText("");
        setChosen({});
        if (fileInput.current) fileInput.current.value = "";
      }
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <Field
        label="Paste the form responses"
        hint="Open the form's response sheet, select the rows and paste them here. A downloaded CSV works too."
      >
        <Textarea
          value={text}
          onChange={(e) => load(e.target.value)}
          rows={5}
          placeholder={"Timestamp,Your name,Partner,Club\n12/09/2026 9:14,Anita Rao,Priya Shah,Ahmedabad SC"}
        />
      </Field>

      <div>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          aria-label="Upload a CSV file"
          className="text-[12px]"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
          }}
        />
      </div>

      {rows.length > 0 ? (
        <>
          <Checkbox
            label="The first row is the question headings"
            checked={hasHeader}
            onChange={(e) => {
              setHasHeader(e.target.checked);
              setChosen({});
              setResult(null);
            }}
          />

          <div className="grid gap-3.5 sm:grid-cols-2">
            <MappingSelect
              label="Name column"
              headers={headers}
              value={map.playerOne}
              onChange={(next) => set("playerOne", next)}
            />
            {teamSize === 2 ? (
              <MappingSelect
                label="Partner column"
                hint="A doubles category needs both names, so a row without a partner is skipped."
                headers={headers}
                value={map.playerTwo}
                onChange={(next) => set("playerTwo", next)}
                optional
              />
            ) : null}
            <MappingSelect
              label="Club column"
              headers={headers}
              value={map.club}
              onChange={(next) => set("club", next)}
              optional
            />
            <MappingSelect
              label="Phone column"
              hint="Kept for the organiser only. Phone numbers never appear on the public page."
              headers={headers}
              value={map.phone}
              onChange={(next) => set("phone", next)}
              optional
            />
            <MappingSelect
              label="Category column"
              hint="For one form that collects the whole tournament. Pick the answer this category takes."
              headers={headers}
              value={map.category}
              onChange={(next) => {
                set("category", next);
                setCategory("");
              }}
              optional
            />
            {map.category !== null && categories.length > 0 ? (
              <Field label="Import the rows that answered">
                <Select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setResult(null);
                  }}
                >
                  <option value="">Every row, whatever they answered</option>
                  {categories.map((answer) => (
                    <option key={answer} value={answer}>
                      {answer}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>

          <Alert kind={rejected.length > 0 ? "info" : "success"}>
            <strong>
              {ready.length} row{ready.length === 1 ? "" : "s"} ready to import
            </strong>
            {rejected.length > 0 ? `, ${rejected.length} will be skipped.` : "."}
          </Alert>

          {ready.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 pr-3 font-semibold">Entrant</th>
                    <th className="py-1 pr-3 font-semibold">Club</th>
                    <th className="py-1 font-semibold">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {ready.slice(0, 8).map((row) => (
                    <tr key={row.line} className="border-t border-[var(--color-divider)]">
                      <td className="py-1 pr-3">
                        {row.entry!.playerTwo
                          ? `${row.entry!.playerOne} / ${row.entry!.playerTwo}`
                          : row.entry!.playerOne}
                      </td>
                      <td className="py-1 pr-3 text-muted">{row.entry!.club ?? "—"}</td>
                      <td className="num py-1 text-muted">{row.entry!.phone ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ready.length > 8 ? (
                <p className="note m-0 pt-1">and {ready.length - 8} more.</p>
              ) : null}
            </div>
          ) : null}

          {rejected.length > 0 ? (
            <details>
              <summary className="min-h-11 cursor-pointer text-[12px] font-semibold">
                Why {rejected.length} row{rejected.length === 1 ? " is" : "s are"} being skipped
              </summary>
              <ul className="m-0 list-none p-0 pt-1.5">
                {rejected.slice(0, 20).map((row) => (
                  <li key={row.line} className="note py-0.5">
                    Row {row.line}: {row.cells.filter(Boolean).slice(0, 3).join(", ") || "blank"} —{" "}
                    {row.reason}
                  </li>
                ))}
                {rejected.length > 20 ? (
                  <li className="note py-0.5">and {rejected.length - 20} more.</li>
                ) : null}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      {result ? (
        <Alert kind={result.skipped.length > 0 ? "info" : "success"}>
          Imported {result.added} entrant{result.added === 1 ? "" : "s"}.
          {result.skipped.length > 0
            ? ` The server skipped ${result.skipped.length}: ${result.skipped
                .slice(0, 5)
                .join(", ")}${result.skipped.length > 5 ? "…" : ""}`
            : ""}
        </Alert>
      ) : null}

      <div>
        <Button type="submit" className="min-h-12" disabled={busy || ready.length === 0}>
          {busy ? "Importing…" : `Import ${ready.length || ""} entrant${ready.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </form>
  );
}
