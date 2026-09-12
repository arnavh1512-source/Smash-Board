import { describe, expect, it } from "vitest";
import {
  hallLoad,
  planSchedule,
  type PlannerMatch,
  type ScheduleOptions,
  type ScheduledSlot,
} from "@/lib/schedule";

/**
 * Keeping the hall from filling up.
 *
 * Courts limit how many people are playing. `categoriesAtOnce` limits how many
 * are in the building: a category's whole field turns up when its first match
 * is called and drifts home after its last, so six categories running together
 * put six fields in one hall. These tests hold the planner to that promise —
 * and to the promises it already made, because a limit that quietly breaks
 * somebody's rest or double-books a court is worse than no limit at all.
 */

/** Four categories of eight, each a clean two-round knockout. */
const CATEGORIES = ["ms", "ws", "md", "wd"] as const;

function fieldOf(category: string): PlannerMatch[] {
  const order = CATEGORIES.indexOf(category as (typeof CATEGORIES)[number]);
  const first: PlannerMatch[] = Array.from({ length: 4 }, (_, slot) => ({
    id: `${category}-r0-${slot}`,
    eventId: category,
    eventOrder: order,
    round: 0,
    slot,
    sides: [`${category}-p${slot * 2}`, `${category}-p${slot * 2 + 1}`],
    feeders: [],
    skip: false,
  }));
  const second: PlannerMatch[] = Array.from({ length: 2 }, (_, slot) => ({
    id: `${category}-r1-${slot}`,
    eventId: category,
    eventOrder: order,
    round: 1,
    slot,
    // The seeds come through, so the semi-finalists are known up front. That
    // is what gives a category a long presence in the hall rather than one
    // thirty-minute visit per player.
    sides: [`${category}-p${slot * 4}`, `${category}-p${slot * 4 + 2}`],
    feeders: [`${category}-r0-${slot * 2}`, `${category}-r0-${slot * 2 + 1}`],
    skip: false,
  }));
  return [...first, ...second];
}

const ALL = CATEGORIES.flatMap(fieldOf);

const BASE: ScheduleOptions = {
  matchMinutes: 30,
  restMinutes: 30,
  courts: 3,
  categoriesAtOnce: 4,
};

function categoryOf(matchId: string): string {
  return matchId.split("-")[0];
}

/** Every minute at which something starts or finishes. */
function moments(slots: readonly ScheduledSlot[]): number[] {
  return [...new Set(slots.flatMap((slot) => [slot.startMinute, slot.endMinute - 1]))].sort(
    (a, b) => a - b,
  );
}

/** Categories with a match actually on court at this minute. */
function playingAt(slots: readonly ScheduledSlot[], minute: number): Set<string> {
  return new Set(
    slots
      .filter((slot) => slot.startMinute <= minute && minute < slot.endMinute)
      .map((slot) => categoryOf(slot.matchId)),
  );
}

/**
 * Categories whose field is in the building at this minute — from the first
 * match of that category to the last, warm-up queue and all.
 */
function presentAt(slots: readonly ScheduledSlot[], minute: number): Set<string> {
  const spans = new Map<string, { from: number; to: number }>();
  for (const slot of slots) {
    const key = categoryOf(slot.matchId);
    const known = spans.get(key);
    spans.set(
      key,
      known
        ? { from: Math.min(known.from, slot.startMinute), to: Math.max(known.to, slot.endMinute) }
        : { from: slot.startMinute, to: slot.endMinute },
    );
  }
  return new Set(
    [...spans]
      .filter(([, span]) => span.from <= minute && minute < span.to)
      .map(([category]) => category),
  );
}

describe("categoriesAtOnce", () => {
  it.each([1, 2, 3])("never puts more than %i categories on court at one time", (cap) => {
    const slots = planSchedule(ALL, { ...BASE, categoriesAtOnce: cap });
    for (const minute of moments(slots)) {
      expect(playingAt(slots, minute).size).toBeLessThanOrEqual(cap);
    }
  });

  it.each([1, 2, 3])("never has more than %i categories' fields in the hall", (cap) => {
    const slots = planSchedule(ALL, { ...BASE, categoriesAtOnce: cap });
    for (const minute of moments(slots)) {
      expect(presentAt(slots, minute).size).toBeLessThanOrEqual(cap);
    }
  });

  it("runs the categories strictly one after another when the cap is one", () => {
    const slots = planSchedule(ALL, { ...BASE, categoriesAtOnce: 1 });
    const ends = new Map<string, number>();
    const starts = new Map<string, number>();
    for (const slot of slots) {
      const key = categoryOf(slot.matchId);
      ends.set(key, Math.max(ends.get(key) ?? 0, slot.endMinute));
      starts.set(key, Math.min(starts.get(key) ?? Infinity, slot.startMinute));
    }
    // In organiser order, and with no overlap between one and the next.
    for (let i = 1; i < CATEGORIES.length; i++) {
      expect(starts.get(CATEGORIES[i])).toBeGreaterThanOrEqual(ends.get(CATEGORIES[i - 1])!);
    }
  });

  it("plans exactly as it would unrestricted once the cap covers every category", () => {
    const capped = planSchedule(ALL, { ...BASE, categoriesAtOnce: CATEGORIES.length });
    const lifted = planSchedule(ALL, { ...BASE, categoriesAtOnce: 24 });
    expect(capped).toEqual(lifted);
  });

  it("finishes later the tighter the hall limit is", () => {
    const finish = (cap: number) =>
      Math.max(...planSchedule(ALL, { ...BASE, categoriesAtOnce: cap }).map((s) => s.endMinute));
    expect(finish(1)).toBeGreaterThan(finish(2));
    expect(finish(2)).toBeGreaterThan(finish(4));
  });

  it.each([1, 2, 3, 4])("still books every match exactly once at a cap of %i", (cap) => {
    const slots = planSchedule(ALL, { ...BASE, categoriesAtOnce: cap });
    expect(slots).toHaveLength(ALL.length);
    expect(new Set(slots.map((slot) => slot.matchId)).size).toBe(ALL.length);
  });

  it.each([1, 2, 3])("never double-books a court at a cap of %i", (cap) => {
    const slots = planSchedule(ALL, { ...BASE, categoriesAtOnce: cap });
    for (const a of slots) {
      for (const b of slots) {
        if (a === b || a.court !== b.court) continue;
        expect(a.startMinute >= b.endMinute || b.startMinute >= a.endMinute).toBe(true);
      }
    }
  });

  it("still rests a player who is entered in two categories in different blocks", () => {
    // One person plays in the first category and again in the last, which the
    // cap of one puts hours apart — but the rest is owed either way, and the
    // rest bookkeeping has to survive the block boundary to pay it.
    const shared = ALL.map((match) =>
      match.id === "ms-r0-0" || match.id === "wd-r0-0"
        ? { ...match, sides: ["Shared Player", `${match.eventId}-partner`] }
        : match,
    );
    for (const cap of [1, 2, 4]) {
      const slots = planSchedule(shared, { ...BASE, categoriesAtOnce: cap });
      const mine = slots
        .filter((slot) => slot.matchId === "ms-r0-0" || slot.matchId === "wd-r0-0")
        .sort((a, b) => a.startMinute - b.startMinute);
      expect(mine).toHaveLength(2);
      expect(mine[1].startMinute - mine[0].endMinute).toBeGreaterThanOrEqual(BASE.restMinutes);
    }
  });

  it("keeps a feeder before the match it feeds at every cap", () => {
    for (const cap of [1, 2, 3, 4]) {
      const slots = planSchedule(ALL, { ...BASE, categoriesAtOnce: cap });
      const at = new Map(slots.map((slot) => [slot.matchId, slot] as const));
      for (const match of ALL) {
        for (const feeder of match.feeders) {
          expect(at.get(match.id)!.startMinute).toBeGreaterThanOrEqual(at.get(feeder)!.endMinute);
        }
      }
    }
  });
});

describe("hallLoad", () => {
  it("counts nobody when nothing is planned", () => {
    expect(hallLoad([], [])).toEqual({ peak: 0, startMinute: 0 });
  });

  it("counts a player once, however many matches they play", () => {
    const matches: PlannerMatch[] = [
      { id: "a", eventId: "e", eventOrder: 0, round: 0, slot: 0, sides: ["p1", "p2"], feeders: [], skip: false },
      { id: "b", eventId: "e", eventOrder: 0, round: 1, slot: 0, sides: ["p1", "p3"], feeders: [], skip: false },
    ];
    const slots: ScheduledSlot[] = [
      { matchId: "a", startMinute: 0, endMinute: 30, court: 0 },
      { matchId: "b", startMinute: 60, endMinute: 90, court: 0 },
    ];
    // p1 is there the whole time, p2 and p3 for one match each, and p2 has
    // gone home before p3 arrives — so the worst moment holds two people.
    expect(hallLoad(matches, slots)).toEqual({ peak: 2, startMinute: 0 });
  });

  it("does not count somebody leaving as somebody arriving", () => {
    const matches: PlannerMatch[] = [
      { id: "a", eventId: "e", eventOrder: 0, round: 0, slot: 0, sides: ["p1"], feeders: [], skip: false },
      { id: "b", eventId: "e", eventOrder: 0, round: 0, slot: 1, sides: ["p2"], feeders: [], skip: false },
    ];
    const slots: ScheduledSlot[] = [
      { matchId: "a", startMinute: 0, endMinute: 30, court: 0 },
      { matchId: "b", startMinute: 30, endMinute: 60, court: 0 },
    ];
    expect(hallLoad(matches, slots).peak).toBe(1);
  });

  it("ignores a match that was given no court time", () => {
    const matches: PlannerMatch[] = [
      { id: "a", eventId: "e", eventOrder: 0, round: 0, slot: 0, sides: ["p1"], feeders: [], skip: true },
    ];
    expect(hallLoad(matches, [])).toEqual({ peak: 0, startMinute: 0 });
  });

  it("falls as the hall limit is tightened", () => {
    const peakAt = (cap: number) =>
      hallLoad(ALL, planSchedule(ALL, { ...BASE, categoriesAtOnce: cap })).peak;
    expect(peakAt(1)).toBeLessThan(peakAt(4));
    expect(peakAt(2)).toBeLessThanOrEqual(peakAt(4));
  });

  it("never reports more people than the entry list holds", () => {
    const everyone = new Set(ALL.flatMap((match) => match.sides));
    const slots = planSchedule(ALL, BASE);
    expect(hallLoad(ALL, slots).peak).toBeLessThanOrEqual(everyone.size);
  });
});
