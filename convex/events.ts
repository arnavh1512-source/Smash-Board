import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireOrganiser } from "./lib/auth";
import { scoringValidator } from "./schema";
import { countKnockoutRounds } from "../src/lib/draw";
import { validateConfig, ScoringError, type ScoringConfig } from "../src/lib/scoring";
import { hasPlayedResult } from "../src/lib/results";

const formatValidator = v.union(
  v.literal("knockout"),
  v.literal("round_robin"),
  v.literal("groups_knockout"),
);

/** An optional override: absent leaves it alone, null clears it. */
const roundScoringValidator = v.optional(v.union(scoringValidator, v.null()));

const eventValidator = v.object({
  _id: v.id("events"),
  _creationTime: v.number(),
  tournamentId: v.id("tournaments"),
  name: v.string(),
  teamSize: v.number(),
  format: formatValidator,
  scoring: scoringValidator,
  semiFinalScoring: roundScoringValidator,
  finalScoring: roundScoringValidator,
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

function sameScoring(
  a: ScoringConfig | null | undefined,
  b: ScoringConfig | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.pointsPerSet === b.pointsPerSet &&
    a.bestOf === b.bestOf &&
    a.endMode === b.endMode &&
    a.cap === b.cap
  );
}

/**
 * Refuse a rule change that the draw has already been built around.
 *
 * Changing the format or the scoring underneath a live draw silently
 * invalidates every match already played: a bracket sized for 16 does not
 * become a group stage, and a score that was legal under 21 points may be
 * impossible under 15. The organiser clears the draw first, deliberately.
 */
function assertUnlocked(event: Doc<"events">, field: string): void {
  if (event.drawGeneratedAt === null) return;
  throw new ConvexError(
    `The draw for ${event.name} has already been made, so ${field} can no longer change. Clear the draw first, then change it and draw again.`,
  );
}

/**
 * The closing rounds are the one setting that may still move after the draw,
 * because they change nothing about the shape of the bracket - but only while
 * the round in question is still unplayed.
 */
async function assertRoundUnplayed(
  ctx: MutationCtx,
  event: Doc<"events">,
  fromEnd: 0 | 1,
  label: string,
): Promise<void> {
  if (event.drawGeneratedAt === null) return;

  const knockout = await ctx.db
    .query("matches")
    .withIndex("by_event_stage", (q) => q.eq("eventId", event._id).eq("stage", "knockout"))
    .collect();
  const totalRounds = countKnockoutRounds(knockout);
  if (totalRounds < 1) return;

  const played = knockout.some(
    (m) =>
      totalRounds - 1 - m.round === fromEnd &&
      (m.status === "live" || m.sets.length > 0 || m.winnerId !== null),
  );
  if (played) {
    throw new ConvexError(
      `The ${label} has already been played, so its scoring can no longer change.`,
    );
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
    token: v.string(),
    name: v.string(),
    teamSize: v.number(),
    format: formatValidator,
    scoring: scoringValidator,
    semiFinalScoring: roundScoringValidator,
    finalScoring: roundScoringValidator,
    thirdPlace: v.boolean(),
    groupCount: v.number(),
    advancePerGroup: v.number(),
    doubleRound: v.boolean(),
  },
  returns: v.id("events"),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.token);

    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Give the category a name.");
    if (args.teamSize !== 1 && args.teamSize !== 2) {
      throw new ConvexError("A category is either singles (1) or doubles (2).");
    }
    checkScoring(args.scoring);
    if (args.semiFinalScoring) checkScoring(args.semiFinalScoring);
    if (args.finalScoring) checkScoring(args.finalScoring);
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
      semiFinalScoring: args.semiFinalScoring ?? null,
      finalScoring: args.finalScoring ?? null,
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
    token: v.string(),
    name: v.optional(v.string()),
    teamSize: v.optional(v.number()),
    format: v.optional(formatValidator),
    scoring: v.optional(scoringValidator),
    semiFinalScoring: roundScoringValidator,
    finalScoring: roundScoringValidator,
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
    await requireOrganiser(ctx, event.tournamentId, args.token);

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 2) throw new ConvexError("Give the category a name.");
      patch.name = name.slice(0, 80);
    }
    // Only a real change is refused. Re-sending the settings unchanged, which
    // is what the form does every time it is saved, has to keep working.
    if (args.teamSize !== undefined && args.teamSize !== event.teamSize) {
      if (args.teamSize !== 1 && args.teamSize !== 2) {
        throw new ConvexError("A category is either singles (1) or doubles (2).");
      }
      assertUnlocked(event, "singles or doubles");
      patch.teamSize = args.teamSize;
    }
    if (args.format !== undefined && args.format !== event.format) {
      assertUnlocked(event, "the format");
      patch.format = args.format;
    }
    if (args.scoring !== undefined && !sameScoring(args.scoring, event.scoring as ScoringConfig)) {
      checkScoring(args.scoring);
      assertUnlocked(event, "the scoring");
      patch.scoring = args.scoring;
    }
    if (
      args.semiFinalScoring !== undefined &&
      !sameScoring(args.semiFinalScoring, event.semiFinalScoring)
    ) {
      if (args.semiFinalScoring) checkScoring(args.semiFinalScoring);
      await assertRoundUnplayed(ctx, event, 1, "semi-final");
      patch.semiFinalScoring = args.semiFinalScoring;
    }
    if (
      args.finalScoring !== undefined &&
      !sameScoring(args.finalScoring, event.finalScoring)
    ) {
      if (args.finalScoring) checkScoring(args.finalScoring);
      await assertRoundUnplayed(ctx, event, 0, "final");
      patch.finalScoring = args.finalScoring;
    }
    if (args.thirdPlace !== undefined && args.thirdPlace !== event.thirdPlace) {
      assertUnlocked(event, "the third-place playoff");
      patch.thirdPlace = args.thirdPlace;
    }
    if (args.groupCount !== undefined && args.groupCount !== event.groupCount) {
      if (args.groupCount < 1 || args.groupCount > 32) {
        throw new ConvexError("Groups must be between 1 and 32.");
      }
      assertUnlocked(event, "the number of groups");
      patch.groupCount = args.groupCount;
    }
    if (args.advancePerGroup !== undefined && args.advancePerGroup !== event.advancePerGroup) {
      if (args.advancePerGroup < 1 || args.advancePerGroup > 8) {
        throw new ConvexError("Between 1 and 8 entrants can advance from a group.");
      }
      assertUnlocked(event, "how many advance from each group");
      patch.advancePerGroup = args.advancePerGroup;
    }
    if (args.doubleRound !== undefined && args.doubleRound !== event.doubleRound) {
      assertUnlocked(event, "playing each group twice");
      patch.doubleRound = args.doubleRound;
    }
    if (args.order !== undefined) {
      if (!Number.isInteger(args.order) || args.order < 0) {
        throw new ConvexError("Order must be a non-negative whole number.");
      }
      patch.order = args.order;
    }

    await ctx.db.patch(args.eventId, patch);
    await ctx.db.patch(event.tournamentId, { updatedAt: Date.now() });
    return null;
  },
});

/**
 * Delete a category and everything under it.
 *
 * An empty category goes quietly. One that has been played is a record of a
 * competition, and deleting it cannot be undone from anywhere in the product,
 * so it needs the same deliberate second step the destructive redraw needs:
 * the console asks again and only then sends `force`.
 */
export const remove = mutation({
  args: {
    eventId: v.id("events"),
    token: v.string(),
    /** Throw away results that have already been played. */
    force: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return null;
    await requireOrganiser(ctx, event.tournamentId, args.token);

    const matches = await ctx.db
      .query("matches")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    if (!args.force && matches.some(hasPlayedResult)) {
      throw new ConvexError(
        "This category has results in it. Deleting it would throw away matches that have been played — confirm the deletion to go ahead.",
      );
    }

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
