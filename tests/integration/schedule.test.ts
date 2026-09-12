import { ConvexHttpClient } from "convex/browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_SCORING } from "../../src/lib/scoring";

/**
 * The order of play is a snapshot, not a promise.
 *
 * `schedule.status` recomputes a fingerprint of everything the planner read —
 * see `scheduleBasis` in `src/lib/schedule.ts` — and compares it to the one
 * stamped on the plan when it was generated. These tests exercise that check
 * against a real deployment: a withdrawal, a reordered category, a moved
 * start date, and a knockout slot that only learns who is playing it once the
 * group stage that feeds it is decided.
 */

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL must be set to run the integration tests.");

const client = new ConvexHttpClient(url);
const PIN = "8140081461";
const WIN = [
  { a: 21, b: 10 },
  { a: 21, b: 10 },
];
const SCHEDULE_OPTIONS = {
  dayStart: "09:00",
  matchMinutes: 30,
  restMinutes: 30,
  courts: 2,
  // No hall limit: these tests are about the draw, not the door.
  categoriesAtOnce: 24,
};

async function makeTournament(name: string, startDate: string) {
  return await client.mutation(api.tournaments.create, {
    name: `${name} ${Date.now()}`,
    venue: "Ahmedabad",
    startDate,
    pin: PIN,
    isPublic: false,
  });
}

const players = (count: number) =>
  Array.from({ length: count }, (_, i) => `Player ${String(i + 1).padStart(2, "0")}`).join("\n");

/** See the note on the same helper in backend.test.ts - production redacts `message`. */
async function rejects(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error && typeof error === "object" && "data" in error) {
      const data = (error as { data: unknown }).data;
      if (typeof data === "string") return data;
    }
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the call to be rejected, but it succeeded.");
}

describe("whether a generated plan still matches the tournament", () => {
  let tournamentId: Id<"tournaments">;
  let token: string;
  let eventId: Id<"events">;

  beforeAll(async () => {
    const created = await makeTournament("Schedule Staleness", "2026-11-20");
    tournamentId = created.tournamentId;
    token = created.token;

    eventId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Men's Singles",
      teamSize: 1,
      format: "knockout",
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    });
    await client.mutation(api.entries.addMany, { eventId, token, text: players(4) });
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
  }, 60_000);

  afterAll(async () => {
    await client.mutation(api.tournaments.remove, { tournamentId, token });
  }, 60_000);

  it("is fresh the moment it is generated", async () => {
    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });
    const status = await client.query(api.schedule.status, { tournamentId });
    expect(status?.stale).toBe(false);
    expect(typeof status?.generatedAt).toBe("number");
  }, 60_000);

  it("goes stale the moment an entrant withdraws, and fresh again once replanned", async () => {
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const scheduled = matches.find((m) => m.status === "scheduled" && m.aId !== null)!;

    await client.mutation(api.entries.update, {
      entryId: scheduled.aId as Id<"entries">,
      token,
      withdrawn: true,
    });
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(true);

    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(false);
  }, 60_000);

  it("goes stale the moment a category is reordered, and fresh again once replanned", async () => {
    await client.mutation(api.events.update, { eventId, token, order: 7 });
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(true);

    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(false);
  }, 60_000);

  it("cannot be quietly outrun by a late entrant, because entries are closed", async () => {
    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });
    const before = await client.query(api.schedule.status, { tournamentId });
    expect(before?.stale).toBe(false);

    // This is the hole the guard closes. The plan is fingerprinted from the
    // planner's matches, and a person with no match changes no fingerprint -
    // so an entrant added after the draw would leave the plan looking fresh
    // while the entry list and the bracket disagreed about who is playing.
    const message = await rejects(
      client.mutation(api.entries.add, { eventId, token, playerOne: "Late Arrival" }),
    );
    expect(message).toMatch(/entries for this category are closed/i);

    const after = await client.query(api.schedule.status, { tournamentId });
    expect(after?.stale).toBe(false);
    expect(after?.generatedAt).toBe(before?.generatedAt);
  }, 60_000);

  it("goes stale the moment the tournament's start date moves, and fresh again once replanned", async () => {
    await client.mutation(api.tournaments.update, { tournamentId, token, startDate: "2026-11-21" });
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(true);

    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(false);
  }, 60_000);
});

describe("a withdrawn entrant who already held a court booking", () => {
  let tournamentId: Id<"tournaments">;
  let token: string;
  let eventId: Id<"events">;

  beforeAll(async () => {
    const created = await makeTournament("Court Invalidation", "2026-11-20");
    tournamentId = created.tournamentId;
    token = created.token;

    eventId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Men's Singles",
      teamSize: 1,
      format: "knockout",
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    });
    await client.mutation(api.entries.addMany, { eventId, token, text: players(4) });
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });
  }, 60_000);

  afterAll(async () => {
    await client.mutation(api.tournaments.remove, { tournamentId, token });
  }, 60_000);

  it("keeps the stale booking on the withdrawn match until the plan is remade, then clears it", async () => {
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const scheduled = matches.find((m) => m.status === "scheduled" && m.aId !== null)!;
    expect(scheduled.court).toBeDefined();
    expect(scheduled.scheduledAt).toBeDefined();

    await client.mutation(api.entries.update, {
      entryId: scheduled.aId as Id<"entries">,
      token,
      withdrawn: true,
    });

    // The walkover happens immediately, but nobody has told the timetable yet:
    // the old booking is still sitting there, describing a match that will
    // never be played at that time on that court.
    const afterWithdrawal = (await client.query(api.matches.listByEvent, { eventId })).find(
      (m) => m._id === scheduled._id,
    )!;
    expect(afterWithdrawal.status).toBe("walkover");
    expect(afterWithdrawal.court).toBe(scheduled.court);
    expect(afterWithdrawal.scheduledAt).toBe(scheduled.scheduledAt);

    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });

    const afterReplan = (await client.query(api.matches.listByEvent, { eventId })).find(
      (m) => m._id === scheduled._id,
    )!;
    expect(afterReplan.court).toBeUndefined();
    expect(afterReplan.scheduledAt).toBeUndefined();
  }, 60_000);
});

describe("a knockout slot whose participants are decided after the plan is made", () => {
  let tournamentId: Id<"tournaments">;
  let token: string;
  let eventId: Id<"events">;

  beforeAll(async () => {
    const created = await makeTournament("Future Qualifier", "2026-11-20");
    tournamentId = created.tournamentId;
    token = created.token;

    eventId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Group Singles",
      teamSize: 1,
      format: "groups_knockout",
      scoring: DEFAULT_SCORING,
      semiFinalScoring: null,
      finalScoring: null,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 1,
      doubleRound: false,
    });
    // Two groups of two: one match each, feeding a single final.
    await client.mutation(api.entries.addMany, { eventId, token, text: players(4) });
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });
  }, 60_000);

  afterAll(async () => {
    await client.mutation(api.tournaments.remove, { tournamentId, token });
  }, 60_000);

  it("books the final a slot on trust before its players are even known", async () => {
    // The final's sides carry a qualifier label ("1st in Group A"), not the
    // BYE/Withdrawn labels that mean no court is needed, so the planner books
    // it a slot after the group matches that feed it — on faith that someone
    // will occupy it — rather than leaving it unscheduled.
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const final = matches.find((m) => m.stage === "knockout")!;
    expect(final.aId).toBeNull();
    expect(final.bId).toBeNull();
    expect(final.court).toBeDefined();
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(false);
  }, 60_000);

  it("goes stale the instant the group stage hands the final its players, and needs a fresh plan", async () => {
    const group = (await client.query(api.matches.listByEvent, { eventId })).filter(
      (m) => m.stage === "group",
    );
    expect(group).toHaveLength(2);
    for (const match of group) {
      await client.mutation(api.matches.setScore, { matchId: match._id, token, sets: WIN });
    }

    const decided = (await client.query(api.matches.listByEvent, { eventId })).find(
      (m) => m.stage === "knockout",
    )!;
    expect(decided.aId).not.toBeNull();
    expect(decided.bId).not.toBeNull();
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(true);

    await client.mutation(api.schedule.generate, { tournamentId, token, ...SCHEDULE_OPTIONS });

    const scheduled = (await client.query(api.matches.listByEvent, { eventId })).find(
      (m) => m.stage === "knockout",
    )!;
    expect(scheduled.court).toBeDefined();
    expect(scheduled.scheduledAt).toBeDefined();
    expect((await client.query(api.schedule.status, { tournamentId }))?.stale).toBe(false);
  }, 60_000);
});

/**
 * A tournament cannot be planned past its own end date.
 *
 * The timetable is allowed to roll past midnight - a match called at 23:40 has
 * to print with tomorrow's date on it - but that is a property of the clock,
 * not permission for a one-day tournament to become a two-day one. Sixteen
 * entrants on one court at sixty minutes each is fifteen hours of play, which
 * does not fit in a hall booked for a single day however the planner arranges
 * it, so the plan is refused before a single match is given a time.
 */
describe("an order of play has to fit inside the tournament's own dates", () => {
  let tournamentId: Id<"tournaments">;
  let token: string;
  let eventId: Id<"events">;

  const ONE_COURT_LONG_MATCHES = {
    dayStart: "09:00",
    matchMinutes: 60,
    restMinutes: 30,
    courts: 1,
    categoriesAtOnce: 24,
  };

  beforeAll(async () => {
    const created = await client.mutation(api.tournaments.create, {
      name: `End Date ${Date.now()}`,
      venue: "Ahmedabad",
      startDate: "2026-11-20",
      endDate: "2026-11-20",
      pin: PIN,
      isPublic: false,
    });
    tournamentId = created.tournamentId;
    token = created.token;

    eventId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Men's Singles",
      teamSize: 1,
      format: "knockout",
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    });
    await client.mutation(api.entries.addMany, { eventId, token, text: players(16) });
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
  }, 120_000);

  afterAll(async () => {
    await client.mutation(api.tournaments.remove, { tournamentId, token });
  }, 60_000);

  it("refuses a plan that would run past the last day, and says by how much", async () => {
    const message = await rejects(
      client.mutation(api.schedule.generate, { tournamentId, token, ...ONE_COURT_LONG_MATCHES }),
    );
    expect(message).toMatch(/end date of 2026-11-20/);
    expect(message).toMatch(/2026-11-21/);
    expect(message).toMatch(/court/i);
  });

  it("leaves every match without a time, rather than half a timetable", async () => {
    // The check runs on the finished plan and before the first write, so a
    // refusal is a refusal: nothing is left booked from the attempt.
    const matches = await client.query(api.matches.listByEvent, { eventId });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((match) => !match.scheduledAt)).toBe(true);
    expect(await client.query(api.schedule.status, { tournamentId })).toBeNull();
  });

  it("takes the same field once there are enough courts to finish in the day", async () => {
    const outcome = await client.mutation(api.schedule.generate, {
      tournamentId,
      token,
      ...ONE_COURT_LONG_MATCHES,
      courts: 4,
      matchMinutes: 30,
    });
    expect(outcome.scheduled).toBeGreaterThan(0);
    expect(outcome.lastFinish.slice(0, 10)).toBe("2026-11-20");
  }, 60_000);

  it("takes the long plan too, once the organiser books the hall for a second day", async () => {
    await client.mutation(api.tournaments.update, {
      tournamentId,
      token,
      endDate: "2026-11-21",
    });
    const outcome = await client.mutation(api.schedule.generate, {
      tournamentId,
      token,
      ...ONE_COURT_LONG_MATCHES,
    });
    expect(outcome.lastFinish.slice(0, 10)).toBe("2026-11-21");
  }, 60_000);
});
