import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrganiser, requireScorer } from "./lib/auth";
import { matchStatusValidator } from "./schema";
import {
  advanceKnockout,
  clearGroupQualifiers,
  fillKnockoutFromGroups,
  resolveWalkovers,
  scoringForMatch,
  winnerFromSets,
} from "./lib/progression";
import { evaluateMatch, ScoringError, type SetScore } from "../src/lib/scoring";
import { hasPlayedResult } from "../src/lib/results";
import { isTimestamp } from "../src/lib/schedule";

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
  // Written by the planner alongside scheduledAt. Leaving it out of the
  // validator made every match list throw the moment an order of play was
  // planned, taking the console and the public scoreboard down with it.
  scheduleOffset: v.optional(v.number()),
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

/** Group matches come first, then the knockout in bracket order. */
const STAGE_ORDER = { group: 0, knockout: 1 } as const;

function sortMatches(rows: Doc<"matches">[]): Doc<"matches">[] {
  return [...rows].sort(
    (a, b) =>
      STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
      (a.groupIndex ?? 0) - (b.groupIndex ?? 0) ||
      a.round - b.round ||
      Number(a.isThirdPlace) - Number(b.isThirdPlace) ||
      a.slot - b.slot,
  );
}

/**
 * Load a match for someone entering a result. Either PIN opens this door: an
 * umpire with the referee PIN can score, and only score.
 */
async function loadMatchForScorer(
  ctx: Parameters<typeof requireScorer>[0],
  matchId: Id<"matches">,
  token: string,
) {
  const match = await ctx.db.get(matchId);
  if (!match) throw new ConvexError("That match no longer exists.");
  await requireScorer(ctx, match.tournamentId, token);
  const event = await ctx.db.get(match.eventId);
  if (!event) throw new ConvexError("That category no longer exists.");
  return { match, event };
}

/** Load a match for an action only the organiser may take. */
async function loadMatchForOrganiser(
  ctx: Parameters<typeof requireOrganiser>[0],
  matchId: Id<"matches">,
  token: string,
) {
  const match = await ctx.db.get(matchId);
  if (!match) throw new ConvexError("That match no longer exists.");
  await requireOrganiser(ctx, match.tournamentId, token);
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
    token: v.string(),
    sets: v.array(v.object({ a: v.number(), b: v.number() })),
    /** "live" keeps the match on court; "completed" is inferred when decided. */
    markLive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { match, event } = await loadMatchForScorer(ctx, args.matchId, args.token);
    if (!match.aId || !match.bId) {
      throw new ConvexError("Both sides must be decided before a score can be entered.");
    }
    // The mirror of the guard in `setWalkover`. Correcting a result is a
    // deliberate two-step move - reset, then enter the right thing - and the
    // rule has to run both ways or it is not a rule: a walkover that can be
    // typed over with a score would let a match that was awarded to somebody
    // turn into a played one with no trace that it had ever been awarded, and
    // whoever was advanced by the walkover would be moved on by a different
    // route than the one that put them there.
    if (match.status === "walkover") {
      throw new ConvexError(
        "This match was awarded as a walkover. Reset it before entering a played score.",
      );
    }

    // The closing rounds may be played to different rules, so the scores are
    // judged against this match's own configuration rather than the category's.
    const scoring = await scoringForMatch(ctx, event, match);

    const sets = args.sets as SetScore[];
    let winnerSide;
    try {
      winnerSide = evaluateMatch(sets, scoring);
    } catch (error) {
      if (error instanceof ScoringError) throw new ConvexError(error.message);
      throw error;
    }

    const winnerId = winnerSide.complete ? winnerFromSets({ ...match, sets }, scoring) : null;
    const status = winnerSide.complete ? "completed" : args.markLive === false ? "scheduled" : "live";

    await ctx.db.patch(args.matchId, {
      sets,
      status,
      winnerId,
      updatedAt: Date.now(),
    });

    await advanceKnockout(ctx, { ...match, sets, winnerId }, winnerId);
    if (match.stage === "group") await fillKnockoutFromGroups(ctx, event);
    // The slot this result just filled may sit opposite a withdrawal or a bye.
    await resolveWalkovers(ctx, event._id);
    await ctx.db.patch(match.tournamentId, { updatedAt: Date.now() });
    return null;
  },
});

/** Award the match without play, e.g. an injury or a no-show. */
export const setWalkover = mutation({
  args: {
    matchId: v.id("matches"),
    token: v.string(),
    winnerId: v.union(v.id("entries"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { match, event } = await loadMatchForScorer(ctx, args.matchId, args.token);
    if (args.winnerId && args.winnerId !== match.aId && args.winnerId !== match.bId) {
      throw new ConvexError("The winner must be one of the two sides in this match.");
    }

    // A played result is never turned into a walkover in place, and it is never
    // cleared here either. Correcting one is a two-step move everywhere else in
    // the console — reset, then enter the right thing — and going straight from
    // 21-15 to "did not play" would erase a score with one tap and no trace of
    // what it was. The guard is on the result this match already holds, not on
    // the winner being handed in: `winnerId: null` is the erasing direction, so
    // gating on a truthy winner would have left the destructive half open.
    //
    // A bye is deliberately not a played result — one side is empty and the
    // generator awarded it the moment the draw was made — so the draw can still
    // rewrite its own walkovers.
    if (hasPlayedResult(match)) {
      throw new ConvexError(
        "This match already has a result. Reset it first, then award the walkover.",
      );
    }

    await ctx.db.patch(args.matchId, {
      sets: [],
      status: args.winnerId ? "walkover" : "scheduled",
      winnerId: args.winnerId,
      updatedAt: Date.now(),
    });

    await advanceKnockout(ctx, { ...match, sets: [], winnerId: args.winnerId }, args.winnerId);
    if (match.stage === "group") await fillKnockoutFromGroups(ctx, event);
    await resolveWalkovers(ctx, event._id);
    await ctx.db.patch(match.tournamentId, { updatedAt: Date.now() });
    return null;
  },
});

/** Wipe a result and pull the entrant back out of later rounds. */
export const reset = mutation({
  args: { matchId: v.id("matches"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { match, event } = await loadMatchForScorer(ctx, args.matchId, args.token);
    await ctx.db.patch(args.matchId, {
      sets: [],
      status: "scheduled",
      winnerId: null,
      updatedAt: Date.now(),
    });
    await advanceKnockout(ctx, { ...match, sets: [], winnerId: null }, null);
    // The group table has changed, so the qualifiers it fed into the knockout
    // are no longer decided and must come back out.
    if (match.stage === "group") await clearGroupQualifiers(ctx, event);
    await ctx.db.patch(match.tournamentId, { updatedAt: Date.now() });
    return null;
  },
});

export const setDetails = mutation({
  args: {
    matchId: v.id("matches"),
    token: v.string(),
    court: v.optional(v.string()),
    scheduledAt: v.optional(v.string()),
    status: v.optional(matchStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { match } = await loadMatchForOrganiser(ctx, args.matchId, args.token);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.court !== undefined) patch.court = args.court.trim().slice(0, 40) || undefined;
    if (args.scheduledAt !== undefined) {
      // The planner writes these, and the order of play, the day headings and
      // the rest calculation all read them back by their shape. A hand-typed
      // "tomorrow" would not throw anywhere - it would quietly sort to the top
      // of the timetable and count as no rest at all - so the shape is checked
      // at the door instead of trusted downstream.
      const when = args.scheduledAt.trim();
      if (when && !isTimestamp(when)) {
        throw new ConvexError("The time must be a real date and time, like 2026-09-12T09:30.");
      }
      patch.scheduledAt = when || undefined;
    }
    if (args.status !== undefined) {
      if (args.status === "completed" || args.status === "walkover") {
        throw new ConvexError("Enter a score or a walkover to finish a match.");
      }
      if (args.status === "cancelled") {
        // A no contest is something the draw works out for itself once both
        // sides are empty; typing it in by hand would hide a live match.
        throw new ConvexError("Withdraw the entrants to take a match out of the draw.");
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
