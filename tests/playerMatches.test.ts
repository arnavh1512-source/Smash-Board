import { describe, expect, it } from "vitest";
import {
  entryHasPerson,
  isFinished,
  matchesOfPerson,
  nextMatchOf,
  partnerOf,
  peopleOf,
  roundTitle,
  sideOf,
  type NamedEntry,
  type PlayerMatchInput,
} from "@/lib/playerMatches";

/**
 * One player's day, pulled out of the whole tournament.
 *
 * A player taps their own name on the scoreboard and expects every match they
 * are in — across singles and doubles, group and knockout — in the order they
 * will play them, with the one to get ready for picked out.
 */

const entries = new Map<string, NamedEntry>([
  ["rohan", { playerOne: "Rohan Mehta" }],
  ["dev", { playerOne: "Dev Patel" }],
  ["kabir", { playerOne: "Kabir Shah" }],
  ["pair", { playerOne: "Dev Patel", playerTwo: "Rohan Mehta" }],
  ["other-pair", { playerOne: "Kabir Shah", playerTwo: "Vivek Nair" }],
]);

function match(overrides: Partial<PlayerMatchInput> & { id: string }): PlayerMatchInput & { id: string } {
  return {
    eventId: "singles",
    aId: null,
    bId: null,
    stage: "knockout",
    round: 0,
    slot: 0,
    status: "scheduled",
    ...overrides,
  };
}

describe("who an entrant is made of", () => {
  it("lists one name for singles and both for a pair", () => {
    expect(peopleOf({ playerOne: "Rohan Mehta" })).toEqual(["Rohan Mehta"]);
    expect(peopleOf({ playerOne: "Dev Patel", playerTwo: "Rohan Mehta" })).toEqual([
      "Dev Patel",
      "Rohan Mehta",
    ]);
  });

  it("finds a person in either half of a pair, however the name was typed", () => {
    const pair = { playerOne: "Dev Patel", playerTwo: "Rohan Mehta" };
    expect(entryHasPerson(pair, "Rohan Mehta")).toBe(true);
    expect(entryHasPerson(pair, "  rohan   MEHTA ")).toBe(true);
    expect(entryHasPerson(pair, "Kabir Shah")).toBe(false);
  });

  it("names the partner from either side, and nobody for singles or a stranger", () => {
    const pair = { playerOne: "Dev Patel", playerTwo: "Rohan Mehta" };
    expect(partnerOf(pair, "Rohan Mehta")).toBe("Dev Patel");
    expect(partnerOf(pair, "dev patel")).toBe("Rohan Mehta");
    expect(partnerOf(pair, "Kabir Shah")).toBeNull();
    expect(partnerOf({ playerOne: "Rohan Mehta" }, "Rohan Mehta")).toBeNull();
  });
});

describe("which side of a match a person is on", () => {
  it("answers a, b, or not in it", () => {
    expect(sideOf({ aId: "rohan", bId: "dev" }, "Rohan Mehta", entries)).toBe("a");
    expect(sideOf({ aId: "kabir", bId: "pair" }, "Rohan Mehta", entries)).toBe("b");
    expect(sideOf({ aId: "kabir", bId: "dev" }, "Rohan Mehta", entries)).toBeNull();
  });

  it("treats an undecided slot and an unknown entrant as nobody", () => {
    expect(sideOf({ aId: null, bId: "missing" }, "Rohan Mehta", entries)).toBeNull();
  });
});

describe("a player's matches, in the order they meet them", () => {
  it("gathers singles and doubles into one list, and leaves everyone else's out", () => {
    const matches = [
      match({ id: "singles-r1", aId: "rohan", bId: "dev", scheduleOffset: 0 }),
      match({ id: "others", aId: "kabir", bId: "dev", scheduleOffset: 0, slot: 1 }),
      match({ id: "doubles-r1", eventId: "doubles", aId: "pair", bId: "other-pair", scheduleOffset: 60 }),
    ];
    expect(matchesOfPerson("Rohan Mehta", matches, entries).map((m) => m.id)).toEqual([
      "singles-r1",
      "doubles-r1",
    ]);
  });

  it("puts played matches first, then what is to come by time", () => {
    const matches = [
      match({ id: "later", aId: "rohan", scheduleOffset: 120 }),
      match({ id: "sooner", eventId: "doubles", aId: "pair", scheduleOffset: 60 }),
      // Its time was cleared when the plan was remade after it was played.
      match({ id: "played", aId: "rohan", bId: "dev", status: "completed", round: 0 }),
    ];
    expect(matchesOfPerson("Rohan Mehta", matches, entries).map((m) => m.id)).toEqual([
      "played",
      "sooner",
      "later",
    ]);
  });

  it("puts untimed matches after timed ones, group stage before knockout", () => {
    const matches = [
      match({ id: "knockout", aId: "rohan", stage: "knockout", round: 0 }),
      match({ id: "group-2", aId: "rohan", stage: "group", round: 1 }),
      match({ id: "timed", aId: "rohan", stage: "group", round: 2, scheduleOffset: 300 }),
      match({ id: "group-1", aId: "rohan", stage: "group", round: 0 }),
    ];
    expect(matchesOfPerson("Rohan Mehta", matches, entries).map((m) => m.id)).toEqual([
      "timed",
      "group-1",
      "group-2",
      "knockout",
    ]);
  });

  it("breaks a full tie by category, so the order never flickers", () => {
    const matches = [
      match({ id: "z", eventId: "z-cat", aId: "rohan" }),
      match({ id: "a", eventId: "a-cat", aId: "rohan" }),
    ];
    expect(matchesOfPerson("Rohan Mehta", matches, entries).map((m) => m.id)).toEqual(["a", "z"]);
  });

  it("finds nothing for a name nobody entered", () => {
    expect(matchesOfPerson("Nobody", [match({ id: "x", aId: "rohan" })], entries)).toEqual([]);
  });

  it("does not reorder the list it was given", () => {
    const matches = [match({ id: "b", aId: "rohan", scheduleOffset: 60 }), match({ id: "a", aId: "rohan", scheduleOffset: 0 })];
    matchesOfPerson("Rohan Mehta", matches, entries);
    expect(matches.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("the match to get ready for", () => {
  it("is the one on court now, even when an earlier one is still listed as scheduled", () => {
    const ordered = [
      match({ id: "scheduled", status: "scheduled" }),
      match({ id: "live", status: "live" }),
    ];
    expect(nextMatchOf(ordered)?.id).toBe("live");
  });

  it("is otherwise the first one not yet played", () => {
    const ordered = [
      match({ id: "done", status: "completed" }),
      match({ id: "walkover", status: "walkover" }),
      match({ id: "next", status: "scheduled" }),
      match({ id: "after", status: "scheduled" }),
    ];
    expect(nextMatchOf(ordered)?.id).toBe("next");
  });

  it("is nothing once every match is finished", () => {
    expect(nextMatchOf([match({ id: "done", status: "completed" }), match({ id: "x", status: "cancelled" })])).toBeUndefined();
    expect(isFinished({ status: "live" })).toBe(false);
  });
});

describe("what a match is called in a list that mixes categories", () => {
  const bracket = [
    match({ id: "qf", round: 0 }),
    match({ id: "sf", round: 1 }),
    match({ id: "f", round: 2 }),
    match({ id: "third", round: 2, slot: 1, isThirdPlace: true }),
  ];

  it("names knockout rounds from the end of the draw", () => {
    expect(roundTitle(bracket[0], bracket, "knockout")).toBe("Quarter-final");
    expect(roundTitle(bracket[1], bracket, "knockout")).toBe("Semi-final");
    expect(roundTitle(bracket[2], bracket, "knockout")).toBe("Final");
    expect(roundTitle(bracket[3], bracket, "knockout")).toBe("Third place");
  });

  it("names a group match by its group, and a round robin by its round alone", () => {
    const group = match({ id: "g", stage: "group", groupIndex: 1, round: 2 });
    expect(roundTitle(group, [group], "groups_knockout")).toBe("Group B · Round 3");
    expect(roundTitle(group, [group], "round_robin")).toBe("Round 3");
  });

  it("still names a round when it is handed the match without its category", () => {
    expect(roundTitle(match({ id: "lonely", round: 0 }), [], "knockout")).toBe("Final");
  });
});
