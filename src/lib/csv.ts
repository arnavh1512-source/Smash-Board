/**
 * Reading an entry list out of a Google Form.
 *
 * Entries arrive as a spreadsheet, not as a typed list: the organiser puts a
 * form out, players fill it in, and Google hands back a response sheet with a
 * timestamp column, an email column, and whatever questions were asked, in
 * whatever order they were asked. Nothing about that shape is fixed, so this
 * module does not guess it once and hope — it parses the file, offers its best
 * guess at which column is which, and hands the organiser back a row-by-row
 * preview to correct before anything is written.
 *
 * Parsing lives here rather than in the component because the awkward parts of
 * a real response sheet are all data problems: a quoted field holding a comma
 * ("Shah, Arnav"), a doubled quote inside a quoted field, a newline inside an
 * answer, a sheet copied out of the browser as tabs rather than commas, and a
 * trailing blank line. Those deserve tests, and a component is a poor place to
 * write them.
 */

import { personKey } from "./identity";

/** The separators a response sheet actually turns up as. */
export type Delimiter = "," | "\t" | ";";

const DELIMITERS: readonly Delimiter[] = [",", "\t", ";"];

/**
 * Which separator this text uses.
 *
 * A file downloaded from Google Sheets is comma-separated; a selection copied
 * out of the browser and pasted straight in is tab-separated; a sheet from a
 * machine set to a European locale is semicolon-separated.
 *
 * Counting separators on the raw first line is not enough to tell them apart,
 * because a quoted answer may hold any of them: a tab-separated sheet whose
 * first cell is "Shah, Arnav, Jr" has more commas in it than tabs, and a
 * counting detector would read the whole file as commas and hand the parser
 * one field per row. So each candidate is actually parsed instead, and the one
 * that yields a table - several columns, and the same number of them on every
 * row - wins. A separator that is really just punctuation inside a field
 * produces ragged rows, which is exactly what this measures.
 */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ",";
  let bestScore = { columns: 0, agreement: 0 };
  for (const candidate of DELIMITERS) {
    const score = tabulates(text, candidate);
    if (
      score.columns > 1 &&
      (score.agreement > bestScore.agreement ||
        (score.agreement === bestScore.agreement && score.columns > bestScore.columns))
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How well this separator reads the text as a table.
 *
 * `columns` is what the first row splits into and `agreement` is the share of
 * rows that agree with it. Only the head of the file is read: a response sheet
 * with a thousand answers in it is settled by its first few rows, and the
 * detector runs on every keystroke in the paste box.
 */
function tabulates(text: string, delimiter: Delimiter): { columns: number; agreement: number } {
  const rows = parseDelimited(text, delimiter).slice(0, 20);
  if (rows.length === 0) return { columns: 0, agreement: 0 };
  const columns = rows[0].length;
  const agreeing = rows.filter((row) => row.length === columns).length;
  return { columns, agreement: agreeing / rows.length };
}

/**
 * Split delimited text into rows of fields.
 *
 * Follows the CSV convention every spreadsheet writes: a field may be wrapped
 * in double quotes, a quoted field may contain the delimiter and line breaks,
 * and a literal quote inside a quoted field is written twice. Anything outside
 * quotes is taken literally, which is what makes a hand-edited sheet with a
 * stray quote in it import as a name rather than swallowing the rest of the
 * file.
 */
export function parseDelimited(text: string, delimiter?: Delimiter): string[][] {
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // A BOM at the head of a downloaded CSV is not part of the first header.
  const source = text.replace(/^﻿/, "");

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === sep) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  // A file ends with a newline, which leaves one empty row behind it. Blank
  // rows in the middle are dropped for the same reason: a spacer line in a
  // spreadsheet is not an entrant.
  return rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ""));
}

/** Which column of the sheet holds what. `null` means "the sheet has none". */
export interface ColumnMap {
  playerOne: number;
  playerTwo: number | null;
  club: number | null;
  phone: number | null;
  /** A category question, when one form collects entries for several events. */
  category: number | null;
}

/** Header words that point at each field, in the order they are preferred. */
const HEADER_HINTS: Record<keyof ColumnMap, readonly string[]> = {
  playerOne: ["player one", "player 1", "your name", "full name", "name", "player"],
  playerTwo: ["player two", "player 2", "partner", "doubles partner", "team mate", "teammate"],
  club: ["club", "academy", "team", "school", "college", "city"],
  phone: ["phone", "mobile", "whatsapp", "contact", "number"],
  category: ["category", "event", "which event", "type"],
};

/** Header words that must never be taken for a name. */
const NEVER_A_NAME = ["timestamp", "email", "e-mail", "score", "date"];

function findHeader(headers: readonly string[], hints: readonly string[]): number | null {
  const lower = headers.map((header) => header.toLowerCase().trim());
  for (const hint of hints) {
    const exact = lower.indexOf(hint);
    if (exact !== -1) return exact;
  }
  for (const hint of hints) {
    const partial = lower.findIndex(
      (header) => header.includes(hint) && !NEVER_A_NAME.some((bad) => header.includes(bad)),
    );
    if (partial !== -1) return partial;
  }
  return null;
}

/**
 * A first guess at the mapping, for the organiser to correct.
 *
 * Deliberately a guess and nothing more. It is right often enough to save the
 * work on an ordinary form, and the preview underneath it means being wrong
 * costs a dropdown rather than a corrupted entry list. When no column looks
 * like a name at all it falls back to the first column that is plainly not a
 * timestamp or an email address, because that is where a name usually is.
 */
export function guessColumns(headers: readonly string[]): ColumnMap {
  const named = findHeader(headers, HEADER_HINTS.playerOne);
  const fallback = headers.findIndex(
    (header) => !NEVER_A_NAME.some((bad) => header.toLowerCase().includes(bad)),
  );
  const playerTwo = findHeader(headers, HEADER_HINTS.playerTwo);
  const playerOne = named ?? (fallback === -1 ? 0 : fallback);
  return {
    playerOne,
    // A "partner" column that turned out to be the name column is no column.
    playerTwo: playerTwo === playerOne ? null : playerTwo,
    club: findHeader(headers, HEADER_HINTS.club),
    phone: findHeader(headers, HEADER_HINTS.phone),
    category: findHeader(headers, HEADER_HINTS.category),
  };
}

/** One entrant, as the import will send them to the server. */
export interface ImportRow {
  playerOne: string;
  playerTwo?: string;
  club?: string;
  phone?: string;
}

/** A row of the sheet, judged. */
export interface PreparedRow {
  /** 1-based line number in the pasted text, so the preview can point at it. */
  line: number;
  /** The cells that were read, for showing the organiser what was skipped. */
  cells: readonly string[];
  entry: ImportRow | null;
  /** Why this row is not being imported. `null` when it is. */
  reason: string | null;
}

export interface PrepareOptions {
  teamSize: number;
  /** Skip the first row: it is the question text, not an entrant. */
  hasHeader: boolean;
  /**
   * Import only the rows whose category cell matches this, for a single form
   * that collects entries for the whole tournament. Compared the way names are
   * compared, so "Men's Singles" and "mens singles " are the same answer.
   */
  categoryFilter?: string;
  /** People already in this category, as `personKey` sees them. */
  existingKeys?: readonly string[];
}

function cell(cells: readonly string[], index: number | null): string {
  if (index === null || index < 0 || index >= cells.length) return "";
  return cells[index].trim().replace(/\s+/g, " ");
}

/**
 * Turn parsed rows into entrants, saying what happened to every one of them.
 *
 * Nothing is silently dropped. A blank line, a missing partner, a category
 * that belongs to a different event, a name already on the sheet — each comes
 * back with the row it came from and a reason in plain words, because the
 * organiser needs to know that thirty-one of thirty-two rows imported *and*
 * which one did not.
 *
 * Duplicates matter more here than anywhere else in the app: a form invites
 * people to submit twice, and they do. A person already in this category is
 * skipped rather than entered again, and so is a second row for a person the
 * import itself has already taken.
 */
export function prepareRows(
  rows: readonly (readonly string[])[],
  map: ColumnMap,
  options: PrepareOptions,
): PreparedRow[] {
  const body = options.hasHeader ? rows.slice(1) : rows;
  const offset = options.hasHeader ? 2 : 1;
  const wanted = options.categoryFilter ? personKey(options.categoryFilter) : null;
  const taken = new Set((options.existingKeys ?? []).map(personKey));
  const prepared: PreparedRow[] = [];

  body.forEach((cells, index) => {
    const line = index + offset;
    const skip = (reason: string): void => void prepared.push({ line, cells, entry: null, reason });

    if (wanted !== null && personKey(cell(cells, map.category)) !== wanted) {
      skip(`a different category (${cell(cells, map.category) || "blank"})`);
      return;
    }

    const playerOne = cell(cells, map.playerOne);
    if (!playerOne) {
      skip("no name in the name column");
      return;
    }

    const playerTwo = options.teamSize === 2 ? cell(cells, map.playerTwo) : "";
    if (options.teamSize === 2 && !playerTwo) {
      skip("a doubles category needs both names");
      return;
    }
    if (options.teamSize === 2 && personKey(playerOne) === personKey(playerTwo)) {
      skip("the same person entered as both halves of the pair");
      return;
    }

    const keys = [personKey(playerOne), ...(playerTwo ? [personKey(playerTwo)] : [])];
    const clash = keys.find((key) => taken.has(key));
    if (clash !== undefined) {
      skip("already entered in this category");
      return;
    }
    for (const key of keys) taken.add(key);

    prepared.push({
      line,
      cells,
      reason: null,
      entry: {
        playerOne,
        ...(playerTwo ? { playerTwo } : {}),
        ...(cell(cells, map.club) ? { club: cell(cells, map.club) } : {}),
        ...(cell(cells, map.phone) ? { phone: cell(cells, map.phone) } : {}),
      },
    });
  });

  return prepared;
}

/** The distinct answers a category column holds, for the filter dropdown. */
export function categoryOptions(
  rows: readonly (readonly string[])[],
  column: number | null,
  hasHeader: boolean,
): string[] {
  if (column === null) return [];
  const body = hasHeader ? rows.slice(1) : rows;
  const seen = new Map<string, string>();
  for (const cells of body) {
    const value = cell(cells, column);
    if (value && !seen.has(personKey(value))) seen.set(personKey(value), value);
  }
  return [...seen.values()];
}
