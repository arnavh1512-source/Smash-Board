import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  assertPinShape,
  hashPin,
  newSalt,
  publicTournament,
  requireOrganiser,
} from "./lib/auth";

const MAX_NAME = 120;

/** Shape returned to browsers: every column except the PIN material. */
const publicTournamentValidator = v.object({
  _id: v.id("tournaments"),
  _creationTime: v.number(),
  name: v.string(),
  slug: v.string(),
  venue: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  notes: v.optional(v.string()),
  organiserName: v.optional(v.string()),
  organiserPhone: v.optional(v.string()),
  isPublic: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** How many times `create` will retry before giving up on a free slug. */
const MAX_SLUG_ATTEMPTS = 6;

function randomSuffix(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function cleanText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

export const create = mutation({
  args: {
    name: v.string(),
    venue: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    organiserName: v.optional(v.string()),
    organiserPhone: v.optional(v.string()),
    pin: v.string(),
    isPublic: v.boolean(),
  },
  returns: v.object({ tournamentId: v.id("tournaments"), slug: v.string() }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length < 3) throw new ConvexError("Give the tournament a name of at least 3 characters.");
    if (name.length > MAX_NAME) throw new ConvexError(`Keep the name under ${MAX_NAME} characters.`);
    assertPinShape(args.pin);

    // `getBySlug` uses `.unique()`, which would throw forever on a duplicate,
    // so a clash must never be inserted. Each retry widens the suffix, which
    // makes a run of clashes impossible rather than merely improbable.
    const base = slugify(name) || "tournament";
    let slug = `${base}-${randomSuffix()}`;
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const clash = await ctx.db
        .query("tournaments")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!clash) break;
      if (attempt === MAX_SLUG_ATTEMPTS) {
        throw new ConvexError("Could not allocate a link for that name. Please try again.");
      }
      slug = `${base}-${randomSuffix()}${randomSuffix()}`;
    }

    const salt = newSalt();
    const now = Date.now();
    const tournamentId = await ctx.db.insert("tournaments", {
      name,
      slug,
      venue: cleanText(args.venue, 160),
      startDate: cleanText(args.startDate, 20),
      endDate: cleanText(args.endDate, 20),
      notes: cleanText(args.notes, 2000),
      organiserName: cleanText(args.organiserName, 120),
      organiserPhone: cleanText(args.organiserPhone, 32),
      pinHash: await hashPin(args.pin, salt),
      pinSalt: salt,
      isPublic: args.isPublic,
      createdAt: now,
      updatedAt: now,
    });

    return { tournamentId, slug };
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(publicTournamentValidator, v.null()),
  handler: async (ctx, args) => {
    const tournament = await ctx.db
      .query("tournaments")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!tournament) return null;
    return publicTournament(tournament);
  },
});

export const listPublic = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(publicTournamentValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 24, 1), 100);
    // Read straight off the public index: filtering a page of all tournaments
    // would return nothing once enough recent ones were private.
    const rows = await ctx.db
      .query("tournaments")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .order("desc")
      .take(limit);
    return rows.map(publicTournament);
  },
});

export const update = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    pin: v.string(),
    name: v.optional(v.string()),
    venue: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    organiserName: v.optional(v.string()),
    organiserPhone: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.pin);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 3) throw new ConvexError("Name must be at least 3 characters.");
      patch.name = name.slice(0, MAX_NAME);
    }
    if (args.venue !== undefined) patch.venue = cleanText(args.venue, 160);
    if (args.startDate !== undefined) patch.startDate = cleanText(args.startDate, 20);
    if (args.endDate !== undefined) patch.endDate = cleanText(args.endDate, 20);
    if (args.notes !== undefined) patch.notes = cleanText(args.notes, 2000);
    if (args.organiserName !== undefined) patch.organiserName = cleanText(args.organiserName, 120);
    if (args.organiserPhone !== undefined) patch.organiserPhone = cleanText(args.organiserPhone, 32);
    if (args.isPublic !== undefined) patch.isPublic = args.isPublic;

    await ctx.db.patch(args.tournamentId, patch);
    return null;
  },
});

export const changePin = mutation({
  args: { tournamentId: v.id("tournaments"), pin: v.string(), newPin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.pin);
    assertPinShape(args.newPin);
    const salt = newSalt();
    await ctx.db.patch(args.tournamentId, {
      pinSalt: salt,
      pinHash: await hashPin(args.newPin, salt),
      failedPinAttempts: 0,
      pinLockedUntil: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Used by the organiser sign-in gate. Returns nothing; throws when wrong. */
export const verifyPin = mutation({
  args: { tournamentId: v.id("tournaments"), pin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.pin);
    return null;
  },
});

export const remove = mutation({
  args: { tournamentId: v.id("tournaments"), pin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.pin);

    const matches = await ctx.db
      .query("matches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    for (const match of matches) await ctx.db.delete(match._id);

    const entries = await ctx.db
      .query("entries")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    for (const entry of entries) await ctx.db.delete(entry._id);

    const events = await ctx.db
      .query("events")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId as Id<"tournaments">))
      .collect();
    for (const event of events) await ctx.db.delete(event._id);

    await ctx.db.delete(args.tournamentId);
    return null;
  },
});
