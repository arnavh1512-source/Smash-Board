import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrganiser } from "./lib/auth";
import { resolveWalkovers } from "./lib/progression";
import {
  DrawError,
  generateGroupsKnockout,
  generateKnockout,
  generateRoundRobin,
  validateGroupsKnockout,
  type DraftMatch,
} from "../src/lib/draw";
import { hasPlayedResult } from "../src/lib/results";
import {
  capacityMessage,
  matchesForDraw,
  MAX_MATCHES_PER_DRAW,
  MAX_MATCHES_PER_TOURNAMENT,
} from "../src/lib/capacity";

/**
 * Build (or rebuild) the draw for one category.
 *
 * Every existing match in the category is deleted first. Once anybody has
 * played, that is destructive enough to need saying so explicitly: the
 * mutation refuses unless `force` is set, which the console only sends from
 * the reset-the-draw path.
 */
export const generate = mutation({
  args: {
    eventId: v.id("events"),
    token: v.string(),
    /** Shuffle unseeded entrants before placing them. */
    randomise: v.boolean(),
    /** Throw away results that have already been played. */
    force: v.optional(v.boolean()),
  },
  returns: v.object({ matches: v.number() }),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("That category no longer exists.");
    await requireOrganiser(ctx, event.tournamentId, args.token);

    const allEntries = await ctx.db
      .query("entries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const active = allEntries.filter((e) => !e.withdrawn);
    if (active.length < 2) {
      throw new ConvexError("Add at least two entrants before making the draw.");
    }

    // The last door before the writes. The entry doors already refuse a field
    // this format cannot run, but the field shrinks and grows by withdrawal and
    // the settings can be edited, so the count is checked against the shape
    // once more here, where the insert would actually happen.
    const willMake = matchesForDraw(active.length, event);
    if (willMake > MAX_MATCHES_PER_DRAW) {
      throw new ConvexError(capacityMessage(event));
    }

    // And the same question for the tournament as a whole, because deleting it
    // deletes every match under every category in one mutation. This category's
    // existing matches are about to be replaced, so they do not count.
    const elsewhere = await ctx.db
      .query("matches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", event.tournamentId))
      .collect();
    const others = elsewhere.filter((m) => m.eventId !== args.eventId).length;
    if (others + willMake > MAX_MATCHES_PER_TOURNAMENT) {
      throw new ConvexError(
        `A tournament holds at most ${MAX_MATCHES_PER_TOURNAMENT} matches, and the other ` +
          `categories already have ${others}. This draw would add ${willMake}. Split the ` +
          `entrants across more categories, or run this one as a knockout.`,
      );
    }

    // A category switched from singles to doubles keeps the entrants it already
    // had, and those are one name short. Drawing them would put a half pair on
    // court, so name them and stop.
    if (event.teamSize === 2) {
      const halfPairs = active.filter((e) => !e.playerTwo);
      if (halfPairs.length > 0) {
        const named = halfPairs.slice(0, 3).map((e) => e.playerOne).join(", ");
        throw new ConvexError(
          `This is a doubles category, so every entry needs two players. Add a partner for ${named}` +
            (halfPairs.length > 3 ? ` and ${halfPairs.length - 3} more.` : "."),
        );
      }
    }

    // Seeded entrants keep their order; the rest are optionally shuffled so the
    // same list does not always produce the same bracket.
    const seeded = active
      .filter((e) => e.seed > 0)
      .sort((a, b) => a.seed - b.seed);
    const unseeded = active.filter((e) => e.seed === 0);
    if (args.randomise) shuffle(unseeded);
    else unseeded.sort((a, b) => a.createdAt - b.createdAt);

    const ordered = [...seeded, ...unseeded].map((e) => e._id as string);

    let drafts: DraftMatch[];
    try {
      if (event.format === "knockout") {
        drafts = generateKnockout(ordered, { thirdPlace: event.thirdPlace });
      } else if (event.format === "round_robin") {
        drafts = generateRoundRobin(ordered, 0, event.doubleRound);
      } else {
        // Checked before generating as well as inside it, so the organiser gets
        // the message before anything is deleted.
        validateGroupsKnockout(ordered.length, {
          groupCount: event.groupCount,
          advancePerGroup: event.advancePerGroup,
        });
        drafts = generateGroupsKnockout(ordered, {
          groupCount: event.groupCount,
          advancePerGroup: event.advancePerGroup,
          doubleRound: event.doubleRound,
          thirdPlace: event.thirdPlace,
        });
      }
    } catch (error) {
      if (error instanceof DrawError) throw new ConvexError(error.message);
      throw error;
    }

    if (drafts.length === 0) throw new ConvexError("That combination produces no matches.");

    const existing = await ctx.db
      .query("matches")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    if (!args.force && existing.some(hasPlayedResult)) {
      throw new ConvexError(
        "Results have already been entered for this category, and making the draw again would delete them. Reset the draw first if that is really what you want.",
      );
    }
    for (const match of existing) await ctx.db.delete(match._id);

    const now = Date.now();
    for (const draft of drafts) {
      await ctx.db.insert("matches", {
        tournamentId: event.tournamentId,
        eventId: args.eventId,
        stage: draft.stage,
        groupIndex: draft.groupIndex,
        round: draft.round,
        slot: draft.slot,
        aId: (draft.aId as Id<"entries"> | null) ?? null,
        bId: (draft.bId as Id<"entries"> | null) ?? null,
        aLabel: draft.aLabel,
        bLabel: draft.bLabel,
        sets: [],
        status: "scheduled",
        winnerId: null,
        isThirdPlace: draft.isThirdPlace,
        updatedAt: now,
      });
    }

    await resolveWalkovers(ctx, args.eventId);
    await ctx.db.patch(args.eventId, { drawGeneratedAt: now });
    await ctx.db.patch(event.tournamentId, { updatedAt: now });

    return { matches: drafts.length };
  },
});

export const clear = mutation({
  args: { eventId: v.id("events"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("That category no longer exists.");
    await requireOrganiser(ctx, event.tournamentId, args.token);

    const existing = await ctx.db
      .query("matches")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const match of existing) await ctx.db.delete(match._id);
    await ctx.db.patch(args.eventId, { drawGeneratedAt: null });
    return null;
  },
});

/** Fisher-Yates, using the runtime's cryptographic RNG. */
function shuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const j = bytes[0] % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
}
