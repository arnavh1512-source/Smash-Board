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

describe("the combinations the category form can actually produce", () => {
  /**
   * The product lets an organiser pick any target from 1 to 99, best of 1, 3, 5
   * or 7, and either ending. The engine is one function, so this is a
   * representative matrix rather than every permutation: for each combination,
   * play the shortest winning match, check the winner and the set count, and
   * check that one set fewer is still undecided.
   */
  const matrix: { label: string; config: ScoringConfig }[] = [
    { label: "11 golden, best of 5", config: { pointsPerSet: 11, bestOf: 5, endMode: "golden", cap: null } },
    { label: "15 deuce capped at 21, best of 5", config: { pointsPerSet: 15, bestOf: 5, endMode: "deuce", cap: 21 } },
    { label: "21 deuce capped at 30, best of 5", config: { pointsPerSet: 21, bestOf: 5, endMode: "deuce", cap: 30 } },
    { label: "11 deuce uncapped, best of 7", config: { pointsPerSet: 11, bestOf: 7, endMode: "deuce", cap: null } },
    { label: "17 golden, single set", config: { pointsPerSet: 17, bestOf: 1, endMode: "golden", cap: null } },
    { label: "17 golden, best of 3", config: { pointsPerSet: 17, bestOf: 3, endMode: "golden", cap: null } },
  ];

  for (const { label, config } of matrix) {
    it(`decides a ${label} match on the last set it is allowed`, () => {
      const needed = setsToWin(config);
      expect(needed).toBe((config.bestOf + 1) / 2);

      const set = { a: config.pointsPerSet, b: Math.max(0, config.pointsPerSet - 2) };
      const winning = Array.from({ length: needed }, () => ({ ...set }));

      const outcome = evaluateMatch(winning, config);
      expect(outcome.winner).toBe("a");
      expect(outcome.setsWon).toEqual({ a: needed, b: 0 });
      expect(outcome.points.a).toBe(set.a * needed);

      // One set short of the target is a match still being played, not a win.
      if (needed > 1) {
        const short = evaluateMatch(winning.slice(0, needed - 1), config);
        expect(short.winner).toBeNull();
        expect(short.complete).toBe(false);
      }
    });

    it(`refuses a ${label} match that runs past its decider`, () => {
      const needed = setsToWin(config);
      const set = { a: config.pointsPerSet, b: Math.max(0, config.pointsPerSet - 2) };
      const tooMany = Array.from({ length: needed + 1 }, () => ({ ...set }));
      expect(() => evaluateMatch(tooMany, config)).toThrow(ScoringError);
    });

    it(`plays a ${label} match out point by point to the same answer`, () => {
      let sets: { a: number; b: number }[] = [];
      for (let guard = 0; guard < 1_000; guard += 1) {
        if (evaluateMatch(sets, config).complete) break;
        sets = addPoint(sets, "a", config);
      }
      const outcome = evaluateMatch(sets, config);
      expect(outcome.winner).toBe("a");
      expect(outcome.setsWon.a).toBe(setsToWin(config));
      expect(() => addPoint(sets, "a", config)).toThrow(ScoringError);
    });
  }

  it("takes a five-set best of five the distance", () => {
    const config: ScoringConfig = { pointsPerSet: 15, bestOf: 5, endMode: "golden", cap: null };
    const a = { a: 15, b: 13 };
    const b = { a: 13, b: 15 };
    const outcome = evaluateMatch([a, b, a, b, a], config);
    expect(outcome.winner).toBe("a");
    expect(outcome.setsWon).toEqual({ a: 3, b: 2 });
    expect(outcome.points).toEqual({ a: 71, b: 69 });
  });

  it("takes a seven-set best of seven the distance", () => {
    const config: ScoringConfig = { pointsPerSet: 11, bestOf: 7, endMode: "deuce", cap: null };
    const a = { a: 11, b: 9 };
    const b = { a: 9, b: 11 };
    const outcome = evaluateMatch([a, b, a, b, a, b, a], config);
    expect(outcome.winner).toBe("a");
    expect(outcome.setsWon).toEqual({ a: 4, b: 3 });
  });

  it("holds a deuce set open past its target and closes it on the cap", () => {
    const config: ScoringConfig = { pointsPerSet: 15, bestOf: 5, endMode: "deuce", cap: 21 };
    expect(setWinner({ a: 15, b: 14 }, config)).toBeNull();
    expect(setWinner({ a: 16, b: 14 }, config)).toBe("a");
    expect(setWinner({ a: 21, b: 20 }, config)).toBe("a");
    expect(() => evaluateMatch([{ a: 22, b: 20 }], config)).toThrow(ScoringError);
  });

  it("ends a golden set on the target with no run-on", () => {
    const config: ScoringConfig = { pointsPerSet: 17, bestOf: 3, endMode: "golden", cap: null };
    expect(setWinner({ a: 17, b: 16 }, config)).toBe("a");
    expect(() => evaluateMatch([{ a: 18, b: 16 }], config)).toThrow(ScoringError);
  });
});
