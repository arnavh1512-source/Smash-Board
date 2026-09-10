import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganiser } from "./lib/auth";
import { scoringValidator } from "./schema";
import { validateConfig, ScoringError, type ScoringConfig } from "../src/lib/scoring";

const formatValidator = v.union(
  v.literal("knockout"),
  v.literal("round_robin"),
  v.literal("groups_knockout"),
);

const eventValidator = v.object({
  _id: v.id("events"),
  _creationTime: v.number(),
  tournamentId: v.id("tournaments"),
  name: v.string(),
  teamSize: v.number(),
  format: formatValidator,
  scoring: scoringValidator,
  thirdPlace: v.boolean(),
  groupCount: v.number(),
  advancePerGroup: v.number(),
  doubleRound: v.boolean(),
  drawGeneratedAt: v.union(v.number(), v.null()),
  order: v.number(),
  createdAt: v.number(),
});

/** Surface a scoring rule problem as a message the organiser can act on. */
function checkScoring(scoring: ScoringConfig) {
  try {
    validateConfig(scoring);
  } catch (error) {
    if (error instanceof ScoringError) throw new ConvexError(error.message);
    throw error;
  }
}

export const listByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  returns: v.array(eventValidator),
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    return events.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  },
});

export const create = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    pin: v.string(),
    name: v.string(),
    teamSize: v.number(),
    format: formatValidator,
    scoring: scoringValidator,
    thirdPlace: v.boolean(),
    groupCount: v.number(),
    advancePerGroup: v.number(),
    doubleRound: v.boolean(),
  },
  returns: v.id("events"),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.pin);

    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Give the category a name.");
    if (args.teamSize !== 1 && args.teamSize !== 2) {
      throw new ConvexError("A category is either singles (1) or doubles (2).");
    }
    checkScoring(args.scoring);
    if (args.groupCount < 1 || args.groupCount > 32) {
      throw new ConvexError("Groups must be between 1 and 32.");
    }
    if (args.advancePerGroup < 1 || args.advancePerGroup > 8) {
      throw new ConvexError("Between 1 and 8 entrants can advance from a group.");
    }

    const existing = await ctx.db
      .query("events")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();

    return await ctx.db.insert("events", {
      tournamentId: args.tournamentId,
      name: name.slice(0, 80),
      teamSize: args.teamSize,
      format: args.format,
      scoring: args.scoring,
      thirdPlace: args.thirdPlace,
      groupCount: args.groupCount,
      advancePerGroup: args.advancePerGroup,
      doubleRound: args.doubleRound,
      drawGeneratedAt: null,
      order: existing.length,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    eventId: v.id("events"),
    pin: v.string(),
    name: v.optional(v.string()),
    teamSize: v.optional(v.number()),
    format: v.optional(formatValidator),
    scoring: v.optional(scoringValidator),
    thirdPlace: v.optional(v.boolean()),
    groupCount: v.optional(v.number()),
    advancePerGroup: v.optional(v.number()),
    doubleRound: v.optional(v.boolean()),
    order: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("That category no longer exists.");
    await requireOrganiser(ctx, event.tournamentId, args.pin);

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 2) throw new ConvexError("Give the category a name.");
      patch.name = name.slice(0, 80);
    }
    if (args.teamSize !== undefined) {
      if (args.teamSize !== 1 && args.teamSize !== 2) {
        throw new ConvexError("A category is either singles (1) or doubles (2).");
      }
      patch.teamSize = args.teamSize;
    }
    if (args.format !== undefined) patch.format = args.format;
    if (args.scoring !== undefined) {
      checkScoring(args.scoring);
      patch.scoring = args.scoring;
    }
    if (args.thirdPlace !== undefined) patch.thirdPlace = args.thirdPlace;
    if (args.groupCount !== undefined) {
      if (args.groupCount < 1 || args.groupCount > 32) {
        throw new ConvexError("Groups must be between 1 and 32.");
      }
      patch.groupCount = args.groupCount;
    }
    if (args.advancePerGroup !== undefined) {
      if (args.advancePerGroup < 1 || args.advancePerGroup > 8) {
        throw new ConvexError("Between 1 and 8 entrants can advance from a group.");
      }
      patch.advancePerGroup = args.advancePerGroup;
    }
    if (args.doubleRound !== undefined) patch.doubleRound = args.doubleRound;
    if (args.order !== undefined) patch.order = args.order;

    await ctx.db.patch(args.eventId, patch);
    await ctx.db.patch(event.tournamentId, { updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { eventId: v.id("events"), pin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return null;
    await requireOrganiser(ctx, event.tournamentId, args.pin);

    const matches = await ctx.db
      .query("matches")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const match of matches) await ctx.db.delete(match._id);

    const entries = await ctx.db
      .query("entries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const entry of entries) await ctx.db.delete(entry._id);

    await ctx.db.delete(args.eventId);
    return null;
  },
});
