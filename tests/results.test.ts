import { describe, expect, it } from "vitest";
import { hasPlayedResult, isBye } from "@/lib/results";

/**
 * A bye, a withdrawal and a no-show all end as a walkover, so the board has to
 * tell them apart by who is on the draw and what the empty side is labelled.
 * The shapes here are the ones the generator and `vacateSide` actually write.
 */

const played = { sets: [{ a: 21, b: 15 }], status: "completed", aId: "a", bId: "b" };

const bye = { status: "walkover", aId: "a", bId: null, aLabel: null, bLabel: "BYE" };
const withdrawal = { status: "walkover", aId: "a", bId: null, aLabel: null, bLabel: "Withdrawn" };
const noShow = { status: "walkover", aId: "a", bId: "b", aLabel: null, bLabel: null };

describe("isBye", () => {
  it("is a walkover opposite a side the draw left empty", () => {
    expect(isBye(bye)).toBe(true);
    expect(isBye({ ...bye, aId: null, aLabel: "BYE", bId: "b", bLabel: null })).toBe(true);
  });

  it("is not a walkover opposite somebody who withdrew", () => {
    expect(isBye(withdrawal)).toBe(false);
    expect(isBye({ ...withdrawal, aId: null, aLabel: "Withdrawn", bId: "b", bLabel: null })).toBe(false);
  });

  it("is not a walkover between two real entrants", () => {
    expect(isBye(noShow)).toBe(false);
  });

  it("is not a slot still waiting for a winner", () => {
    expect(isBye({ ...bye, bLabel: "Winner of Semi-final 1" })).toBe(false);
  });

  it("is not any other status, even opposite a BYE", () => {
    expect(isBye({ ...bye, status: "scheduled" })).toBe(false);
    expect(isBye({ ...bye, status: "completed" })).toBe(false);
  });
});

describe("hasPlayedResult", () => {
  it("counts a completed match with sets", () => {
    expect(hasPlayedResult(played)).toBe(true);
  });

  it("counts a completed match even when no sets were entered", () => {
    expect(hasPlayedResult({ ...played, sets: [] })).toBe(true);
  });

  it("counts a walkover given between two entrants on the draw", () => {
    expect(hasPlayedResult({ ...noShow, sets: [] })).toBe(true);
  });

  it("does not count an unplayed match", () => {
    expect(hasPlayedResult({ sets: [], status: "scheduled", aId: "a", bId: "b" })).toBe(false);
  });

  it("does not count a bye", () => {
    expect(hasPlayedResult({ ...bye, sets: [] })).toBe(false);
  });

  it("does not count a walkover left by a withdrawal", () => {
    expect(hasPlayedResult({ ...withdrawal, sets: [] })).toBe(false);
  });
});
