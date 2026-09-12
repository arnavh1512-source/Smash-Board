import { describe, expect, it } from "vitest";
import {
  capacityMessage,
  matchesForDraw,
  maxEntrantsFor,
  MAX_ENTRIES_PER_EVENT,
  MAX_MATCHES_PER_DRAW,
  type DrawShape,
} from "@/lib/capacity";
import { generateGroupsKnockout, generateKnockout, generateRoundRobin } from "@/lib/draw";

const BASE: DrawShape = {
  format: "knockout",
  groupCount: 8,
  advancePerGroup: 2,
  doubleRound: false,
  thirdPlace: true,
};

const field = (n: number): string[] => Array.from({ length: n }, (_, i) => `e${i}`);

/**
 * The count the guard uses has to be the count the generator produces.
 *
 * A guard that estimates is a guard that is wrong on the day somebody enters
 * the number it estimates badly, so the arithmetic is checked against the
 * generators themselves rather than against numbers written down here.
 */
describe("the predicted match count is the real one", () => {
  it("matches the knockout generator, with and without a third-place playoff", () => {
    for (const entrants of [2, 3, 5, 8, 17, 64, 129, 256]) {
      for (const thirdPlace of [false, true]) {
        const shape = { ...BASE, format: "knockout" as const, thirdPlace };
        const drawn = generateKnockout(field(entrants), { thirdPlace });
        expect(matchesForDraw(entrants, shape)).toBe(drawn.length);
      }
    }
  });

  it("matches the round robin generator, single and double", () => {
    for (const entrants of [2, 3, 6, 7, 12, 23, 32]) {
      for (const doubleRound of [false, true]) {
        const shape = { ...BASE, format: "round_robin" as const, doubleRound };
        const drawn = generateRoundRobin(field(entrants), 0, doubleRound);
        expect(matchesForDraw(entrants, shape)).toBe(drawn.length);
      }
    }
  });

  it("matches the group generator, including the uneven last group", () => {
    for (const groupCount of [1, 2, 4, 8]) {
      for (const entrants of [8, 9, 15, 32, 33, 60]) {
        if (entrants < groupCount * 2) continue;
        const shape = { ...BASE, format: "groups_knockout" as const, groupCount };
        const drawn = generateGroupsKnockout(field(entrants), {
          groupCount,
          advancePerGroup: shape.advancePerGroup,
          doubleRound: shape.doubleRound,
          thirdPlace: shape.thirdPlace,
        });
        expect(matchesForDraw(entrants, shape)).toBe(drawn.length);
      }
    }
  });
});

/**
 * The capacity matrix.
 *
 * The advertised maximum used to be 256 for every format, which is a promise
 * only the knockout can keep: the same field in a round robin is 32,640
 * matches. Each format now says what it can actually run.
 */
describe("every format's advertised maximum is one it can run", () => {
  const shapes: [string, DrawShape][] = [
    ["knockout", { ...BASE, format: "knockout" }],
    ["round robin", { ...BASE, format: "round_robin" }],
    ["double round robin", { ...BASE, format: "round_robin", doubleRound: true }],
    ["groups of two, eight groups", { ...BASE, format: "groups_knockout" }],
    ["groups played twice", { ...BASE, format: "groups_knockout", doubleRound: true }],
    ["one group, which is a round robin by another name", { ...BASE, format: "groups_knockout", groupCount: 1, advancePerGroup: 1 }],
  ];

  it.each(shapes)("%s stays inside the match budget at its maximum", (_name, shape) => {
    const allowed = maxEntrantsFor(shape);
    expect(allowed).toBeGreaterThanOrEqual(2);
    expect(matchesForDraw(allowed, shape)).toBeLessThanOrEqual(MAX_MATCHES_PER_DRAW);
  });

  it.each(shapes)("%s refuses the very next entrant", (_name, shape) => {
    const allowed = maxEntrantsFor(shape);
    if (allowed >= MAX_ENTRIES_PER_EVENT) return; // Knockout is capped by the entry list, not the budget.
    expect(matchesForDraw(allowed + 1, shape)).toBeGreaterThan(MAX_MATCHES_PER_DRAW);
  });

  it("keeps 256 for a knockout, which is the format that can hold it", () => {
    expect(maxEntrantsFor({ ...BASE, format: "knockout" })).toBe(MAX_ENTRIES_PER_EVENT);
    expect(matchesForDraw(256, { ...BASE, format: "knockout" })).toBe(256);
  });

  it("holds a round robin to 32, which is already 496 matches", () => {
    const shape: DrawShape = { ...BASE, format: "round_robin" };
    expect(maxEntrantsFor(shape)).toBe(32);
    expect(matchesForDraw(32, shape)).toBe(496);
    expect(matchesForDraw(33, shape)).toBe(528);
  });

  it("holds a double round robin lower still, because every pair plays twice", () => {
    const shape: DrawShape = { ...BASE, format: "round_robin", doubleRound: true };
    expect(maxEntrantsFor(shape)).toBe(23);
    expect(matchesForDraw(23, shape)).toBe(506);
  });

  it("lets a group stage hold far more than a flat round robin of the same size", () => {
    const groups = maxEntrantsFor({ ...BASE, format: "groups_knockout" });
    const flat = maxEntrantsFor({ ...BASE, format: "round_robin" });
    // Eight groups is eight small round robins, so the field can be much bigger.
    expect(groups).toBeGreaterThan(flat * 2);
  });

  it("grows the group maximum as the groups get more numerous", () => {
    const four = maxEntrantsFor({ ...BASE, format: "groups_knockout", groupCount: 4 });
    const sixteen = maxEntrantsFor({
      ...BASE,
      format: "groups_knockout",
      groupCount: 16,
      advancePerGroup: 1,
    });
    expect(sixteen).toBeGreaterThan(four);
  });
});

describe("what the organiser is told", () => {
  it("names the number a knockout can hold without a lecture", () => {
    expect(capacityMessage({ ...BASE, format: "knockout" })).toBe(
      "A category holds at most 256 entrants.",
    );
  });

  it("explains a round robin, because the number on its own looks arbitrary", () => {
    const message = capacityMessage({ ...BASE, format: "round_robin" });
    expect(message).toMatch(/round robin/);
    expect(message).toMatch(/32 entrants/);
    expect(message).toMatch(/496 matches/);
  });
});
