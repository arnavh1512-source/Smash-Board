import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrganiser } from "./lib/auth";
import { matchStatusValidator } from "./schema";
import { advanceKnockout, fillKnockoutFromGroups, winnerFromSets } from "./lib/progression";
import { evaluateMatch, ScoringError, type ScoringConfig, type SetScore } from "../src/lib/scoring";

const matchValidator = v.object({
  _id: v.id("matches"),
  _creationTime: v.number(),
  tournamentId: v.id("tournaments"),
  eventId: v.id("events"),
  stage: v.union(v.literal("group"), v.literal("knockout")),
  groupIndex: v.union(v.number(), v.null()),
  round: v.number(),
  slot: v.number(),
  aId: v.union(v.id("entries"), v.null()),
  bId: v.union(v.id("entries"), v.null()),
  aLabel: v.union(v.string(), v.null()),
  bLabel: v.union(v.string(), v.null()),
  sets: v.array(v.object({ a: v.number(), b: v.number() })),
  status: matchStatusValidator,
  winnerId: v.union(v.id("entries"), v.null()),
  isThirdPlace: v.boolean(),
  court: v.optional(v.string()),
  scheduledAt: v.optional(v.string()),
  updatedAt: v.number(),
});

export const listByEvent = query({
  args: { eventId: v.id("events") },
  returns: v.array(matchValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("matches")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    return sortMatches(rows);
  },
});

export const listByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  returns: v.array(matchValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("matches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    return sortMatches(rows);
  },
});

function sortMatches(rows: Doc<"matches">[]): Doc<"matches">[] {
  return [...rows].sort(
    (a, b) =>
      a.stage.localeCompare(b.stage) ||
      (a.groupIndex ?? 0) - (b.groupIndex ?? 0) ||
      a.round - b.round ||
      Number(a.isThirdPlace) - Number(b.isThirdPlace) ||
      a.slot - b.slot,
  );
}

async function loadMatchForOrganiser(ctx: Parameters<typeof requireOrganiser>[0], matchId: Id<"matches">, pin: string) {
  const match = await ctx.db.get(matchId);
  if (!match) throw new ConvexError("That match no longer exists.");
  await requireOrganiser(ctx, match.tournamentId, pin);
  const event = await ctx.db.get(match.eventId);
  if (!event) throw new ConvexError("That category no longer exists.");
  return { match, event };
}

/**
 * Write a full set list onto a match.
 *
 * The scores are validated against the category's rules, so an impossible
 * line like 21-5 in a golden-point-to-11 category is rejected rather than
 * stored. When the sets decide the match, the winner is advanced immediately.
 */
export const setScore = mutation({
  args: {
    matchId: v.id("matches"),
    pin: v.string(),
    sets: v.array(v.object({ a: v.number(), b: v.number() })),
    /** "live" keeps the match on court; "completed" is inferred when decided. */
    markLive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { match, event } = await loadMatchForOrganiser(ctx, args.matchId, args.pin);
    if (!match.aId || !match.bId) {
      throw new ConvexError("Both sides must be decided before a score can be entered.");
    }

    const sets = args.sets as SetScore[];
    let winnerSide;
    try {
      winnerSide = evaluateMatch(sets, event.scoring as ScoringConfig);
    } catch (error) {
      if (error instanceof ScoringError) throw new ConvexError(error.message);
      throw error;
    }

    const winnerId = winnerSide.complete ? winnerFromSets({ ...match, sets }, event.scoring as ScoringConfig) : null;
    const status = winnerSide.complete ? "completed" : args.markLive === false ? "scheduled" : "live";

    await ctx.db.patch(args.matchId, {
      sets,
      status,
      winnerId,
      updatedAt: Date.now(),
    });

    await advanceKnockout(ctx, { ...match, sets, winnerId }, winnerId);
    if (match.stage === "group") await fillKnockoutFromGroups(ctx, event);
    await ctx.db.patch(match.tournamentId, { updatedAt: Date.now() });
    return null;
  },
});

/** Award the match without play, e.g. an injury or a no-show. */
export const setWalkover = mutation({
  args: {
    matchId: v.id("matches"),
    pin: v.string(),
    winnerId: v.union(v.id("entries"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { match, event } = await loadMatchForOrganiser(ctx, args.matchId, args.pin);
    if (args.winnerId && args.winnerId !== match.aId && args.winnerId !== match.bId) {
      throw new ConvexError("The winner must be one of the two sides in this match.");
    }

    await ctx.db.patch(args.matchId, {
      sets: [],
      status: args.winnerId ? "walkover" : "scheduled",
      winnerId: args.winnerId,
      updatedAt: Date.now(),
    });

    await advanceKnockout(ctx, { ...match, sets: [], winnerId: args.winnerId }, args.winnerId);
    if (match.stage === "group") await fillKnockoutFromGroups(ctx, event);
    return null;
  },
});

/** Wipe a result and pull the entrant back out of later rounds. */
export const reset = mutation({
  args: { matchId: v.id("matches"), pin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { match } = await loadMatchForOrganiser(ctx, args.matchId, args.pin);
    await ctx.db.patch(args.matchId, {
      sets: [],
      status: "scheduled",
      winnerId: null,
      updatedAt: Date.now(),
    });
    await advanceKnockout(ctx, { ...match, sets: [], winnerId: null }, null);
    return null;
  },
});

export const setDetails = mutation({
  args: {
    matchId: v.id("matches"),
    pin: v.string(),
    court: v.optional(v.string()),
    scheduledAt: v.optional(v.string()),
    status: v.optional(matchStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { match } = await loadMatchForOrganiser(ctx, args.matchId, args.pin);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.court !== undefined) patch.court = args.court.trim().slice(0, 40) || undefined;
    if (args.scheduledAt !== undefined) {
      patch.scheduledAt = args.scheduledAt.trim().slice(0, 40) || undefined;
    }
    if (args.status !== undefined) {
      if (args.status === "completed" || args.status === "walkover") {
        throw new ConvexError("Enter a score or a walkover to finish a match.");
      }
      if (match.winnerId) {
        throw new ConvexError("Reset the result before changing the status.");
      }
      patch.status = args.status;
    }

    await ctx.db.patch(args.matchId, patch);
    return null;
  },
});
