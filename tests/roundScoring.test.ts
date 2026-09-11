import { describe, expect, it } from "vitest";
import { countKnockoutRounds, DrawError, validateGroupsKnockout } from "@/lib/draw";
import { scoringForRound, type RoundScoring, type ScoringConfig } from "@/lib/scoring";

const base: ScoringConfig = { pointsPerSet: 21, bestOf: 1, endMode: "deuce", cap: 30 };
const bestOfThree: ScoringConfig = { pointsPerSet: 21, bestOf: 3, endMode: "deuce", cap: 30 };
const golden: ScoringConfig = { pointsPerSet: 15, bestOf: 1, endMode: "golden", cap: null };

function match(round: number, stage = "knockout", isThirdPlace = false) {
  return { stage, round, isThirdPlace };
}

describe("scoringForRound", () => {
  const event: RoundScoring = {
    scoring: base,
    semiFinalScoring: golden,
    finalScoring: bestOfThree,
  };

  // A four-round bracket: 0 = last 16, 1 = quarters, 2 = semis, 3 = final.
  it("uses the category rules for the early rounds", () => {
    expect(scoringForRound(event, match(0), 4)).toBe(base);
    expect(scoringForRound(event, match(1), 4)).toBe(base);
  });

  it("uses the semi-final override one round from the end", () => {
    expect(scoringForRound(event, match(2), 4)).toBe(golden);
  });

  it("uses the final override in the last round", () => {
    expect(scoringForRound(event, match(3), 4)).toBe(bestOfThree);
  });

  it("plays the third-place match to the final's rules", () => {
    // The playoff sits in the same round as the final, so it inherits it.
    expect(scoringForRound(event, match(3, "knockout", true), 4)).toBe(bestOfThree);
  });

  it("leaves group matches on the category rules", () => {
    expect(scoringForRound(event, match(0, "group"), 4)).toBe(base);
  });

  it("falls back to the category rules when no override is set", () => {
    const plain: RoundScoring = { scoring: base, semiFinalScoring: null, finalScoring: null };
    expect(scoringForRound(plain, match(3), 4)).toBe(base);
    expect(scoringForRound(plain, match(2), 4)).toBe(base);
  });

  it("treats the only round of a two-entrant draw as the final", () => {
    expect(scoringForRound(event, match(0), 1)).toBe(bestOfThree);
  });

  it("returns the category rules when there is no knockout at all", () => {
    expect(scoringForRound(event, match(0), 0)).toBe(base);
  });
});

describe("countKnockoutRounds", () => {
  it("is zero without a knockout stage", () => {
    expect(countKnockoutRounds([])).toBe(0);
    expect(countKnockoutRounds([match(0, "group")])).toBe(0);
  });

  it("counts the highest round, ignoring the third-place playoff", () => {
    const bracket = [match(0), match(1), match(2), match(2, "knockout", true)];
    expect(countKnockoutRounds(bracket)).toBe(3);
  });
});

describe("validateGroupsKnockout", () => {
  it("accepts a workable configuration", () => {
    expect(() =>
      validateGroupsKnockout(16, { groupCount: 4, advancePerGroup: 2 }),
    ).not.toThrow();
  });

  it("refuses to qualify more entrants than are entered", () => {
    // Four groups of four cannot send three each into a knockout of sixteen.
    expect(() => validateGroupsKnockout(8, { groupCount: 4, advancePerGroup: 3 })).toThrow(
      DrawError,
    );
  });

  it("refuses more groups than entrants", () => {
    expect(() => validateGroupsKnockout(3, { groupCount: 4, advancePerGroup: 1 })).toThrow(
      DrawError,
    );
  });

  it("refuses nonsense counts", () => {
    expect(() => validateGroupsKnockout(16, { groupCount: 0, advancePerGroup: 2 })).toThrow(
      DrawError,
    );
    expect(() => validateGroupsKnockout(16, { groupCount: 4, advancePerGroup: 0 })).toThrow(
      DrawError,
    );
    expect(() => validateGroupsKnockout(16, { groupCount: 2.5, advancePerGroup: 2 })).toThrow(
      DrawError,
    );
  });
});
