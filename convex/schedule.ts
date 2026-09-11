import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrganiser } from "./lib/auth";
import {
  ScheduleError,
  courtName,
  parseClockTime,
  planSchedule,
  toClockTime,
  type PlannerMatch,
} from "../src/lib/schedule";
import { totalKnockoutRounds } from "./lib/progression";

/**
 * Building the order of play.
 *
 * The arithmetic lives in `src/lib/schedule.ts` as a pure function; this file
 * only turns the stored draw into that function's input and writes the answer
 * back onto the matches. Doing it that way keeps the interesting part testable
 * without a database.
 */

/**
 * Matches that never take a court: byes, walkovers awarded without play, and
 * no contests where both sides withdrew. They still hold their place in the
 * bracket, so they are kept in the ordering and simply given no time slot.
 */
const EMPTY_LABELS = new Set(["BYE", "Withdrawn"]);

function needsNoCourt(match: Doc<"matches">): boolean {
  if (match.status === "walkover" || match.status === "cancelled") return true;
  const aEmpty = match.aId === null && (match.aLabel === null || EMPTY_LABELS.has(match.aLabel));
  const bEmpty = match.bId === null && (match.bLabel === null || EMPTY_LABELS.has(match.bLabel));
  return aEmpty || bEmpty;
}

/**
 * Which matches must finish before this one can start.
 *
 * Knockout rounds are linked by position — (round r, slot s) is fed by
 * (r - 1, 2s) and (r - 1, 2s + 1) — and the third-place playoff is fed by both
 * semi-finals. The first knockout round of a group event waits for the whole
 * group stage, because until the tables are final nobody knows who is in it.
 */
function feedersFor(
  match: Doc<"matches">,
  eventMatches: readonly Doc<"matches">[],
  groupMatchIds: readonly Id<"matches">[],
): Id<"matches">[] {
  if (match.stage === "group") return [];

  const knockout = eventMatches.filter((m) => m.stage === "knockout");
  const totalRounds = totalKnockoutRounds([...eventMatches]);

  if (match.isThirdPlace) {
    return knockout
      .filter((m) => !m.isThirdPlace && m.round === totalRounds - 2)
      .map((m) => m._id);
  }

  if (match.round === 0) return [...groupMatchIds];

  return knockout
    .filter(
      (m) =>
        !m.isThirdPlace &&
        m.round === match.round - 1 &&
        (m.slot === match.slot * 2 || m.slot === match.slot * 2 + 1),
    )
    .map((m) => m._id);
}

export const generate = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    token: v.string(),
    dayStart: v.string(),
    matchMinutes: v.number(),
    restMinutes: v.number(),
    courts: v.number(),
  },
  returns: v.object({ scheduled: v.number(), lastFinish: v.string() }),
  handler: async (ctx, args) => {
    const tournament = await requireOrganiser(ctx, args.tournamentId, args.token);
    if (!tournament.startDate) {
      throw new ConvexError("Set the tournament start date before planning the order of play.");
    }

    const events = await ctx.db
      .query("events")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    const matches = await ctx.db
      .query("matches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();

    if (matches.length === 0) {
      throw new ConvexError("Generate a draw first — there is nothing to schedule yet.");
    }

    const orderOf = new Map(events.map((event) => [event._id, event.order] as const));
    const byEvent = new Map<Id<"events">, Doc<"matches">[]>();
    for (const match of matches) {
      const list = byEvent.get(match.eventId) ?? [];
      list.push(match);
      byEvent.set(match.eventId, list);
    }

    const planner: PlannerMatch[] = matches.map((match) => {
      const eventMatches = byEvent.get(match.eventId) ?? [];
      const groupMatchIds = eventMatches.filter((m) => m.stage === "group").map((m) => m._id);
      const sides = [match.aId, match.bId].filter((id): id is Id<"entries"> => id !== null);
      return {
        id: match._id,
        eventId: match.eventId,
        eventOrder: orderOf.get(match.eventId) ?? 0,
        // Group matches all sit at round 0 of their event; knockout rounds
        // follow the group stage, so they are pushed past it.
        round: match.stage === "group" ? match.round : match.round + 1000,
        slot: match.slot,
        sides,
        feeders: feedersFor(match, eventMatches, groupMatchIds),
        skip: needsNoCourt(match),
      };
    });

    let slots;
    try {
      // Validates the numbers too, and throws a message worth showing.
      parseClockTime(args.dayStart);
      slots = planSchedule(planner, {
        matchMinutes: args.matchMinutes,
        restMinutes: args.restMinutes,
        courts: args.courts,
      });
    } catch (error) {
      if (error instanceof ScheduleError) throw new ConvexError(error.message);
      throw error;
    }

    const now = Date.now();
    const placed = new Set<string>();
    let lastEnd = 0;
    for (const slot of slots) {
      placed.add(slot.matchId);
      lastEnd = Math.max(lastEnd, slot.endMinute);
      await ctx.db.patch(slot.matchId as Id<"matches">, {
        scheduledAt: toClockTime(tournament.startDate, args.dayStart, slot.startMinute),
        scheduleOffset: slot.startMinute,
        court: courtName(slot.court),
        updatedAt: now,
      });
    }

    // Byes never take the court, so they must not keep a stale time either.
    for (const match of matches) {
      if (placed.has(match._id)) continue;
      if (match.scheduledAt === undefined && match.scheduleOffset === undefined) continue;
      await ctx.db.patch(match._id, {
        scheduledAt: undefined,
        scheduleOffset: undefined,
        court: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.tournamentId, {
      schedule: {
        dayStart: args.dayStart,
        matchMinutes: args.matchMinutes,
        restMinutes: args.restMinutes,
        courts: args.courts,
        generatedAt: now,
      },
      updatedAt: now,
    });

    return {
      scheduled: slots.length,
      lastFinish: toClockTime(tournament.startDate, args.dayStart, lastEnd),
    };
  },
});

export const clear = mutation({
  args: { tournamentId: v.id("tournaments"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.token);
    const matches = await ctx.db
      .query("matches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    const now = Date.now();
    for (const match of matches) {
      if (match.scheduledAt === undefined && match.scheduleOffset === undefined) continue;
      await ctx.db.patch(match._id, {
        scheduledAt: undefined,
        scheduleOffset: undefined,
        court: undefined,
        updatedAt: now,
      });
    }
    await ctx.db.patch(args.tournamentId, { schedule: undefined, updatedAt: now });
    return null;
  },
});
