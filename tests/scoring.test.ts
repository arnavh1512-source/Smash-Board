import { describe, expect, it } from "vitest";
import {
  addPoint,
  DEFAULT_SCORING,
  evaluateMatch,
  SCORING_PRESETS,
  ScoringError,
  setsToWin,
  setWinner,
  undoPointForSide,
  validateConfig,
  type ScoringConfig,
} from "@/lib/scoring";

const bwf: ScoringConfig = { pointsPerSet: 21, bestOf: 3, endMode: "deuce", cap: 30 };
const golden: ScoringConfig = { pointsPerSet: 11, bestOf: 1, endMode: "golden", cap: null };
const uncapped: ScoringConfig = { pointsPerSet: 15, bestOf: 3, endMode: "deuce", cap: null };

describe("validateConfig", () => {
  it("accepts every preset shipped in the UI", () => {
    for (const preset of SCORING_PRESETS) {
      expect(() => validateConfig(preset.config)).not.toThrow();
    }
  });

  it("rejects a non-integer points target", () => {
    expect(() => validateConfig({ ...bwf, pointsPerSet: 20.5 })).toThrow(ScoringError);
  });

  it("rejects a points target outside 1-99", () => {
    expect(() => validateConfig({ ...bwf, pointsPerSet: 0 })).toThrow(ScoringError);
    expect(() => validateConfig({ ...bwf, pointsPerSet: 100 })).toThrow(ScoringError);
  });

  it("rejects an even or unsupported number of sets", () => {
    expect(() => validateConfig({ ...bwf, bestOf: 2 })).toThrow(ScoringError);
    expect(() => validateConfig({ ...bwf, bestOf: 9 })).toThrow(ScoringError);
  });

  it("rejects an unknown end mode", () => {
    expect(() =>
      validateConfig({ ...bwf, endMode: "sudden" as ScoringConfig["endMode"] }),
    ).toThrow(ScoringError);
  });

  it("rejects a cap at or below the points target", () => {
    expect(() => validateConfig({ ...bwf, cap: 21 })).toThrow(ScoringError);
    expect(() => validateConfig({ ...bwf, cap: 20 })).toThrow(ScoringError);
    expect(() => validateConfig({ ...bwf, cap: 24.5 })).toThrow(ScoringError);
  });

  it("allows deuce with no cap", () => {
    expect(() => validateConfig(uncapped)).not.toThrow();
  });
});

describe("setWinner under deuce", () => {
  it("returns null while both sides are short of the target", () => {
    expect(setWinner({ a: 20, b: 19 }, bwf)).toBeNull();
  });

  it("awards the set on reaching the target two clear", () => {
    expect(setWinner({ a: 21, b: 19 }, bwf)).toBe("a");
    expect(setWinner({ a: 15, b: 21 }, bwf)).toBe("b");
  });

  it("keeps the set alive at one point clear past the target", () => {
    expect(setWinner({ a: 22, b: 21 }, bwf)).toBeNull();
  });

  it("awards the set two clear in a deuce", () => {
    expect(setWinner({ a: 24, b: 22 }, bwf)).toBe("a");
  });

  it("awards the set to whoever reaches the cap first", () => {
    expect(setWinner({ a: 30, b: 29 }, bwf)).toBe("a");
    expect(setWinner({ a: 29, b: 30 }, bwf)).toBe("b");
  });

  it("never decides a level score", () => {
    expect(setWinner({ a: 29, b: 29 }, bwf)).toBeNull();
  });

  it("rejects a score past the cap", () => {
    expect(() => setWinner({ a: 31, b: 29 }, bwf)).toThrow(ScoringError);
  });

  it("rejects an impossible gap past the target", () => {
    expect(() => setWinner({ a: 25, b: 10 }, bwf)).toThrow(ScoringError);
  });

  it("rejects negative or fractional scores", () => {
    expect(() => setWinner({ a: -1, b: 5 }, bwf)).toThrow(ScoringError);
    expect(() => setWinner({ a: 3.5, b: 5 }, bwf)).toThrow(ScoringError);
  });

  it("runs a deuce forever when there is no cap", () => {
    expect(setWinner({ a: 40, b: 39 }, uncapped)).toBeNull();
    expect(setWinner({ a: 41, b: 39 }, uncapped)).toBe("a");
  });
});

describe("setWinner under golden point", () => {
  it("decides exactly on the target", () => {
    expect(setWinner({ a: 11, b: 10 }, golden)).toBe("a");
    expect(setWinner({ a: 4, b: 11 }, golden)).toBe("b");
  });

  it("returns null before the target", () => {
    expect(setWinner({ a: 10, b: 10 }, golden)).toBeNull();
  });

  it("rejects any score past the target", () => {
    expect(() => setWinner({ a: 12, b: 10 }, golden)).toThrow(ScoringError);
  });

  it("rejects a level score at the target", () => {
    expect(() => setWinner({ a: 11, b: 11 }, golden)).toThrow(ScoringError);
  });
});

describe("setsToWin", () => {
  it("matches the best-of format", () => {
    expect(setsToWin({ ...bwf, bestOf: 1 })).toBe(1);
    expect(setsToWin({ ...bwf, bestOf: 3 })).toBe(2);
    expect(setsToWin({ ...bwf, bestOf: 5 })).toBe(3);
    expect(setsToWin({ ...bwf, bestOf: 7 })).toBe(4);
  });
});

describe("evaluateMatch", () => {
  it("reports an empty match as undecided", () => {
    const outcome = evaluateMatch([], bwf);
    expect(outcome.winner).toBeNull();
    expect(outcome.complete).toBe(false);
  });

  it("counts sets and points across a finished match", () => {
    const outcome = evaluateMatch(
      [
        { a: 21, b: 18 },
        { a: 19, b: 21 },
        { a: 21, b: 15 },
      ],
      bwf,
    );
    expect(outcome.setsWon).toEqual({ a: 2, b: 1 });
    expect(outcome.points).toEqual({ a: 61, b: 54 });
    expect(outcome.winner).toBe("a");
    expect(outcome.complete).toBe(true);
  });

  it("counts a partial match without declaring a winner", () => {
    const outcome = evaluateMatch([{ a: 21, b: 18 }, { a: 11, b: 9 }], bwf);
    expect(outcome.setsWon).toEqual({ a: 1, b: 0 });
    expect(outcome.winner).toBeNull();
  });

  it("rejects more sets than the format allows", () => {
    expect(() =>
      evaluateMatch([{ a: 21, b: 0 }, { a: 21, b: 0 }, { a: 21, b: 0 }, { a: 21, b: 0 }], bwf),
    ).toThrow(ScoringError);
  });

  it("rejects a set played after the match was already won", () => {
    expect(() =>
      evaluateMatch([{ a: 21, b: 0 }, { a: 21, b: 0 }, { a: 21, b: 0 }], bwf),
    ).toThrow(ScoringError);
  });

  it("rejects an unfinished set followed by another set", () => {
    expect(() => evaluateMatch([{ a: 10, b: 9 }, { a: 21, b: 0 }], bwf)).toThrow(ScoringError);
  });

  it("decides a single-set match on one set", () => {
    const outcome = evaluateMatch([{ a: 11, b: 7 }], golden);
    expect(outcome.winner).toBe("a");
    expect(outcome.complete).toBe(true);
  });

  it("needs three sets in a best of five", () => {
    const config: ScoringConfig = { pointsPerSet: 11, bestOf: 5, endMode: "deuce", cap: 15 };
    const outcome = evaluateMatch(
      [
        { a: 11, b: 5 },
        { a: 5, b: 11 },
        { a: 11, b: 9 },
        { a: 11, b: 8 },
      ],
      config,
    );
    expect(outcome.winner).toBe("a");
    expect(outcome.setsWon).toEqual({ a: 3, b: 1 });
  });

  it("propagates a bad config", () => {
    expect(() => evaluateMatch([], { ...bwf, bestOf: 4 })).toThrow(ScoringError);
  });
});

describe("addPoint", () => {
  it("opens the first set", () => {
    expect(addPoint([], "a", bwf)).toEqual([{ a: 1, b: 0 }]);
  });

  it("adds to the set in progress", () => {
    expect(addPoint([{ a: 5, b: 3 }], "b", bwf)).toEqual([{ a: 5, b: 4 }]);
  });

  it("opens a new set once the previous one is decided", () => {
    expect(addPoint([{ a: 21, b: 15 }], "b", bwf)).toEqual([
      { a: 21, b: 15 },
      { a: 0, b: 1 },
    ]);
  });

  it("never mutates the sets it was given", () => {
    const sets = [{ a: 5, b: 3 }];
    addPoint(sets, "a", bwf);
    expect(sets).toEqual([{ a: 5, b: 3 }]);
  });

  it("refuses to score a completed match", () => {
    expect(() => addPoint([{ a: 21, b: 0 }, { a: 21, b: 0 }], "a", bwf)).toThrow(ScoringError);
  });
});

describe("undoPointForSide", () => {
  it("takes a point back", () => {
    expect(undoPointForSide([{ a: 5, b: 3 }], "a")).toEqual([{ a: 4, b: 3 }]);
  });

  it("does nothing at zero", () => {
    expect(undoPointForSide([{ a: 0, b: 3 }], "a")).toEqual([{ a: 0, b: 3 }]);
  });

  it("does nothing on an empty match", () => {
    expect(undoPointForSide([], "a")).toEqual([]);
  });

  it("collapses a set that falls back to 0-0", () => {
    expect(undoPointForSide([{ a: 21, b: 15 }, { a: 1, b: 0 }], "a")).toEqual([{ a: 21, b: 15 }]);
  });

  it("keeps the only set even at 0-0", () => {
    expect(undoPointForSide([{ a: 1, b: 0 }], "a")).toEqual([{ a: 0, b: 0 }]);
  });

  it("never mutates the sets it was given", () => {
    const sets = [{ a: 5, b: 3 }];
    undoPointForSide(sets, "a");
    expect(sets).toEqual([{ a: 5, b: 3 }]);
  });
});

describe("DEFAULT_SCORING", () => {
  it("is the BWF standard", () => {
    expect(DEFAULT_SCORING).toEqual({
      pointsPerSet: 21,
      bestOf: 3,
      endMode: "deuce",
      cap: 30,
    });
  });
});
