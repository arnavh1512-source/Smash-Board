import { describe, expect, it } from "vitest";
import {
  clockOf,
  courtName,
  dayCapacity,
  dayOf,
  dayWindowMinutes,
  DEFAULT_SCHEDULE,
  endDateOverrun,
  formatClock,
  formatDuration,
  gapMinutes,
  isTimestamp,
  scheduledAtOutsideTournament,
  parseClockTime,
  planSchedule,
  ScheduleError,
  toClockTime,
  type PlannerMatch,
  type ScheduleOptions,
  type ScheduledSlot,
} from "@/lib/schedule";

const OPTIONS: ScheduleOptions = {
  matchMinutes: 30,
  restMinutes: 30,
  courts: 2,
  // High enough to never bite; the hall limit has its own suite.
  categoriesAtOnce: 24,
};

function match(overrides: Partial<PlannerMatch> & { id: string }): PlannerMatch {
  return {
    eventId: "e1",
    eventOrder: 0,
    round: 0,
    slot: 0,
    sides: [],
    feeders: [],
    skip: false,
    ...overrides,
  };
}

function slotOf(slots: readonly ScheduledSlot[], id: string): ScheduledSlot {
  const found = slots.find((slot) => slot.matchId === id);
  if (!found) throw new Error(`${id} was not scheduled`);
  return found;
}

describe("planSchedule", () => {
  it("fills every court before starting a second round of slots", () => {
    const slots = planSchedule(
      [
        match({ id: "m1", slot: 0, sides: ["p1", "p2"] }),
        match({ id: "m2", slot: 1, sides: ["p3", "p4"] }),
        match({ id: "m3", slot: 2, sides: ["p5", "p6"] }),
      ],
      OPTIONS,
    );

    expect(slots).toHaveLength(3);
    expect(slotOf(slots, "m1").startMinute).toBe(0);
    expect(slotOf(slots, "m2").startMinute).toBe(0);
    expect(slotOf(slots, "m1").court).not.toBe(slotOf(slots, "m2").court);
    // Both courts are busy until minute 30, so the third match waits for one.
    expect(slotOf(slots, "m3").startMinute).toBe(30);
  });

  it("gives every player at least the rest period between their matches", () => {
    const slots = planSchedule(
      [
        match({ id: "m1", slot: 0, sides: ["p1", "p2"] }),
        match({ id: "m2", slot: 1, sides: ["p1", "p3"] }),
      ],
      OPTIONS,
    );

    const first = slotOf(slots, "m1");
    const second = slotOf(slots, "m2");
    expect(second.startMinute - first.endMinute).toBeGreaterThanOrEqual(OPTIONS.restMinutes);
  });

  it("puts another category on court while a player rests", () => {
    const slots = planSchedule(
      [
        match({ id: "a1", eventOrder: 0, slot: 0, sides: ["p1", "p2"] }),
        match({ id: "a2", eventOrder: 0, slot: 1, sides: ["p1", "p3"] }),
        match({ id: "b1", eventId: "e2", eventOrder: 1, slot: 0, sides: ["q1", "q2"] }),
      ],
      { ...OPTIONS, courts: 1 },
    );

    // One court: the second men's match cannot start until minute 60, so the
    // women's match takes the 30-60 slot rather than leaving the court idle.
    expect(slotOf(slots, "b1").startMinute).toBe(30);
    expect(slotOf(slots, "a2").startMinute).toBe(60);
  });

  it("holds a knockout match until both feeders have finished and rested", () => {
    const slots = planSchedule(
      [
        match({ id: "m1", round: 0, slot: 0, sides: ["p1", "p2"] }),
        match({ id: "m2", round: 0, slot: 1, sides: ["p3", "p4"] }),
        match({ id: "final", round: 1, slot: 0, sides: [], feeders: ["m1", "m2"] }),
      ],
      OPTIONS,
    );

    const latestFeederEnd = Math.max(slotOf(slots, "m1").endMinute, slotOf(slots, "m2").endMinute);
    expect(slotOf(slots, "final").startMinute).toBe(latestFeederEnd + OPTIONS.restMinutes);
  });

  it("takes no court time for a bye but still gates the round after it", () => {
    const slots = planSchedule(
      [
        match({ id: "bye", round: 0, slot: 0, skip: true }),
        match({ id: "m2", round: 0, slot: 1, sides: ["p3", "p4"] }),
        match({ id: "semi", round: 1, slot: 0, sides: [], feeders: ["bye", "m2"] }),
      ],
      OPTIONS,
    );

    expect(slots.some((slot) => slot.matchId === "bye")).toBe(false);
    expect(slotOf(slots, "semi").startMinute).toBe(slotOf(slots, "m2").endMinute + 30);
  });

  it("ignores a feeder that is not part of the plan", () => {
    const slots = planSchedule([match({ id: "m1", feeders: ["missing"], sides: ["p1"] })], OPTIONS);
    expect(slotOf(slots, "m1").startMinute).toBe(0);
  });

  it("returns the slots in start order, then court order", () => {
    const slots = planSchedule(
      [
        match({ id: "m1", slot: 0, sides: ["p1"] }),
        match({ id: "m2", slot: 1, sides: ["p2"] }),
        match({ id: "m3", slot: 2, sides: ["p3"] }),
        match({ id: "m4", slot: 3, sides: ["p4"] }),
      ],
      OPTIONS,
    );

    for (let i = 1; i < slots.length; i++) {
      const previous = slots[i - 1];
      const current = slots[i];
      expect(
        current.startMinute > previous.startMinute ||
          (current.startMinute === previous.startMinute && current.court > previous.court),
      ).toBe(true);
    }
  });

  it("never puts two matches on one court at the same time", () => {
    const slots = planSchedule(
      Array.from({ length: 12 }, (_, i) =>
        match({ id: `m${i}`, slot: i, sides: [`p${i * 2}`, `p${i * 2 + 1}`] }),
      ),
      { ...OPTIONS, matchMinutes: 25, restMinutes: 40, courts: 3 },
    );

    for (const a of slots) {
      for (const b of slots) {
        if (a === b || a.court !== b.court) continue;
        expect(a.startMinute >= b.endMinute || b.startMinute >= a.endMinute).toBe(true);
      }
    }
  });

  it("never runs more matches at once than the hall has courts", () => {
    for (const courts of [1, 2, 3, 5]) {
      const slots = planSchedule(
        // Two categories, so gap-filling is in play and the hall is under real
        // pressure to over-book itself.
        Array.from({ length: 20 }, (_, i) =>
          match({
            id: `m${i}`,
            eventId: i % 2 === 0 ? "e1" : "e2",
            eventOrder: i % 2,
            slot: i,
            sides: [`p${i % 6}`, `q${i}`],
          }),
        ),
        { ...OPTIONS, courts },
      );

      const edges = [...new Set(slots.map((slot) => slot.startMinute))];
      for (const minute of edges) {
        const running = slots.filter(
          (slot) => slot.startMinute <= minute && minute < slot.endMinute,
        );
        expect(running.length).toBeLessThanOrEqual(courts);
        // Two matches on the same court at the same minute would be the same
        // crowding fault seen from the other side.
        expect(new Set(running.map((slot) => slot.court)).size).toBe(running.length);
      }
    }
  });

  it("allows back-to-back matches when the rest period is zero", () => {
    const slots = planSchedule(
      [
        match({ id: "m1", slot: 0, sides: ["p1"] }),
        match({ id: "m2", slot: 1, sides: ["p1"] }),
      ],
      { ...OPTIONS, matchMinutes: 20, restMinutes: 0 },
    );

    expect(slotOf(slots, "m2").startMinute).toBe(20);
  });

  it("rejects settings outside the allowed range", () => {
    expect(() => planSchedule([], { ...OPTIONS, matchMinutes: 4 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, matchMinutes: 241 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, restMinutes: -1 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, restMinutes: 481 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, courts: 0 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, courts: 2.5 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, courts: 25 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, categoriesAtOnce: 0 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, categoriesAtOnce: 1.5 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...OPTIONS, categoriesAtOnce: 25 })).toThrow(ScheduleError);
  });

  it("plans nothing from an empty draw", () => {
    expect(planSchedule([], OPTIONS)).toEqual([]);
  });
});

describe("clock helpers", () => {
  it("reads a 24-hour time", () => {
    expect(parseClockTime("09:00")).toBe(540);
    expect(parseClockTime(" 23:59 ")).toBe(1439);
  });

  it("rejects a time that is not HH:MM", () => {
    expect(() => parseClockTime("9:00")).toThrow(ScheduleError);
    expect(() => parseClockTime("24:00")).toThrow(ScheduleError);
    expect(() => parseClockTime("09:60")).toThrow(ScheduleError);
  });

  it("turns an offset into a local timestamp", () => {
    expect(toClockTime("2026-09-11", "09:00", 0)).toBe("2026-09-11T09:00");
    expect(toClockTime("2026-09-11", "09:00", 95)).toBe("2026-09-11T10:35");
  });

  it("rolls onto the next date when play runs past midnight", () => {
    expect(toClockTime("2026-09-11", "22:00", 180)).toBe("2026-09-12T01:00");
    expect(toClockTime("2026-09-11", "09:00", 60 * 24 * 2)).toBe("2026-09-13T09:00");
  });

  it("rolls across a month boundary", () => {
    expect(toClockTime("2026-09-30", "20:00", 300)).toBe("2026-10-01T01:00");
  });

  it("refuses to place a time without a start date", () => {
    expect(() => toClockTime("", "09:00", 0)).toThrow(ScheduleError);
  });

  it("reads the clock and the day back out of a timestamp", () => {
    expect(clockOf("2026-09-11T14:05")).toBe("2:05 PM");
    expect(clockOf("2026-09-11T09:00")).toBe("9:00 AM");
    expect(dayOf("2026-09-11T14:05")).toContain("Sep");
    expect(dayOf("nonsense")).toBe("nonsense");
  });

  it("writes times on the 12-hour clock, with midnight and noon the way people say them", () => {
    expect(formatClock("00:05")).toBe("12:05 AM");
    expect(formatClock("11:59")).toBe("11:59 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
    expect(formatClock("13:30")).toBe("1:30 PM");
    expect(formatClock("23:45")).toBe("11:45 PM");
  });

  it("names courts from one", () => {
    expect(courtName(0)).toBe("Court 1");
    expect(courtName(3)).toBe("Court 4");
  });

  it("measures gaps without going negative", () => {
    expect(gapMinutes(60, 90)).toBe(30);
    expect(gapMinutes(90, 60)).toBe(0);
  });

  it("writes a break length a reader can scan", () => {
    expect(formatDuration(45)).toBe("45 m");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(75)).toBe("1 h 15 m");
  });

  it("ships defaults that satisfy its own validation", () => {
    expect(() => planSchedule([], DEFAULT_SCHEDULE)).not.toThrow();
    expect(DEFAULT_SCHEDULE.restMinutes).toBe(30);
    expect(dayWindowMinutes(DEFAULT_SCHEDULE.dayStart, DEFAULT_SCHEDULE.dayEnd)).toBe(12 * 60);
  });
});

describe("isTimestamp", () => {
  it("takes the shape a datetime-local field writes", () => {
    expect(isTimestamp("2026-09-12T09:30")).toBe(true);
    expect(isTimestamp("2026-09-12T00:00")).toBe(true);
    expect(isTimestamp("2026-09-12T23:59")).toBe(true);
  });

  it("refuses anything that is not that shape", () => {
    for (const value of ["tomorrow", "banana", "", "09:30", "2026-09-12", "2026-09-12T09:30:00"]) {
      expect(isTimestamp(value)).toBe(false);
    }
  });

  it("refuses an hour or a minute that does not exist", () => {
    expect(isTimestamp("2026-09-12T24:00")).toBe(false);
    expect(isTimestamp("2026-09-12T09:60")).toBe(false);
  });

  it("refuses a day the month does not have, which Date would roll forward", () => {
    // `new Date("2026-02-31T09:00:00")` is 3 March, not an error, so the shape
    // check alone would let a date that does not exist into the timetable.
    expect(isTimestamp("2026-02-31T09:00")).toBe(false);
    expect(isTimestamp("2026-04-31T09:00")).toBe(false);
    expect(isTimestamp("2026-13-01T09:00")).toBe(false);
    // A leap day that does exist still passes.
    expect(isTimestamp("2028-02-29T09:00")).toBe(true);
  });
});

describe("whole-minute durations", () => {
  const MATCHES: PlannerMatch[] = [
    {
      id: "m1",
      eventId: "e1",
      eventOrder: 0,
      round: 0,
      slot: 0,
      sides: ["a", "b"],
      feeders: [],
      skip: false,
    },
  ];

  it("refuses a match slot that is not a whole number of minutes", () => {
    // The timetable is written as YYYY-MM-DDTHH:MM, which cannot hold 09:30.5.
    expect(() => planSchedule(MATCHES, { ...OPTIONS, matchMinutes: 30.5 })).toThrow(ScheduleError);
  });

  it("refuses a rest period that is not a whole number of minutes", () => {
    expect(() => planSchedule(MATCHES, { ...OPTIONS, restMinutes: 20.5 })).toThrow(ScheduleError);
  });

  it("still takes the whole numbers either side of them", () => {
    expect(() => planSchedule(MATCHES, { ...OPTIONS, matchMinutes: 30, restMinutes: 20 })).not.toThrow();
  });
});

/**
 * The end date is a booking, not a decoration.
 *
 * `toClockTime` rolls past midnight so a late match still prints with the right
 * date on it. Left alone, that let a one-day tournament quietly become a
 * two-day one: fifty matches on two courts at thirty minutes each is over
 * twelve hours of play, and the timetable simply carried on into tomorrow.
 */
describe("a day of play with a finish time", () => {
  const PLAIN: ScheduleOptions = { ...OPTIONS, restMinutes: 0, courts: 1 };
  const strangers = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      match({ id: `m${i}`, slot: i, sides: [`a${i}`, `b${i}`] }),
    );

  it("measures the window between the first match and the close", () => {
    expect(dayWindowMinutes("09:00", "17:00")).toBe(480);
    expect(dayWindowMinutes("06:30", "22:15")).toBe(945);
  });

  it("refuses a finish that is not a time, or that comes before the start", () => {
    expect(() => dayWindowMinutes("09:00", "5pm")).toThrow(/look like 21:00/);
    expect(() => dayWindowMinutes("09:00", "09:00")).toThrow(/finish after the first one starts/);
    expect(() => dayWindowMinutes("18:00", "02:00")).toThrow(ScheduleError);
  });

  it("counts how many matches a day can hold before rest is considered", () => {
    expect(dayCapacity(720, 30, 2)).toBe(48);
    // A slot that would end after the close is not a slot.
    expect(dayCapacity(100, 30, 3)).toBe(9);
    expect(dayCapacity(20, 30, 4)).toBe(0);
    expect(dayCapacity(Number.NaN, 30, 2)).toBe(0);
  });

  it("rejects a day that is not a whole number of minutes, or shorter than a match", () => {
    expect(() => planSchedule([], { ...PLAIN, dayMinutes: 0 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...PLAIN, dayMinutes: 90.5 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...PLAIN, dayMinutes: 24 * 60 + 1 })).toThrow(ScheduleError);
    expect(() => planSchedule([], { ...PLAIN, dayMinutes: 20 })).toThrow(/shorter than one match/);
  });

  it("moves a match that would run past the finish to the first slot of the next morning", () => {
    const slots = planSchedule(strangers(3), { ...PLAIN, dayMinutes: 60 });
    expect(slotOf(slots, "m0").startMinute).toBe(0);
    expect(slotOf(slots, "m1").startMinute).toBe(30);
    expect(slotOf(slots, "m2").startMinute).toBe(24 * 60);
  });

  it("does not squeeze a match into the tail end of the day", () => {
    // 50 minutes holds one 30-minute match, not a second that would end at 60.
    const slots = planSchedule(strangers(2), { ...PLAIN, dayMinutes: 50 });
    expect(slotOf(slots, "m1").startMinute).toBe(24 * 60);
  });

  it("never books a match that ends after the close, however many days the field needs", () => {
    const slots = planSchedule(strangers(25), { ...PLAIN, courts: 2, dayMinutes: 90 });
    expect(slots).toHaveLength(25);
    for (const slot of slots) {
      expect((slot.startMinute % (24 * 60)) + PLAIN.matchMinutes).toBeLessThanOrEqual(90);
    }
    // Three slots a day on two courts: 25 matches take five days.
    expect(Math.max(...slots.map((slot) => slot.startMinute))).toBe(4 * 24 * 60);
  });

  it("still gives a player their rest when it would carry them past the finish", () => {
    const slots = planSchedule(
      [
        match({ id: "first", slot: 0, sides: ["p1", "p2"] }),
        match({ id: "again", slot: 1, sides: ["p1", "p3"] }),
      ],
      { ...PLAIN, courts: 2, restMinutes: 30, dayMinutes: 60 },
    );
    expect(slotOf(slots, "first").startMinute).toBe(0);
    expect(slotOf(slots, "again").startMinute).toBe(24 * 60);
  });

  it("plans exactly as before when the day has no finish", () => {
    const slots = planSchedule(strangers(3), PLAIN);
    expect(slots.map((slot) => slot.startMinute)).toEqual([0, 30, 60]);
  });
});

describe("endDateOverrun", () => {
  it("passes a plan that finishes on the last day", () => {
    // 09:00 plus eight hours is 17:00 on the same day.
    expect(endDateOverrun("2026-09-20", "2026-09-20", "09:00", 480)).toBeNull();
  });

  it("passes a plan that finishes at the very last minute of the last day", () => {
    expect(endDateOverrun("2026-09-20", "2026-09-20", "09:00", 15 * 60 - 1)).toBeNull();
  });

  it("refuses a one-day tournament whose order of play rolls into tomorrow", () => {
    // 09:00 plus sixteen hours is 01:00 the next morning.
    const message = endDateOverrun("2026-09-20", "2026-09-20", "09:00", 16 * 60);
    expect(message).toMatch(/past the tournament's end date of 2026-09-20/);
    expect(message).toMatch(/2026-09-21/);
    expect(message).toMatch(/1:00 AM/);
  });

  it("names the levers, because the answer is usually a court and not a longer tournament", () => {
    const message = endDateOverrun("2026-09-20", "2026-09-20", "09:00", 20 * 60) ?? "";
    expect(message).toMatch(/court/i);
    expect(message).toMatch(/shorten the matches/i);
    expect(message).toMatch(/earlier/i);
    expect(message).toMatch(/end date/i);
  });

  it("lets a two-day tournament use its second day", () => {
    expect(endDateOverrun("2026-09-20", "2026-09-21", "09:00", 16 * 60)).toBeNull();
    // But not a third one.
    expect(endDateOverrun("2026-09-20", "2026-09-21", "09:00", 40 * 60)).not.toBeNull();
  });

  it("crosses a month boundary the way the calendar does", () => {
    expect(endDateOverrun("2026-09-30", "2026-10-01", "18:00", 8 * 60)).toBeNull();
    expect(endDateOverrun("2026-09-30", "2026-09-30", "18:00", 8 * 60)).not.toBeNull();
  });

  it("says nothing at all when the organiser has not set an end date", () => {
    // The field is optional, and an unset end date is not a promise to keep.
    expect(endDateOverrun("2026-09-20", undefined, "09:00", 100 * 60)).toBeNull();
  });
});

describe("scheduledAtOutsideTournament", () => {
  it("accepts any minute of the first and last day", () => {
    expect(scheduledAtOutsideTournament("2026-09-20T00:00", "2026-09-20", "2026-09-21")).toBeNull();
    expect(scheduledAtOutsideTournament("2026-09-21T23:59", "2026-09-20", "2026-09-21")).toBeNull();
  });

  it("refuses a time before the first day, naming both dates", () => {
    const message = scheduledAtOutsideTournament("2026-09-19T23:59", "2026-09-20", "2026-09-21");
    expect(message).toMatch(/2026-09-19/);
    expect(message).toMatch(/starts on 2026-09-20/);
  });

  it("refuses a time after the last day, and says how to allow it", () => {
    const message = scheduledAtOutsideTournament("2026-09-22T09:00", "2026-09-20", "2026-09-21");
    expect(message).toMatch(/ends on 2026-09-21/);
    expect(message).toMatch(/end date/);
  });

  it("applies only the dates the tournament has", () => {
    expect(scheduledAtOutsideTournament("2030-01-01T09:00", "2026-09-20", undefined)).toBeNull();
    expect(scheduledAtOutsideTournament("2020-01-01T09:00", undefined, "2026-09-21")).toBeNull();
    expect(scheduledAtOutsideTournament("2020-01-01T09:00", undefined, undefined)).toBeNull();
    expect(scheduledAtOutsideTournament("2020-01-01T09:00", "", "")).toBeNull();
  });

  it("compares across a month and a year boundary", () => {
    expect(scheduledAtOutsideTournament("2027-01-01T09:00", "2026-12-31", "2026-12-31")).not.toBeNull();
    expect(scheduledAtOutsideTournament("2026-12-31T09:00", "2026-12-31", "2027-01-01")).toBeNull();
  });
});
