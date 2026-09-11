import { describe, expect, it } from "vitest";
import {
  planSchedule,
  type PlannerMatch,
  type ScheduleOptions,
  type ScheduledSlot,
} from "@/lib/schedule";
import { personKey } from "@/lib/identity";

/**
 * One full tournament day, planned under pressure.
 *
 * The shape a real Sunday takes: three categories on two courts, a short rest,
 * two knockouts that depend on their own earlier rounds, a group stage that has
 * to finish before the knockout it feeds, byes in the men's singles, a
 * third-place playoff, and four players who entered both the singles and the
 * doubles. Twenty-eight people, forty-odd matches.
 *
 * The planner is deliberately greedy, so this does not assert an optimal
 * timetable. It asserts the things an organiser would be embarrassed by: two
 * matches on one court, one person on two courts, a player sent straight back
 * on, a match played before the match that decides who is in it, and a court
 * left standing idle while somebody waits.
 */

const OPTIONS: ScheduleOptions = { matchMinutes: 25, restMinutes: 20, courts: 2 };

/** Men's singles: a 16-slot draw with 12 entrants, so four byes. */
const singles = Array.from({ length: 12 }, (_, i) => `Singles Player ${i + 1}`);
/** Four of the singles players are in the doubles too, under the same name. */
const pairs: readonly (readonly [string, string])[] = [
  [singles[0], "Doubles A"],
  [singles[1], "Doubles B"],
  [singles[2], "Doubles C"],
  [singles[3], "Doubles D"],
  ["Doubles E", "Doubles F"],
  ["Doubles G", "Doubles H"],
  ["Doubles I", "Doubles J"],
  ["Doubles K", "Doubles L"],
];
/** Women's singles: two groups of four, then semi-finals and a final. */
const women = Array.from({ length: 8 }, (_, i) => `Women Player ${i + 1}`);

/** The planner is fed people, so every side is a list of normalised names. */
const people = (...names: string[]) => names.map(personKey);

/**
 * Builds a single-elimination bracket from its first round. A first-round entry
 * with fewer than two sides is a bye: it holds its place but takes no court.
 */
function knockout(
  prefix: string,
  eventId: string,
  eventOrder: number,
  firstRound: readonly (readonly string[])[],
  options: { thirdPlace?: boolean } = {},
): PlannerMatch[] {
  const out: PlannerMatch[] = [];
  let width = firstRound.length;
  let round = 0;
  while (width >= 1) {
    for (let slot = 0; slot < width; slot++) {
      const sides = round === 0 ? firstRound[slot] : [];
      out.push({
        id: `${prefix}-r${round}-s${slot}`,
        eventId,
        eventOrder,
        round,
        slot,
        sides,
        feeders:
          round === 0
            ? []
            : [`${prefix}-r${round - 1}-s${slot * 2}`, `${prefix}-r${round - 1}-s${slot * 2 + 1}`],
        skip: round === 0 && sides.length < 2,
      });
    }
    if (width === 1) break;
    width /= 2;
    round += 1;
  }
  if (options.thirdPlace) {
    out.push({
      id: `${prefix}-third`,
      eventId,
      eventOrder,
      round,
      slot: 1,
      sides: [],
      feeders: out.filter((m) => m.round === round - 1).map((m) => m.id),
      skip: false,
    });
  }
  return out;
}

/** Four byes spread through the draw, the way seeds receive them. */
const singlesDraw: readonly (readonly string[])[] = [
  people(singles[0]),
  people(singles[1], singles[2]),
  people(singles[3]),
  people(singles[4], singles[5]),
  people(singles[6]),
  people(singles[7], singles[8]),
  people(singles[9]),
  people(singles[10], singles[11]),
];

const mensSingles = knockout("ms", "ev-ms", 0, singlesDraw, { thirdPlace: true });

/** Eight pairs meet in four first-round matches of four people each. */
const doublesDraw: readonly (readonly string[])[] = Array.from({ length: 4 }, (_, i) =>
  people(...pairs[i * 2], ...pairs[i * 2 + 1]),
);
const mensDoubles = knockout("md", "ev-md", 1, doublesDraw);

/** Every pair inside each group of four. */
const groupMatches: PlannerMatch[] = [];
for (const [group, members] of [women.slice(0, 4), women.slice(4)].entries()) {
  let slot = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      groupMatches.push({
        id: `ws-g${group}-m${slot}`,
        eventId: "ev-ws",
        eventOrder: 2,
        round: 0,
        slot: slot++,
        sides: people(members[i], members[j]),
        feeders: [],
        skip: false,
      });
    }
  }
}
const groupIds = groupMatches.map((m) => m.id);

/** The knockout hangs off the whole group stage, exactly as the app builds it. */
const womensKnockout: PlannerMatch[] = [
  { id: "ws-sf0", round: 1000, slot: 0, feeders: groupIds },
  { id: "ws-sf1", round: 1000, slot: 1, feeders: groupIds },
  { id: "ws-final", round: 1001, slot: 0, feeders: ["ws-sf0", "ws-sf1"] },
].map(({ id, round, slot, feeders }) => ({
  id,
  eventId: "ev-ws",
  eventOrder: 2,
  round,
  slot,
  sides: [],
  feeders,
  skip: false,
}));

const all: PlannerMatch[] = [...mensSingles, ...mensDoubles, ...groupMatches, ...womensKnockout];
const byId = new Map(all.map((m) => [m.id, m] as const));
const slots = planSchedule(all, OPTIONS);
const slotById = new Map(slots.map((s) => [s.matchId, s] as const));

/** Everything one person is booked for, in the order they play it. */
function diary(): Map<string, ScheduledSlot[]> {
  const out = new Map<string, ScheduledSlot[]>();
  for (const slot of slots) {
    for (const person of byId.get(slot.matchId)!.sides) {
      out.set(person, [...(out.get(person) ?? []), slot]);
    }
  }
  for (const [person, played] of out) {
    out.set(person, [...played].sort((a, b) => a.startMinute - b.startMinute));
  }
  return out;
}

describe("a full tournament day, planned under pressure", () => {
  it("schedules every match that needs a court and none of the byes", () => {
    expect(slots).toHaveLength(all.filter((m) => !m.skip).length);
    for (const bye of all.filter((m) => m.skip)) {
      expect(slotById.has(bye.id)).toBe(false);
    }
    expect(all.filter((m) => m.skip)).toHaveLength(4);
  });

  it("never books two matches onto one court at the same time", () => {
    for (let court = 0; court < OPTIONS.courts; court++) {
      const onCourt = slots
        .filter((s) => s.court === court)
        .sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < onCourt.length; i++) {
        expect(onCourt[i].startMinute).toBeGreaterThanOrEqual(onCourt[i - 1].endMinute);
      }
    }
  });

  it("never asks one person to be on two courts at once, whatever they entered", () => {
    const played = diary();
    // The players in both draws are the ones this is really about: these two
    // have a singles match and a doubles match, under one name.
    for (const both of [singles[1], singles[2]]) {
      expect(played.get(personKey(both))!.length).toBeGreaterThan(1);
    }
    for (const matches of played.values()) {
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i].startMinute).toBeGreaterThanOrEqual(matches[i - 1].endMinute);
      }
    }
  });

  it("gives every person the rest they are owed, across categories as well as within one", () => {
    for (const [person, matches] of diary()) {
      for (let i = 1; i < matches.length; i++) {
        const gap = matches[i].startMinute - matches[i - 1].endMinute;
        expect({ person, gap: gap >= OPTIONS.restMinutes }).toEqual({ person, gap: true });
      }
    }
  });

  it("never starts a match before the matches that decide who is in it have finished", () => {
    for (const slot of slots) {
      for (const feeder of byId.get(slot.matchId)!.feeders) {
        const fed = slotById.get(feeder);
        // A bye takes no court time, so it imposes no wait of its own.
        if (!fed) continue;
        expect(slot.startMinute).toBeGreaterThanOrEqual(fed.endMinute + OPTIONS.restMinutes);
      }
    }
  });

  it("finishes the group stage before the knockout it feeds", () => {
    const lastGroup = Math.max(...groupIds.map((id) => slotById.get(id)!.endMinute));
    for (const id of ["ws-sf0", "ws-sf1"]) {
      expect(slotById.get(id)!.startMinute).toBeGreaterThanOrEqual(lastGroup + OPTIONS.restMinutes);
    }
  });

  it("plays the third-place match after both semi-finals", () => {
    const third = slotById.get("ms-third")!;
    for (const semi of ["ms-r2-s0", "ms-r2-s1"]) {
      expect(third.startMinute).toBeGreaterThanOrEqual(
        slotById.get(semi)!.endMinute + OPTIONS.restMinutes,
      );
    }
  });

  it("leaves no court standing idle while a match that could have used it waits", () => {
    /**
     * The earliest minute a match could possibly have started, read back out of
     * the finished plan: after its feeders, and after the people in it have had
     * their rest. A bye contributes nothing, which is what stops byes from
     * pushing the round after them down the day.
     */
    const readyFor = (slot: ScheduledSlot): number => {
      const match = byId.get(slot.matchId)!;
      let ready = 0;
      for (const feeder of match.feeders) {
        const fed = slotById.get(feeder);
        if (fed) ready = Math.max(ready, fed.endMinute + OPTIONS.restMinutes);
      }
      for (const person of match.sides) {
        for (const earlier of slots) {
          if (earlier === slot) continue;
          if (!byId.get(earlier.matchId)!.sides.includes(person)) continue;
          if (earlier.endMinute > slot.startMinute) continue;
          ready = Math.max(ready, earlier.endMinute + OPTIONS.restMinutes);
        }
      }
      return ready;
    };

    /** Free windows on a court, in order, with an open-ended last one. */
    const windowsOn = (court: number): { from: number; to: number }[] => {
      const onCourt = slots
        .filter((s) => s.court === court)
        .sort((a, b) => a.startMinute - b.startMinute);
      const out: { from: number; to: number }[] = [];
      let cursor = 0;
      for (const booking of onCourt) {
        if (booking.startMinute > cursor) out.push({ from: cursor, to: booking.startMinute });
        cursor = booking.endMinute;
      }
      out.push({ from: cursor, to: Number.POSITIVE_INFINITY });
      return out;
    };

    const courts = Array.from({ length: OPTIONS.courts }, (_, c) => windowsOn(c));
    for (const slot of slots) {
      const ready = readyFor(slot);
      for (const windows of courts) {
        for (const free of windows) {
          const couldStart = Math.max(free.from, ready);
          const wasted =
            couldStart + OPTIONS.matchMinutes <= free.to &&
            couldStart + OPTIONS.matchMinutes <= slot.startMinute;
          expect({ match: slot.matchId, wasted }).toEqual({ match: slot.matchId, wasted: false });
        }
      }
    }
  });

  it("keeps both courts working rather than running the whole day on one", () => {
    const perCourt = Array.from(
      { length: OPTIONS.courts },
      (_, c) => slots.filter((s) => s.court === c).length,
    );
    expect(Math.min(...perCourt)).toBeGreaterThan(0);
    // A greedy planner will not split perfectly, but one court must not be left
    // carrying more than twice the load of the other.
    expect(Math.max(...perCourt)).toBeLessThanOrEqual(Math.min(...perCourt) * 2);
  });

  it("fits the day into a sensible number of hours", () => {
    const makespan = Math.max(...slots.map((s) => s.endMinute));
    const courtMinutes = slots.length * OPTIONS.matchMinutes;
    // It cannot beat the pure court arithmetic, and with this many dependencies
    // it should not need more than double it either.
    expect(makespan).toBeGreaterThanOrEqual(courtMinutes / OPTIONS.courts);
    expect(makespan).toBeLessThanOrEqual((courtMinutes / OPTIONS.courts) * 2);
  });
});
