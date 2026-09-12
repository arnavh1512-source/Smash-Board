import { describe, expect, it } from "vitest";
import {
  bracketSize,
  generateGroupsKnockout,
  generateKnockout,
  generateRoundRobin,
  groupLabel,
  knockoutFeed,
  knockoutRoundName,
  seedOrder,
  splitIntoGroups,
} from "@/lib/draw";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe("bracketSize", () => {
  it("rounds up to the next power of two", () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(16)).toBe(16);
    expect(bracketSize(17)).toBe(32);
  });

  it("never returns less than two", () => {
    expect(bracketSize(0)).toBe(2);
    expect(bracketSize(1)).toBe(2);
  });
});

describe("seedOrder", () => {
  it("produces the classic layouts", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 3, 2]);
    expect(seedOrder(8)).toEqual([1, 8, 5, 4, 3, 6, 7, 2]);
  });

  it("keeps seeds one and two at opposite ends", () => {
    const order = seedOrder(16);
    expect(order).toHaveLength(16);
    expect(order[0]).toBe(1);
    expect(order[15]).toBe(2);
    expect([...order].sort((a, b) => a - b)).toEqual(ids(16).map((_, i) => i + 1));
  });
});

describe("knockoutRoundName", () => {
  it("names the closing rounds", () => {
    expect(knockoutRoundName(2, 3)).toBe("Final");
    expect(knockoutRoundName(1, 3)).toBe("Semi-final");
    expect(knockoutRoundName(0, 3)).toBe("Quarter-final");
  });

  it("names the earlier rounds by field size", () => {
    expect(knockoutRoundName(0, 4)).toBe("Round of 16");
    expect(knockoutRoundName(0, 5)).toBe("Round of 32");
  });
});

describe("generateKnockout", () => {
  const options = { thirdPlace: false };

  it("refuses a field of fewer than two", () => {
    expect(generateKnockout([], options)).toEqual([]);
    expect(generateKnockout(["p1"], options)).toEqual([]);
  });

  it("produces one match for a field of two", () => {
    const matches = generateKnockout(ids(2), options);
    expect(matches).toHaveLength(1);
    expect(matches[0].aId).toBe("p1");
    expect(matches[0].bId).toBe("p2");
  });

  it("produces size - 1 matches for a full bracket", () => {
    expect(generateKnockout(ids(8), options)).toHaveLength(7);
    expect(generateKnockout(ids(16), options)).toHaveLength(15);
  });

  it("keeps the top two seeds apart until the final", () => {
    const first = generateKnockout(ids(8), options).filter((m) => m.round === 0);
    const withOne = first.find((m) => m.aId === "p1" || m.bId === "p1");
    const withTwo = first.find((m) => m.aId === "p2" || m.bId === "p2");
    expect(withOne).toBeDefined();
    expect(withTwo).toBeDefined();
    // Opposite halves: slot 0 of four versus slot 3 of four.
    expect(withOne!.slot).toBe(0);
    expect(withTwo!.slot).toBe(3);
  });

  it("hands byes to the strongest seeds", () => {
    const matches = generateKnockout(ids(5), { ...options });
    const firstRound = matches.filter((m) => m.round === 0);
    expect(firstRound).toHaveLength(4);
    const seedOneMatch = firstRound.find((m) => m.aId === "p1" || m.bId === "p1")!;
    expect(seedOneMatch.bId).toBeNull();
    expect(seedOneMatch.bLabel).toBe("BYE");
    // Only three entrants beyond the byes, so exactly one real match.
    const contested = firstRound.filter((m) => m.aId && m.bId);
    expect(contested).toHaveLength(1);
  });

  it("labels later rounds with the feeding match", () => {
    const matches = generateKnockout(ids(8), options);
    const semi = matches.find((m) => m.round === 1 && m.slot === 0)!;
    expect(semi.aLabel).toBe("Winner of Quarter-final 1");
    expect(semi.bLabel).toBe("Winner of Quarter-final 2");
    expect(semi.aId).toBeNull();
  });

  it("adds a third-place playoff when asked", () => {
    const matches = generateKnockout(ids(8), { thirdPlace: true });
    const playoff = matches.filter((m) => m.isThirdPlace);
    expect(playoff).toHaveLength(1);
    expect(playoff[0].aLabel).toBe("Loser of Semi-final 1");
    expect(playoff[0].bLabel).toBe("Loser of Semi-final 2");
  });

  it("skips the playoff when there are no semi-finals", () => {
    expect(generateKnockout(ids(2), { thirdPlace: true })).toHaveLength(1);
  });
});

describe("knockoutFeed", () => {
  it("sends even slots to side A and odd slots to side B", () => {
    expect(knockoutFeed(0, 0, 3)).toEqual({ round: 1, slot: 0, side: "a" });
    expect(knockoutFeed(0, 1, 3)).toEqual({ round: 1, slot: 0, side: "b" });
    expect(knockoutFeed(0, 2, 3)).toEqual({ round: 1, slot: 1, side: "a" });
  });

  it("stops at the final", () => {
    expect(knockoutFeed(2, 0, 3)).toBeNull();
  });
});

describe("generateRoundRobin", () => {
  it("refuses a field of fewer than two", () => {
    expect(generateRoundRobin(["p1"], 0)).toEqual([]);
  });

  it("pairs everyone exactly once in an even field", () => {
    const matches = generateRoundRobin(ids(4), 0);
    expect(matches).toHaveLength(6);
    const pairs = new Set(matches.map((m) => [m.aId, m.bId].sort().join("|")));
    expect(pairs.size).toBe(6);
  });

  it("handles an odd field with a bye", () => {
    const matches = generateRoundRobin(ids(5), 0);
    expect(matches).toHaveLength(10);
    for (const match of matches) {
      expect(match.aId).not.toBeNull();
      expect(match.bId).not.toBeNull();
    }
  });

  it("doubles the fixtures for a home-and-away season", () => {
    const single = generateRoundRobin(ids(4), 0);
    const double = generateRoundRobin(ids(4), 0, true);
    expect(double).toHaveLength(single.length * 2);
  });

  it("swaps the sides in the second leg", () => {
    const double = generateRoundRobin(ids(4), 0, true);
    const first = double[0];
    const mirror = double.find(
      (m) => m.round >= 3 && m.aId === first.bId && m.bId === first.aId,
    );
    expect(mirror).toBeDefined();
  });

  it("marks every fixture as a group match", () => {
    for (const match of generateRoundRobin(ids(4), null)) {
      expect(match.stage).toBe("group");
      expect(match.groupIndex).toBe(0);
    }
  });
});

describe("splitIntoGroups", () => {
  it("snakes the seeds across the groups", () => {
    const groups = splitIntoGroups(ids(8), 2);
    expect(groups[0]).toEqual(["p1", "p4", "p5", "p8"]);
    expect(groups[1]).toEqual(["p2", "p3", "p6", "p7"]);
  });

  it("keeps the group sizes within one of each other", () => {
    const groups = splitIntoGroups(ids(7), 3);
    const sizes = groups.map((g) => g.length).sort();
    expect(sizes[sizes.length - 1] - sizes[0]).toBeLessThanOrEqual(1);
    expect(groups.flat()).toHaveLength(7);
  });
});

describe("generateGroupsKnockout", () => {
  const options = {
    groupCount: 2,
    advancePerGroup: 2,
    doubleRound: false,
    thirdPlace: false,
  };

  it("plays every group out and leaves the knockout empty", () => {
    const matches = generateGroupsKnockout(ids(8), options);
    const group = matches.filter((m) => m.stage === "group");
    const knockout = matches.filter((m) => m.stage === "knockout");
    // Two groups of four: six fixtures each.
    expect(group).toHaveLength(12);
    expect(knockout).toHaveLength(3);
    for (const match of knockout) {
      expect(match.aId).toBeNull();
      expect(match.bId).toBeNull();
    }
  });

  it("labels the knockout slots with the group places that fill them", () => {
    const first = generateGroupsKnockout(ids(8), options).filter(
      (m) => m.stage === "knockout" && m.round === 0,
    );
    const labels = first.flatMap((m) => [m.aLabel, m.bLabel]);
    expect(labels).toContain("1st in Group A");
    expect(labels).toContain("2nd in Group B");
    expect(labels).toContain("1st in Group B");
    expect(labels).toContain("2nd in Group A");
  });

  it("keeps the two group winners apart in the draw", () => {
    const semi = generateGroupsKnockout(ids(8), options).find(
      (m) => m.stage === "knockout" && m.round === 0 && m.slot === 0,
    )!;
    expect(semi.aLabel).toBe("1st in Group A");
    expect(semi.bLabel).toBe("2nd in Group B");
  });

  it("byes out the unfilled knockout slots", () => {
    const matches = generateGroupsKnockout(ids(6), {
      ...options,
      groupCount: 2,
      advancePerGroup: 1,
    });
    // Two qualifiers only, so the knockout is a single final with no byes.
    const knockout = matches.filter((m) => m.stage === "knockout");
    expect(knockout).toHaveLength(1);
    expect(knockout[0].aLabel).toBe("1st in Group A");
  });

  it("skips the knockout when fewer than two qualify", () => {
    const matches = generateGroupsKnockout(ids(4), {
      ...options,
      groupCount: 1,
      advancePerGroup: 1,
    });
    expect(matches.every((m) => m.stage === "group")).toBe(true);
  });

  it("adds a third-place playoff when asked", () => {
    const matches = generateGroupsKnockout(ids(16), {
      groupCount: 4,
      advancePerGroup: 2,
      doubleRound: false,
      thirdPlace: true,
    });
    expect(matches.filter((m) => m.isThirdPlace)).toHaveLength(1);
  });
});

describe("groupLabel", () => {
  it("names the first twenty-six groups after the alphabet", () => {
    expect(groupLabel(0)).toBe("A");
    expect(groupLabel(1)).toBe("B");
    expect(groupLabel(25)).toBe("Z");
  });

  it("carries into two letters past Z, the way a spreadsheet column does", () => {
    expect(groupLabel(26)).toBe("AA");
    expect(groupLabel(27)).toBe("AB");
    // 32 groups is the most a category allows, so AF is the last name needed.
    expect(groupLabel(31)).toBe("AF");
    expect(groupLabel(51)).toBe("AZ");
    expect(groupLabel(52)).toBe("BA");
  });

  it("never emits anything but capital letters", () => {
    for (let index = 0; index < 32; index++) {
      expect(groupLabel(index)).toMatch(/^[A-Z]+$/);
    }
  });

  it("gives every group a name of its own", () => {
    const names = Array.from({ length: 32 }, (_, index) => groupLabel(index));
    expect(new Set(names).size).toBe(32);
  });
});

describe("generateGroupsKnockout at the largest allowed group count", () => {
  /** The regex `clearGroupQualifiers` finds a corrected group's slot with. */
  const QUALIFIER_LABEL = /^\d+(?:st|nd|rd|th) in Group [A-Z]+$/;

  const matches = generateGroupsKnockout(ids(64), {
    groupCount: 32,
    advancePerGroup: 1,
    doubleRound: false,
    thirdPlace: false,
  });
  const labels = matches
    .filter((m) => m.stage === "knockout" && m.round === 0)
    .flatMap((m) => [m.aLabel, m.bLabel])
    .filter((label): label is string => label !== null);

  it("labels a slot for every one of the thirty-two groups", () => {
    expect(new Set(labels).size).toBe(32);
    expect(labels).toContain("1st in Group Z");
    expect(labels).toContain("1st in Group AA");
    expect(labels).toContain("1st in Group AF");
  });

  it("writes labels the qualifier cleanup can still recognise", () => {
    // Character arithmetic used to run past Z into "[", "\\", "]" — names no
    // organiser could read and, worse, names this regex does not match, so a
    // corrected group result could not find its knockout slot again.
    for (const label of labels) {
      expect(label).toMatch(QUALIFIER_LABEL);
    }
  });
});
