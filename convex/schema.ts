import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Scoring rules, stored per event so one tournament can mix formats. */
export const scoringValidator = v.object({
  pointsPerSet: v.number(),
  bestOf: v.number(),
  endMode: v.union(v.literal("deuce"), v.literal("golden")),
  cap: v.union(v.number(), v.null()),
});

/**
 * How the order of play is built. Times are held as minutes so the planner can
 * do arithmetic on them; the start day comes from the tournament's startDate.
 */
export const scheduleValidator = v.object({
  /** Local wall-clock start of play, "HH:MM" on a 24-hour clock. */
  dayStart: v.string(),
  /** How long one match is allowed on court, including the knock-up. */
  matchMinutes: v.number(),
  /** Minimum rest a player is guaranteed between two of their matches. */
  restMinutes: v.number(),
  /** How many courts run in parallel. */
  courts: v.number(),
  /** When the planner last ran, so the console can say the plan is stale. */
  generatedAt: v.union(v.number(), v.null()),
});

export const matchStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("live"),
  v.literal("completed"),
  v.literal("walkover"),
  /**
   * Nobody can play it: both sides withdrew, or the only entrants left were
   * taken out of the draw. It is neither scheduled nor finished, so it is kept
   * off the order of play and read as a no contest.
   */
  v.literal("cancelled"),
);

export default defineSchema({
  tournaments: defineTable({
    name: v.string(),
    /** Short public code used in the URL, e.g. "ahmedabad-open-26". */
    slug: v.string(),
    venue: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    organiserName: v.optional(v.string()),
    organiserPhone: v.optional(v.string()),
    /** SHA-256 of salt + PIN. The PIN itself is never stored. */
    pinHash: v.string(),
    pinSalt: v.string(),
    /**
     * Optional second PIN that unlocks score entry and nothing else, so an
     * umpire can be handed a phone without being handed the whole console.
     * Hashed with the same salt as the organiser PIN.
     */
    refereePinHash: v.optional(v.string()),
    /** Order-of-play settings. Absent until the organiser plans the day. */
    schedule: v.optional(scheduleValidator),
    /** Hidden tournaments stay reachable by link but are not listed. */
    isPublic: v.boolean(),
    /** Consecutive wrong PINs, reset on success. Drives the lockout below. */
    failedPinAttempts: v.optional(v.number()),
    /** Epoch millis until which PIN checks are refused. */
    pinLockedUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    // The public list reads only listed tournaments, newest first.
    .index("by_public", ["isPublic", "createdAt"]),

  events: defineTable({
    tournamentId: v.id("tournaments"),
    /** Display name, e.g. "Men's Singles" or "U-17 Doubles". */
    name: v.string(),
    /** 1 for singles, 2 for doubles. Drives the second-player field. */
    teamSize: v.number(),
    format: v.union(
      v.literal("knockout"),
      v.literal("round_robin"),
      v.literal("groups_knockout"),
    ),
    scoring: scoringValidator,
    /**
     * Optional rules for the closing rounds, so a category can run the early
     * rounds to a single game and still finish to the full best-of-three.
     * Absent means the round is played under `scoring`.
     */
    semiFinalScoring: v.optional(v.union(scoringValidator, v.null())),
    /** Also governs the third-place playoff, which shares the final's round. */
    finalScoring: v.optional(v.union(scoringValidator, v.null())),
    /** Knockout options. */
    thirdPlace: v.boolean(),
    /** Group stage options, ignored by the other formats. */
    groupCount: v.number(),
    advancePerGroup: v.number(),
    doubleRound: v.boolean(),
    /** Set once a draw has been generated, so entries can be locked. */
    drawGeneratedAt: v.union(v.number(), v.null()),
    order: v.number(),
    createdAt: v.number(),
  }).index("by_tournament", ["tournamentId"]),

  entries: defineTable({
    tournamentId: v.id("tournaments"),
    eventId: v.id("events"),
    /** Player one, always present. */
    playerOne: v.string(),
    /** Player two for doubles events. */
    playerTwo: v.optional(v.string()),
    club: v.optional(v.string()),
    phone: v.optional(v.string()),
    /** 1-based seed; 0 means unseeded. */
    seed: v.number(),
    /** Withdrawn entrants stay on record but are excluded from new draws. */
    withdrawn: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_tournament", ["tournamentId"]),

  matches: defineTable({
    tournamentId: v.id("tournaments"),
    eventId: v.id("events"),
    stage: v.union(v.literal("group"), v.literal("knockout")),
    groupIndex: v.union(v.number(), v.null()),
    round: v.number(),
    slot: v.number(),
    aId: v.union(v.id("entries"), v.null()),
    bId: v.union(v.id("entries"), v.null()),
    /** Placeholder text while a side is undecided, e.g. "Winner of SF1". */
    aLabel: v.union(v.string(), v.null()),
    bLabel: v.union(v.string(), v.null()),
    sets: v.array(v.object({ a: v.number(), b: v.number() })),
    status: matchStatusValidator,
    winnerId: v.union(v.id("entries"), v.null()),
    isThirdPlace: v.boolean(),
    court: v.optional(v.string()),
    /** Local start time as "YYYY-MM-DDTHH:MM", written by the planner. */
    scheduledAt: v.optional(v.string()),
    /** Minutes from the first match of the tournament. Kept for ordering. */
    scheduleOffset: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_tournament", ["tournamentId"])
    .index("by_event_stage", ["eventId", "stage"]),
});
