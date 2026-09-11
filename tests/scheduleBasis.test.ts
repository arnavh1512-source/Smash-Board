import { describe, expect, it } from "vitest";
import { scheduleBasis, type PlannerMatch } from "@/lib/schedule";
import { personKey } from "@/lib/identity";

/**
 * An order of play is a plan, not a fact.
 *
 * It is derived from the draw as the draw stood when somebody pressed the
 * button, and the day then moves on: an entrant withdraws, a walkover resolves,
 * a group decides who goes through, the categories are reordered, the whole
 * tournament slides to another date. The times printed on the matches survive
 * all of that while quietly describing a tournament that no longer exists.
 *
 * Rather than asking a dozen mutations each to remember to raise a flag, the
 * planner's own input is fingerprinted and the fingerprint is stored with the
 * plan. Anything that changes what the planner would do changes the
 * fingerprint, and nothing that does not, does not. These tests pin both
 * halves of that sentence.
 */

const START = "2026-11-14";
const people = (...names: string[]) => names.map(personKey);

/** A small, complete shape: one group-fed knockout and one ordinary category. */
function draw(): PlannerMatch[] {
  return [
    {
      id: "g-0",
      eventId: "ev-a",
      eventOrder: 0,
      round: 0,
      slot: 0,
      sides: people("Ann", "Bea"),
      feeders: [],
      skip: false,
    },
    {
      id: "g-1",
      eventId: "ev-a",
      eventOrder: 0,
      round: 0,
      slot: 1,
      sides: people("Cat", "Dee"),
      feeders: [],
      skip: false,
    },
    {
      id: "final-a",
      eventId: "ev-a",
      eventOrder: 0,
      round: 1000,
      slot: 0,
      sides: [],
      feeders: ["g-0", "g-1"],
      skip: false,
    },
    {
      id: "b-0",
      eventId: "ev-b",
      eventOrder: 1,
      round: 0,
      slot: 0,
      sides: people("Eve", "Fay"),
      feeders: [],
      skip: false,
    },
  ];
}

const basis = (matches: PlannerMatch[], startDate = START) => scheduleBasis(startDate, matches);

/** The same draw with one match replaced. */
function replacing(id: string, change: Partial<PlannerMatch>): PlannerMatch[] {
  return draw().map((match) => (match.id === id ? { ...match, ...change } : match));
}

describe("the fingerprint a plan is stored with", () => {
  it("is stable for the same draw, however the matches are ordered", () => {
    expect(basis(draw())).toBe(basis(draw()));
    expect(basis([...draw()].reverse())).toBe(basis(draw()));
  });

  it("is stable when a side is written with different spacing or case", () => {
    const loose = draw().map((match) =>
      match.id === "g-0" ? { ...match, sides: people("  ANN ", "Bea") } : match,
    );
    expect(basis(loose)).toBe(basis(draw()));
  });

  it("changes when the tournament moves to another date", () => {
    expect(basis(draw(), "2026-11-15")).not.toBe(basis(draw()));
  });

  it("changes when an entrant withdraws and their match becomes a walkover", () => {
    // A withdrawal empties the side and takes the match off the courts, which
    // is exactly what the planner would have done differently.
    expect(basis(replacing("g-1", { sides: people("Cat"), skip: true }))).not.toBe(basis(draw()));
  });

  it("changes when a later round learns who is in it", () => {
    // The reviewer's case: a knockout slot with no player identity at planning
    // time acquires one when the bracket resolves, and a player who could not
    // have been considered for a rest suddenly has to be.
    expect(basis(replacing("final-a", { sides: people("Ann", "Cat") }))).not.toBe(basis(draw()));
  });

  it("changes when the categories are reordered", () => {
    const swapped = draw().map((match) => ({
      ...match,
      eventOrder: match.eventOrder === 0 ? 1 : 0,
    }));
    expect(basis(swapped)).not.toBe(basis(draw()));
  });

  it("changes when the draw itself changes shape", () => {
    expect(basis([...draw(), { ...draw()[3], id: "b-1", slot: 1 }])).not.toBe(basis(draw()));
    expect(basis(draw().filter((match) => match.id !== "b-0"))).not.toBe(basis(draw()));
    expect(basis(replacing("final-a", { feeders: ["g-0"] }))).not.toBe(basis(draw()));
  });

  it("changes when a match that needed no court now needs one", () => {
    expect(basis(replacing("b-0", { skip: true }))).not.toBe(basis(draw()));
  });

  it("carries nothing about a score, so entering one does not invalidate the plan", () => {
    // The planner is fed who plays whom and what has to happen first. A result
    // that only decides a match it was already planning for changes none of
    // that, so the timetable still stands — which is why the fingerprint is
    // taken over the planner's input rather than over the matches wholesale.
    const fields = Object.keys(draw()[0]).sort();
    expect(fields).toEqual(["eventId", "eventOrder", "feeders", "id", "round", "sides", "skip", "slot"]);
  });

  it("tells two genuinely different draws apart", () => {
    const other = draw().map((match) => ({ ...match, id: `${match.id}-x` }));
    expect(basis(other)).not.toBe(basis(draw()));
  });
});
