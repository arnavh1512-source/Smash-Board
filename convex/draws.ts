import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrganiser } from "./lib/auth";
import { resolveByes } from "./lib/progression";
import {
  generateGroupsKnockout,
  generateKnockout,
  generateRoundRobin,
  type DraftMatch,
} from "../src/lib/draw";

/**
 * Build (or rebuild) the draw for one category.
 *
 * Every existing match in the category is deleted first, so scores already
 * entered are lost. The UI asks for confirmation before calling this.
 */
export const generate = mutation({
  args: {
    eventId: v.id("events"),
    pin: v.string(),
    /** Shuffle unseeded entrants before placing them. */
    randomise: v.boolean(),
  },
  returns: v.object({ matches: v.number() }),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("That category no longer exists.");
    await requireOrganiser(ctx, event.tournamentId, args.pin);

    const allEntries = await ctx.db
      .query("entries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const active = allEntries.filter((e) => !e.withdrawn);
    if (active.length < 2) {
      throw new ConvexError("Add at least two entrants before making the draw.");
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
    if (event.format === "knockout") {
      drafts = generateKnockout(ordered, {
        thirdPlace: event.thirdPlace,
        seededCount: event.seededCount,
      });
    } else if (event.format === "round_robin") {
      drafts = generateRoundRobin(ordered, 0, event.doubleRound);
    } else {
      if (event.groupCount > ordered.length) {
        throw new ConvexError("There are fewer entrants than groups.");
      }
      drafts = generateGroupsKnockout(ordered, {
        groupCount: event.groupCount,
        advancePerGroup: event.advancePerGroup,
        doubleRound: event.doubleRound,
        thirdPlace: event.thirdPlace,
      });
    }

    if (drafts.length === 0) throw new ConvexError("That combination produces no matches.");

    const existing = await ctx.db
      .query("matches")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
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

    await resolveByes(ctx, args.eventId);
    await ctx.db.patch(args.eventId, { drawGeneratedAt: now });
    await ctx.db.patch(event.tournamentId, { updatedAt: now });

    return { matches: drafts.length };
  },
});

export const clear = mutation({
  args: { eventId: v.id("events"), pin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("That category no longer exists.");
    await requireOrganiser(ctx, event.tournamentId, args.pin);

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
