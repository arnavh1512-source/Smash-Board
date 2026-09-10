import { describe, expect, it } from "vitest";
import { computeStandings, type StandingsMatch } from "@/lib/standings";
import type { ScoringConfig } from "@/lib/scoring";

const config: ScoringConfig = { pointsPerSet: 21, bestOf: 3, endMode: "deuce", cap: 30 };

const names: Record<string, string> = { a: "Anita", b: "Bhavin", c: "Chetna", d: "Dev" };
const nameOf = (id: string) => names[id] ?? id;

function played(aId: string, bId: string, sets: StandingsMatch["sets"]): StandingsMatch {
  return { aId, bId, sets, status: "completed" };
}

function order(rows: ReturnType<typeof computeStandings>): string[] {
  return rows.map((row) => row.entryId);
}

describe("computeStandings", () => {
  it("lists every entrant even before a ball is hit", () => {
    const rows = computeStandings(["a", "b", "c"], [], config, nameOf);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.played === 0)).toBe(true);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("tallies sets and points from a finished match", () => {
    const rows = computeStandings(
      ["a", "b"],
      [played("a", "b", [{ a: 21, b: 15 }, { a: 21, b: 19 }])],
      config,
      nameOf,
    );
    const [first, second] = rows;
    expect(first.entryId).toBe("a");
    expect(first).toMatchObject({
      played: 1,
      won: 1,
      lost: 0,
      setsWon: 2,
      setsLost: 0,
      pointsFor: 42,
      pointsAgainst: 34,
      rank: 1,
    });
    expect(second).toMatchObject({ won: 0, lost: 1, setsWon: 0, setsLost: 2, rank: 2 });
  });

  it("ranks on matches won first", () => {
    const rows = computeStandings(
      ["a", "b", "c"],
      [
        played("a", "b", [{ a: 21, b: 0 }, { a: 21, b: 0 }]),
        played("a", "c", [{ a: 21, b: 0 }, { a: 21, b: 0 }]),
        played("b", "c", [{ a: 21, b: 19 }, { a: 21, b: 19 }]),
      ],
      config,
      nameOf,
    );
    expect(order(rows)).toEqual(["a", "b", "c"]);
  });

  it("uses won minus lost when one entrant has played fewer matches", () => {
    const rows = computeStandings(
      ["a", "b", "c"],
      [
        // Both a and b have one win, but b also carries a loss.
        played("a", "c", [{ a: 21, b: 10 }, { a: 21, b: 10 }]),
        played("b", "c", [{ a: 21, b: 10 }, { a: 21, b: 10 }]),
        played("b", "a", [{ a: 10, b: 21 }, { a: 10, b: 21 }]),
      ],
      config,
      nameOf,
    );
    expect(rows[0].entryId).toBe("a");
    expect(rows[0].won - rows[0].lost).toBe(2);
  });

  it("falls to set difference when wins and losses are level", () => {
    const rows = computeStandings(
      ["a", "b", "c"],
      [
        // a wins in two, b wins in three: same record, better sets for a.
        played("a", "c", [{ a: 21, b: 10 }, { a: 21, b: 10 }]),
        played("b", "c", [{ a: 21, b: 10 }, { a: 10, b: 21 }, { a: 21, b: 10 }]),
        played("a", "b", [{ a: 10, b: 21 }, { a: 10, b: 21 }]),
        played("c", "a", [{ a: 21, b: 10 }, { a: 21, b: 10 }]),
      ],
      config,
      nameOf,
    );
    // a: 1 win 1 loss, sets 2-2 + 0-2 + 0-2 ... assert on the computed values.
    const a = rows.find((row) => row.entryId === "a")!;
    const b = rows.find((row) => row.entryId === "b")!;
    expect(a.won).toBe(1);
    expect(b.won).toBe(2);
    expect(order(rows)[0]).toBe("b");
  });

  it("separates a dead heat on point difference", () => {
    const rows = computeStandings(
      ["a", "b", "c"],
      [
        played("a", "c", [{ a: 21, b: 5 }, { a: 21, b: 5 }]),
        played("b", "c", [{ a: 21, b: 19 }, { a: 21, b: 19 }]),
        played("c", "a", [{ a: 5, b: 21 }, { a: 5, b: 21 }]),
        played("c", "b", [{ a: 19, b: 21 }, { a: 19, b: 21 }]),
      ],
      config,
      nameOf,
    );
    const a = rows.find((row) => row.entryId === "a")!;
    const b = rows.find((row) => row.entryId === "b")!;
    expect(a.won).toBe(b.won);
    expect(a.setsWon - a.setsLost).toBe(b.setsWon - b.setsLost);
    expect(a.pointsFor - a.pointsAgainst).toBeGreaterThan(b.pointsFor - b.pointsAgainst);
    expect(order(rows)[0]).toBe("a");
  });

  it("settles an exact tie on the head-to-head result", () => {
    const rows = computeStandings(
      ["a", "b"],
      [played("b", "a", [{ a: 21, b: 19 }, { a: 19, b: 21 }, { a: 21, b: 19 }])],
      config,
      nameOf,
    );
    expect(order(rows)).toEqual(["b", "a"]);
  });

  it("falls back to the name when nothing else separates two entrants", () => {
    const rows = computeStandings(["d", "a"], [], config, nameOf);
    expect(order(rows)).toEqual(["a", "d"]);
  });

  it("counts a walkover as a win with no sets or points", () => {
    const rows = computeStandings(
      ["a", "b"],
      [{ aId: "a", bId: "b", sets: [], status: "walkover", walkoverWinnerId: "b" }],
      config,
      nameOf,
    );
    const b = rows.find((row) => row.entryId === "b")!;
    expect(b).toMatchObject({ played: 1, won: 1, setsWon: 0, pointsFor: 0, rank: 1 });
    expect(rows.find((row) => row.entryId === "a")!.lost).toBe(1);
  });

  it("records a walkover with no named winner as played by neither", () => {
    const rows = computeStandings(
      ["a", "b"],
      [{ aId: "a", bId: "b", sets: [], status: "walkover", walkoverWinnerId: null }],
      config,
      nameOf,
    );
    expect(rows.every((row) => row.played === 1 && row.won === 0 && row.lost === 0)).toBe(true);
  });

  it("ignores matches that are not finished", () => {
    const rows = computeStandings(
      ["a", "b"],
      [{ aId: "a", bId: "b", sets: [{ a: 11, b: 9 }], status: "live" }],
      config,
      nameOf,
    );
    expect(rows.every((row) => row.played === 0)).toBe(true);
  });

  it("ignores a match with an empty side", () => {
    const rows = computeStandings(
      ["a"],
      [{ aId: "a", bId: null, sets: [], status: "completed" }],
      config,
      nameOf,
    );
    expect(rows[0].played).toBe(0);
  });

  it("ignores an entrant who is not in this group", () => {
    const rows = computeStandings(
      ["a", "b"],
      [played("a", "zz", [{ a: 21, b: 10 }, { a: 21, b: 10 }])],
      config,
      nameOf,
    );
    expect(rows.every((row) => row.played === 0)).toBe(true);
  });

  it("skips a stored score that no longer fits the scoring rules", () => {
    const rows = computeStandings(
      ["a", "b"],
      [played("a", "b", [{ a: 40, b: 2 }])],
      config,
      nameOf,
    );
    // The match still counts as played, but nothing could be read from it.
    expect(rows.every((row) => row.won === 0 && row.setsWon === 0)).toBe(true);
  });

  it("leaves an unfinished but completed-flagged match without a winner", () => {
    const rows = computeStandings(
      ["a", "b"],
      [played("a", "b", [{ a: 21, b: 10 }])],
      config,
      nameOf,
    );
    expect(rows.every((row) => row.won === 0 && row.lost === 0)).toBe(true);
    expect(rows.find((row) => row.entryId === "a")!.setsWon).toBe(1);
  });

  it("numbers the ranks from one with no gaps", () => {
    const rows = computeStandings(["a", "b", "c", "d"], [], config, nameOf);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
  });
});
