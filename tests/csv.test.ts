import { describe, expect, it } from "vitest";
import {
  categoryOptions,
  detectDelimiter,
  guessColumns,
  parseDelimited,
  prepareRows,
  type ColumnMap,
} from "@/lib/csv";

/**
 * Reading a real response sheet.
 *
 * These tests are written against the shapes a Google Form actually produces —
 * a timestamp column nobody asked for, question text as headings, answers with
 * commas and quotes in them, a sheet pasted out of the browser as tabs — and
 * against the ways an organiser gets it wrong: the same person submitting
 * twice, a doubles player who left the partner box empty, one form collecting
 * four categories at once.
 */

const HEADERS = ["Timestamp", "Email address", "Your name", "Partner's name", "Club", "Phone"];

function sheet(...rows: string[]): string {
  return [HEADERS.join(","), ...rows].join("\n");
}

const MAP: ColumnMap = { playerOne: 2, playerTwo: 3, club: 4, phone: 5, category: null };

describe("detectDelimiter", () => {
  it("reads a downloaded CSV as commas", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });

  it("reads a selection pasted out of the browser as tabs", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("reads a semicolon sheet from a European locale", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
  });

  it("falls back to commas when there is only one column", () => {
    expect(detectDelimiter("Anita Rao\nPriya Shah")).toBe(",");
  });
});

describe("parseDelimited", () => {
  it("keeps a comma that is inside a quoted answer", () => {
    const rows = parseDelimited('name,club\n"Shah, Arnav","Ahmedabad SC, Gujarat"');
    expect(rows[1]).toEqual(["Shah, Arnav", "Ahmedabad SC, Gujarat"]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseDelimited('name\n"Arnav ""Ace"" Shah"')[1]).toEqual(['Arnav "Ace" Shah']);
  });

  it("keeps a line break that is inside a quoted answer", () => {
    const rows = parseDelimited('name,notes\nAnita Rao,"line one\nline two"');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe("line one\nline two");
  });

  it("survives Windows line endings, a trailing newline and a blank row", () => {
    const rows = parseDelimited("name\r\nAnita Rao\r\n\r\nPriya Shah\r\n");
    expect(rows).toEqual([["name"], ["Anita Rao"], ["Priya Shah"]]);
  });

  it("drops the byte order mark a downloaded file starts with", () => {
    expect(parseDelimited("﻿Timestamp,name")[0][0]).toBe("Timestamp");
  });

  it("trims the padding a spreadsheet leaves around a cell", () => {
    expect(parseDelimited("name , club \n Anita Rao , Ahmedabad SC ")[1]).toEqual([
      "Anita Rao",
      "Ahmedabad SC",
    ]);
  });
});

describe("guessColumns", () => {
  it("finds the ordinary Google Form headings", () => {
    expect(guessColumns(HEADERS)).toEqual({
      playerOne: 2,
      playerTwo: 3,
      club: 4,
      phone: 5,
      category: null,
    });
  });

  it("never mistakes the timestamp or the email address for a name", () => {
    const guess = guessColumns(["Timestamp", "Email address", "Full name"]);
    expect(guess.playerOne).toBe(2);
  });

  it("falls back to the first column that is not machinery", () => {
    const guess = guessColumns(["Timestamp", "Email address", "Who is playing"]);
    expect(guess.playerOne).toBe(2);
  });

  it("finds the category question when one form covers the tournament", () => {
    const guess = guessColumns(["Name", "Which event are you entering?"]);
    expect(guess.category).toBe(1);
  });

  it("does not offer the name column as the partner column too", () => {
    // "Player" matches both lists; the partner would otherwise be the entrant.
    const guess = guessColumns(["Timestamp", "Player"]);
    expect(guess.playerOne).toBe(1);
    expect(guess.playerTwo).toBeNull();
  });
});

describe("prepareRows", () => {
  const rows = (text: string) => parseDelimited(text);

  it("reads an ordinary doubles sheet", () => {
    const prepared = prepareRows(
      rows(sheet("12/09/2026,a@b.com,Anita Rao,Priya Shah,Ahmedabad SC,9876543210")),
      MAP,
      { teamSize: 2, hasHeader: true },
    );
    expect(prepared).toHaveLength(1);
    expect(prepared[0].entry).toEqual({
      playerOne: "Anita Rao",
      playerTwo: "Priya Shah",
      club: "Ahmedabad SC",
      phone: "9876543210",
    });
  });

  it("skips the heading row without being told twice", () => {
    const prepared = prepareRows(rows(sheet("12/09/2026,a@b.com,Anita Rao,Priya Shah,,")), MAP, {
      teamSize: 2,
      hasHeader: true,
    });
    expect(prepared.map((row) => row.entry?.playerOne)).toEqual(["Anita Rao"]);
    // Numbered as the spreadsheet numbers it, so "row 2" means row 2.
    expect(prepared[0].line).toBe(2);
  });

  it("leaves out a club or phone that was never answered", () => {
    const prepared = prepareRows(rows(sheet("12/09/2026,a@b.com,Rohan Mehta,,,")), MAP, {
      teamSize: 1,
      hasHeader: true,
    });
    expect(prepared[0].entry).toEqual({ playerOne: "Rohan Mehta" });
  });

  it("refuses a doubles row whose partner box was left empty", () => {
    const prepared = prepareRows(rows(sheet("12/09/2026,a@b.com,Anita Rao,,,")), MAP, {
      teamSize: 2,
      hasHeader: true,
    });
    expect(prepared[0].entry).toBeNull();
    expect(prepared[0].reason).toMatch(/both names/);
  });

  it("ignores the partner column in a singles category", () => {
    const prepared = prepareRows(rows(sheet("12/09/2026,a@b.com,Rohan Mehta,Dev Patel,,")), MAP, {
      teamSize: 1,
      hasHeader: true,
    });
    expect(prepared[0].entry).toEqual({ playerOne: "Rohan Mehta" });
  });

  it("refuses a pair that is the same person typed twice", () => {
    const prepared = prepareRows(rows(sheet("12/09/2026,a@b.com,Anita Rao,anita  rao,,")), MAP, {
      teamSize: 2,
      hasHeader: true,
    });
    expect(prepared[0].reason).toMatch(/same person/);
  });

  it("says which row had no name at all", () => {
    const prepared = prepareRows(rows(sheet("12/09/2026,a@b.com,,Priya Shah,,")), MAP, {
      teamSize: 2,
      hasHeader: true,
    });
    expect(prepared[0].reason).toMatch(/no name/);
    expect(prepared[0].line).toBe(2);
  });

  it("skips somebody the form was filled in for twice", () => {
    const prepared = prepareRows(
      rows(
        sheet(
          "12/09/2026,a@b.com,Rohan Mehta,,,",
          "12/09/2026,a@b.com,rohan   MEHTA,,,",
          "12/09/2026,a@b.com,Dev Patel,,,",
        ),
      ),
      MAP,
      { teamSize: 1, hasHeader: true },
    );
    expect(prepared.map((row) => row.reason)).toEqual([null, "already entered in this category", null]);
  });

  it("skips somebody who is already in the category", () => {
    const prepared = prepareRows(rows(sheet("12/09/2026,a@b.com,Rohan Mehta,,,")), MAP, {
      teamSize: 1,
      hasHeader: true,
      existingKeys: ["rohan mehta"],
    });
    expect(prepared[0].reason).toMatch(/already entered/);
  });

  it("catches a duplicate that is hiding in the partner half of a pair", () => {
    const prepared = prepareRows(
      rows(
        sheet(
          "12/09/2026,a@b.com,Anita Rao,Priya Shah,,",
          "12/09/2026,a@b.com,Meera Iyer,Priya Shah,,",
        ),
      ),
      MAP,
      { teamSize: 2, hasHeader: true },
    );
    expect(prepared[1].reason).toMatch(/already entered/);
  });

  it("takes only the rows that answered this category", () => {
    const withCategory: ColumnMap = { ...MAP, category: 6 };
    const text = [
      [...HEADERS, "Event"].join(","),
      "12/09/2026,a@b.com,Rohan Mehta,,,,Mens Singles",
      "12/09/2026,a@b.com,Anita Rao,,,,Womens Singles",
      "12/09/2026,a@b.com,Dev Patel,,,,mens  singles ",
    ].join("\n");
    const prepared = prepareRows(rows(text), withCategory, {
      teamSize: 1,
      hasHeader: true,
      categoryFilter: "Mens Singles",
    });
    expect(prepared.filter((row) => row.entry).map((row) => row.entry!.playerOne)).toEqual([
      "Rohan Mehta",
      "Dev Patel",
    ]);
    expect(prepared[1].reason).toMatch(/different category/);
  });

  it("reads a sheet with no heading row at all", () => {
    const prepared = prepareRows(rows("Rohan Mehta\nDev Patel"), { ...MAP, playerOne: 0 }, {
      teamSize: 1,
      hasHeader: false,
    });
    expect(prepared.map((row) => row.entry?.playerOne)).toEqual(["Rohan Mehta", "Dev Patel"]);
    expect(prepared[0].line).toBe(1);
  });

  it("does not fall over when a row is shorter than the headings", () => {
    const prepared = prepareRows(rows(sheet("12/09/2026,a@b.com,Rohan Mehta")), MAP, {
      teamSize: 1,
      hasHeader: true,
    });
    expect(prepared[0].entry).toEqual({ playerOne: "Rohan Mehta" });
  });
});

describe("categoryOptions", () => {
  it("lists each answer once, in the spelling it was first given", () => {
    const text = [
      "Name,Event",
      "Rohan Mehta,Mens Singles",
      "Dev Patel,mens singles",
      "Anita Rao,Womens Singles",
    ].join("\n");
    expect(categoryOptions(parseDelimited(text), 1, true)).toEqual([
      "Mens Singles",
      "Womens Singles",
    ]);
  });

  it("has nothing to offer when the sheet has no category column", () => {
    expect(categoryOptions(parseDelimited("Name\nRohan Mehta"), null, true)).toEqual([]);
  });
});
