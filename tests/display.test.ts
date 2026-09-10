import { describe, expect, it } from "vitest";
import type { Doc } from "../convex/_generated/dataModel";
import { STATUS_LABELS, entryName, scoringSummary, sideName } from "@/lib/display";
import type { ScoringConfig } from "@/lib/scoring";

const singles = { playerOne: "Anita Rao" } as Doc<"entries">;
const doubles = { playerOne: "Anita Rao", playerTwo: "Priya Shah" } as Doc<"entries">;

describe("entryName", () => {
  it("returns the single player", () => {
    expect(entryName(singles)).toBe("Anita Rao");
  });

  it("joins a doubles pair with a slash", () => {
    expect(entryName(doubles)).toBe("Anita Rao / Priya Shah");
  });

  it("returns an empty string for a missing entrant", () => {
    expect(entryName(null)).toBe("");
    expect(entryName(undefined)).toBe("");
  });
});

describe("sideName", () => {
  it("prefers the entrant over the label", () => {
    expect(sideName(singles, "Winner of Semi-final 1")).toBe("Anita Rao");
  });

  it("falls back to the draw label", () => {
    expect(sideName(undefined, "BYE")).toBe("BYE");
  });

  it("has a last resort when there is neither", () => {
    expect(sideName(undefined, null)).toBe("To be decided");
  });
});

describe("scoringSummary", () => {
  const base: ScoringConfig = { pointsPerSet: 21, bestOf: 3, endMode: "deuce", cap: 30 };

  it("describes the BWF default", () => {
    expect(scoringSummary(base)).toBe("21 points, best of 3, deuce, cap 30");
  });

  it("describes a single game", () => {
    expect(scoringSummary({ ...base, bestOf: 1 })).toBe("21 points, single game, deuce, cap 30");
  });

  it("describes an uncapped deuce", () => {
    expect(scoringSummary({ ...base, cap: null })).toBe("21 points, best of 3, deuce, no cap");
  });

  it("describes golden point", () => {
    expect(scoringSummary({ pointsPerSet: 11, bestOf: 1, endMode: "golden", cap: null })).toBe(
      "11 points, single game, golden point",
    );
  });
});

describe("STATUS_LABELS", () => {
  it("covers every match status", () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([
      "completed",
      "live",
      "scheduled",
      "walkover",
    ]);
  });
});

