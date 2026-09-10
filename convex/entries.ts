import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrganiser } from "./lib/auth";
import { advanceKnockout } from "./lib/progression";
import type { MutationCtx } from "./_generated/server";

const entryValidator = v.object({
  _id: v.id("entries"),
  _creationTime: v.number(),
  tournamentId: v.id("tournaments"),
  eventId: v.id("events"),
  playerOne: v.string(),
  playerTwo: v.optional(v.string()),
  club: v.optional(v.string()),
  seed: v.number(),
  withdrawn: v.boolean(),
  createdAt: v.number(),
});

const MAX_ENTRIES_PER_EVENT = 256;

/**
 * Rows as they leave the server for a browser.
 *
 * Entrant phone numbers are contact details the organiser collected, not
 * scoreboard data, so they never travel with the public entry list. The
 * organiser reads one back through `revealContact`, which checks the PIN.
 */
function publicEntry(entry: Doc<"entries">) {
  const { phone: _phone, ...rest } = entry;
  return rest;
}

function clean(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

async function loadEventForOrganiser(ctx: MutationCtx, eventId: Id<"events">, pin: string) {
  const event = await ctx.db.get(eventId);
  if (!event) throw new ConvexError("That category no longer exists.");
  await requireOrganiser(ctx, event.tournamentId, pin);
  return event;
}

export const listByEvent = query({
  args: { eventId: v.id("events") },
  returns: v.array(entryValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("entries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    return sortEntries(rows).map(publicEntry);
  },
});

export const listByTournament = query({
  args: { tournamentId: v.id("tournaments") },
  returns: v.array(entryValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("entries")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    return sortEntries(rows).map(publicEntry);
  },
});

/** Seeded entrants first in seed order, then everyone else by entry time. */
function sortEntries(rows: Doc<"entries">[]): Doc<"entries">[] {
  return [...rows].sort((a, b) => {
    const aSeed = a.seed > 0 ? a.seed : Number.MAX_SAFE_INTEGER;
    const bSeed = b.seed > 0 ? b.seed : Number.MAX_SAFE_INTEGER;
    if (aSeed !== bSeed) return aSeed - bSeed;
    return a.createdAt - b.createdAt;
  });
}

export const add = mutation({
  args: {
    eventId: v.id("events"),
    pin: v.string(),
    playerOne: v.string(),
    playerTwo: v.optional(v.string()),
    club: v.optional(v.string()),
    phone: v.optional(v.string()),
    seed: v.optional(v.number()),
  },
  returns: v.id("entries"),
  handler: async (ctx, args) => {
    const event = await loadEventForOrganiser(ctx, args.eventId, args.pin);

    const playerOne = clean(args.playerOne, 80);
    if (!playerOne) throw new ConvexError("Enter the player's name.");
    const playerTwo = event.teamSize === 2 ? clean(args.playerTwo, 80) : undefined;
    if (event.teamSize === 2 && !playerTwo) {
      throw new ConvexError("This is a doubles category, so enter both players.");
    }

    const existing = await ctx.db
      .query("entries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    if (existing.length >= MAX_ENTRIES_PER_EVENT) {
      throw new ConvexError(`A category holds at most ${MAX_ENTRIES_PER_EVENT} entrants.`);
    }

    return await ctx.db.insert("entries", {
      tournamentId: event.tournamentId,
      eventId: args.eventId,
      playerOne,
      playerTwo,
      club: clean(args.club, 80),
      phone: clean(args.phone, 32),
      seed: Math.max(0, Math.min(args.seed ?? 0, 64)),
      withdrawn: false,
      createdAt: Date.now(),
    });
  },
});

/**
 * Paste-in bulk add: one entrant per line.
 * Doubles pairs are split on "/" or "&", and an optional club follows a comma.
 * Example line: "Arnav Shah / Ravi Patel, Ahmedabad SC"
 */
export const addMany = mutation({
  args: { eventId: v.id("events"), pin: v.string(), text: v.string() },
  returns: v.object({ added: v.number(), skipped: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const event = await loadEventForOrganiser(ctx, args.eventId, args.pin);

    const existing = await ctx.db
      .query("entries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    let room = MAX_ENTRIES_PER_EVENT - existing.length;

    const lines = args.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 300);
    const skipped: string[] = [];
    let added = 0;
    const now = Date.now();

    for (const line of lines) {
      if (room <= 0) {
        skipped.push(`${line} (category is full)`);
        continue;
      }
      const [namePart, clubPart] = line.split(",");
      const players = namePart.split(/[/&]/).map((p) => clean(p, 80)).filter(Boolean) as string[];
      if (players.length === 0) {
        skipped.push(line);
        continue;
      }
      if (event.teamSize === 2 && players.length < 2) {
        skipped.push(`${line} (needs two players)`);
        continue;
      }
      await ctx.db.insert("entries", {
        tournamentId: event.tournamentId,
        eventId: args.eventId,
        playerOne: players[0],
        playerTwo: event.teamSize === 2 ? players[1] : undefined,
        club: clean(clubPart, 80),
        phone: undefined,
        seed: 0,
        withdrawn: false,
        createdAt: now + added,
      });
      added += 1;
      room -= 1;
    }

    return { added, skipped };
  },
});

/**
 * Hand the organiser one entrant's phone number.
 *
 * This is a mutation rather than a query so every read goes through the PIN
 * check that counts wrong attempts and locks the tournament out after too
 * many. The console calls it when the organiser opens an entrant for editing.
 */
export const revealContact = mutation({
  args: { entryId: v.id("entries"), pin: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new ConvexError("That entrant no longer exists.");
    await requireOrganiser(ctx, entry.tournamentId, args.pin);
    return entry.phone ?? null;
  },
});

export const update = mutation({
  args: {
    entryId: v.id("entries"),
    pin: v.string(),
    playerOne: v.optional(v.string()),
    playerTwo: v.optional(v.string()),
    club: v.optional(v.string()),
    phone: v.optional(v.string()),
    seed: v.optional(v.number()),
    withdrawn: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new ConvexError("That entrant no longer exists.");
    await requireOrganiser(ctx, entry.tournamentId, args.pin);

    const patch: Record<string, unknown> = {};
    if (args.playerOne !== undefined) {
      const name = clean(args.playerOne, 80);
      if (!name) throw new ConvexError("Enter the player's name.");
      patch.playerOne = name;
    }
    if (args.playerTwo !== undefined) patch.playerTwo = clean(args.playerTwo, 80);
    if (args.club !== undefined) patch.club = clean(args.club, 80);
    if (args.phone !== undefined) patch.phone = clean(args.phone, 32);
    if (args.seed !== undefined) patch.seed = Math.max(0, Math.min(args.seed, 64));
    if (args.withdrawn !== undefined) patch.withdrawn = args.withdrawn;

    await ctx.db.patch(args.entryId, patch);
    return null;
  },
});

export const remove = mutation({
  args: { entryId: v.id("entries"), pin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return null;
    await requireOrganiser(ctx, entry.tournamentId, args.pin);

    // Clear the entrant out of any match they were drawn into so the bracket
    // never points at a deleted row.
    const matches = await ctx.db
      .query("matches")
      .withIndex("by_event", (q) => q.eq("eventId", entry.eventId))
      .collect();
    for (const match of matches) {
      const patch: Record<string, unknown> = {};
      if (match.aId === entry._id) {
        patch.aId = null;
        patch.aLabel = "Withdrawn";
      }
      if (match.bId === entry._id) {
        patch.bId = null;
        patch.bLabel = "Withdrawn";
      }
      if (match.winnerId === entry._id) {
        patch.winnerId = null;
        patch.status = "scheduled";
        patch.sets = [];
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(match._id, { ...patch, updatedAt: Date.now() });
        // Clearing the winner here is not enough: the entrant was already
        // pushed into the next round, so walk the bracket forward and take
        // them out of every slot they reached.
        if (match.winnerId === entry._id) {
          await advanceKnockout(ctx, { ...match, ...patch } as Doc<"matches">, null);
        }
      }
    }

    await ctx.db.delete(args.entryId);
    return null;
  },
});
