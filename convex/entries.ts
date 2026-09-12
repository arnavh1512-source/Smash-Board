import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrganiser } from "./lib/auth";
import { applyWithdrawal } from "./lib/progression";
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

/**
 * Keep seeds unique inside a category.
 *
 * Two number-one seeds is not a preference, it is a broken bracket: the draw
 * places entrants by seed order, so a duplicate silently pushes somebody into
 * the wrong half. Gaps are fine — seeding 1, 2 and 5 is a normal thing to do —
 * so only collisions are refused.
 */
async function assertSeedFree(
  ctx: MutationCtx,
  eventId: Id<"events">,
  seed: number,
  exceptId?: Id<"entries">,
): Promise<void> {
  if (seed <= 0) return;
  const siblings = await ctx.db
    .query("entries")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const holder = siblings.find((e) => e.seed === seed && e._id !== exceptId);
  if (holder) {
    throw new ConvexError(
      `Seed ${seed} already belongs to ${holder.playerOne}. Give this entrant a different seed, or clear theirs first.`,
    );
  }
}

async function loadEventForOrganiser(ctx: MutationCtx, eventId: Id<"events">, token: string) {
  const event = await ctx.db.get(eventId);
  if (!event) throw new ConvexError("That category no longer exists.");
  await requireOrganiser(ctx, event.tournamentId, token);
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
    token: v.string(),
    playerOne: v.string(),
    playerTwo: v.optional(v.string()),
    club: v.optional(v.string()),
    phone: v.optional(v.string()),
    seed: v.optional(v.number()),
  },
  returns: v.id("entries"),
  handler: async (ctx, args) => {
    const event = await loadEventForOrganiser(ctx, args.eventId, args.token);

    const playerOne = clean(args.playerOne, 80);
    if (!playerOne) throw new ConvexError("Enter the player's name.");
    const partner = clean(args.playerTwo, 80);
    if (event.teamSize === 2 && !partner) {
      throw new ConvexError("This is a doubles category, so enter both players.");
    }
    // A singles category cannot hold a partner. Dropping it quietly is how a
    // pair ends up on the scoreboard as one player, so say so instead.
    if (event.teamSize === 1 && partner) {
      throw new ConvexError(
        "This is a singles category. Change it to doubles before entering a pair.",
      );
    }
    const playerTwo = event.teamSize === 2 ? partner : undefined;

    const existing = await ctx.db
      .query("entries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    if (existing.length >= MAX_ENTRIES_PER_EVENT) {
      throw new ConvexError(`A category holds at most ${MAX_ENTRIES_PER_EVENT} entrants.`);
    }

    const seed = Math.max(0, Math.min(args.seed ?? 0, 64));
    await assertSeedFree(ctx, args.eventId, seed);

    return await ctx.db.insert("entries", {
      tournamentId: event.tournamentId,
      eventId: args.eventId,
      playerOne,
      playerTwo,
      club: clean(args.club, 80),
      phone: clean(args.phone, 32),
      seed,
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
  args: { eventId: v.id("events"), token: v.string(), text: v.string() },
  returns: v.object({ added: v.number(), skipped: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const event = await loadEventForOrganiser(ctx, args.eventId, args.token);

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
      // Only the first comma separates the club, so a club name that carries
      // its own commas ("Ahmedabad SC, Gujarat") survives the import intact.
      const comma = line.indexOf(",");
      const namePart = comma === -1 ? line : line.slice(0, comma);
      const clubPart = comma === -1 ? undefined : line.slice(comma + 1);
      const players = namePart.split(/[/&]/).map((p) => clean(p, 80)).filter(Boolean) as string[];
      if (players.length === 0) {
        skipped.push(line);
        continue;
      }
      // Exactly two, not "at least two". A third name on the line means the
      // organiser meant something the category cannot hold — a typo, a missing
      // newline, a triple — and quietly dropping it loses a player without a
      // word. The line comes back on the skipped list instead.
      if (event.teamSize === 2 && players.length !== 2) {
        skipped.push(`${line} (needs exactly two players)`);
        continue;
      }
      // Same reason as `add`: silently keeping only the first name is what
      // turns a doubles pair into a singles entrant.
      if (event.teamSize === 1 && players.length > 1) {
        skipped.push(`${line} (singles category — change it to doubles first)`);
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
  args: { entryId: v.id("entries"), token: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new ConvexError("That entrant no longer exists.");
    await requireOrganiser(ctx, entry.tournamentId, args.token);
    return entry.phone ?? null;
  },
});

export const update = mutation({
  args: {
    entryId: v.id("entries"),
    token: v.string(),
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
    await requireOrganiser(ctx, entry.tournamentId, args.token);

    const patch: Record<string, unknown> = {};
    if (args.playerOne !== undefined) {
      const name = clean(args.playerOne, 80);
      if (!name) throw new ConvexError("Enter the player's name.");
      patch.playerOne = name;
    }
    if (args.playerTwo !== undefined) {
      const partner = clean(args.playerTwo, 80);
      const event = await ctx.db.get(entry.eventId);
      if (event?.teamSize === 2 && !partner) {
        throw new ConvexError("This is a doubles category, so enter both players.");
      }
      // Same refusal add() gives. Quietly discarding the partner here would
      // let an edit that looks like it worked leave half a pair on the sheet.
      // Blanking the field is still allowed: that is how a partner is cleared
      // after a category is switched back to singles.
      if (event?.teamSize === 1 && partner) {
        throw new ConvexError(
          "This is a singles category. Change it to doubles before entering a pair.",
        );
      }
      patch.playerTwo = event?.teamSize === 2 ? partner : undefined;
    }
    if (args.club !== undefined) patch.club = clean(args.club, 80);
    if (args.phone !== undefined) patch.phone = clean(args.phone, 32);
    const category = await ctx.db.get(entry.eventId);
    const drawExists = category ? category.drawGeneratedAt !== null : false;

    if (args.seed !== undefined) {
      const seed = Math.max(0, Math.min(args.seed, 64));
      if (seed !== entry.seed) {
        // The bracket was built from the seeds as they stood, and it does not
        // rearrange itself. Letting the number change now would print a seed
        // the draw never used, which reads as a placement error that is not
        // there. The seeds move when the draw is made again.
        if (drawExists) {
          throw new ConvexError(
            "The draw has already been made, so seeds are fixed. Clear the draw to reseed the category.",
          );
        }
        await assertSeedFree(ctx, entry.eventId, seed, entry._id);
      }
      patch.seed = seed;
    }

    if (args.withdrawn !== undefined && args.withdrawn !== entry.withdrawn) {
      // Putting somebody back into a draw that has already been made would
      // mean deciding which matches they should have played. There is no
      // honest answer to that, so the draw is made again instead.
      if (!args.withdrawn && drawExists) {
        throw new ConvexError(
          "They have already been taken out of the draw. Generate the draw again to bring them back.",
        );
      }
      patch.withdrawn = args.withdrawn;
    }

    await ctx.db.patch(args.entryId, patch);

    // Withdrawing is not just a flag once the draw exists: their opponents have
    // to be given the walkovers and moved on, exactly as if they had not shown.
    if (patch.withdrawn === true && drawExists) {
      await applyWithdrawal(ctx, { ...entry, ...patch } as Doc<"entries">);
    }
    return null;
  },
});

export const remove = mutation({
  args: { entryId: v.id("entries"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return null;
    await requireOrganiser(ctx, entry.tournamentId, args.token);

    // Once the draw exists, deleting the row would erase somebody who may
    // already have played - leaving results reading "A beat Withdrawn 21-15".
    // The competition has started; they withdraw from it, they do not vanish.
    const event = await ctx.db.get(entry.eventId);
    if (event && event.drawGeneratedAt !== null) {
      throw new ConvexError(
        "The draw has already been made, so entrants can no longer be deleted. Withdraw them instead, and their matches will be awarded to their opponents.",
      );
    }

    await ctx.db.delete(args.entryId);
    return null;
  },
});
