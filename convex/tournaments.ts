import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { scheduleValidator } from "./schema";
import { randomBelow } from "../src/lib/random";
import { sourceId, sourceKey } from "../src/lib/pinThrottle";
import {
  GLOBAL_CREATE_KEY,
  GLOBAL_CREATE_LIMIT,
  createLimitFor,
  createLimitMessage,
  globalCreateLimitMessage,
  readCreateSource,
} from "../src/lib/createThrottle";
import {
  assertPinShape,
  attemptSignIn,
  derivePinHash,
  digest,
  issueToken,
  newSalt,
  publicTournament,
  requireOrganiser,
  verifyPin,
  type AccessRole,
} from "./lib/auth";

const MAX_NAME = 120;

/**
 * Fixed salt for the create-throttle's source hashes.
 *
 * `pinAttempts` salts its hashes with the tournament's own salt, which a
 * creation does not have yet — there is no tournament. A constant does the one
 * job that matters here: the browser's random id is never written down, only a
 * hash of it, so the table cannot be read back as a list of devices.
 */
export const CREATE_PEPPER = "smashboard.create.v1";

/**
 * Record one creation against the bucket counted under `key`, or throw the
 * bucket's message when it is full.
 */
async function countCreation(
  ctx: MutationCtx,
  key: string,
  now: number,
  limit: number,
  message: (retryAfter: number) => string,
): Promise<void> {
  const sourceHash = await digest(key, CREATE_PEPPER);
  const record = await ctx.db
    .query("createAttempts")
    .withIndex("by_source", (q) => q.eq("sourceHash", sourceHash))
    .unique();
  const standing = readCreateSource(
    record === null ? null : { count: record.count, windowStart: record.windowStart },
    now,
    limit,
  );
  if (!standing.allowed) throw new ConvexError(message(standing.retryAfter));
  const row = { count: standing.count, windowStart: standing.windowStart };
  if (record === null) await ctx.db.insert("createAttempts", { sourceHash, ...row });
  else await ctx.db.patch(record._id, row);
}

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
  /** Only present when the organiser chose to publish it. */
  organiserPhone: v.optional(v.string()),
  showOrganiserContact: v.boolean(),
  isPublic: v.boolean(),
  /** Whether a referee PIN exists. The hash itself never leaves the server. */
  hasRefereePin: v.boolean(),
  schedule: v.optional(scheduleValidator),
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

/**
 * The random tail of a slug. For an unlisted tournament the link is the only
 * lock on the door, and the name in front of it is guessable, so the tail
 * carries it alone: eight characters from 32 is 40 bits.
 */
function randomSuffix(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => alphabet[randomBelow(alphabet.length)]).join("");
}

function cleanText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/** The shape `<input type="date">` sends, and the only shape the scheduler can read. */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real day on the calendar, not merely ten characters in the right places.
 *
 * The shape check alone lets "2026-02-31" through, and the `Date` parser the
 * scheduler hands it to rolls that silently forward to 3 March — so a typo
 * would come back as a plausible-looking wrong date rather than as an error.
 * Round-tripping through UTC catches the rollover: a date that survives is a
 * date that exists.
 */
function assertDateShape(value: string | undefined, label: string): void {
  if (value === undefined) return;
  if (!DATE_SHAPE.test(value)) {
    throw new ConvexError(`${label} must be a valid date.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ConvexError(`${label} must be a valid date.`);
  }
}

/**
 * A range that ends before it starts is bad data no organiser meant to enter,
 * so it is rejected here rather than left for the schedule or the tournament
 * page to display nonsense.
 */
function assertDateOrder(startDate: string | undefined, endDate: string | undefined): void {
  if (startDate !== undefined && endDate !== undefined && endDate < startDate) {
    throw new ConvexError("End date can't be before the start date.");
  }
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
    showOrganiserContact: v.optional(v.boolean()),
    pin: v.string(),
    isPublic: v.boolean(),
    /** The browser's own random id, used only to rate-limit this door. */
    client: v.optional(v.string()),
  },
  returns: v.object({
    tournamentId: v.id("tournaments"),
    slug: v.string(),
    /** The organiser is signed in the moment they create the tournament. */
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length < 3) throw new ConvexError("Give the tournament a name of at least 3 characters.");
    if (name.length > MAX_NAME) throw new ConvexError(`Keep the name under ${MAX_NAME} characters.`);
    assertPinShape(args.pin);

    const startDate = cleanText(args.startDate, 20);
    const endDate = cleanText(args.endDate, 20);
    assertDateShape(startDate, "Start date");
    assertDateShape(endDate, "End date");
    assertDateOrder(startDate, endDate);

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

    // The only mutation with no PIN in front of it, so it gets a counter
    // instead. Applied here rather than at the top of the handler because a
    // mutation is a transaction: anything written before a validation throw is
    // rolled back anyway, so counting earlier would count nothing.
    const id = sourceId(args.client);
    await countCreation(ctx, sourceKey(id), now, createLimitFor(id), createLimitMessage);
    // Checked second so a single source that is over its own limit does not
    // spend the site-wide allowance for everybody else. A throw here rolls
    // back the source's count too.
    await countCreation(ctx, GLOBAL_CREATE_KEY, now, GLOBAL_CREATE_LIMIT, globalCreateLimitMessage);

    const tournamentId = await ctx.db.insert("tournaments", {
      name,
      slug,
      venue: cleanText(args.venue, 160),
      startDate,
      endDate,
      notes: cleanText(args.notes, 2000),
      organiserName: cleanText(args.organiserName, 120),
      organiserPhone: cleanText(args.organiserPhone, 32),
      showOrganiserContact: args.showOrganiserContact === true,
      pinHash: await derivePinHash(args.pin, salt),
      pinSalt: salt,
      isPublic: args.isPublic,
      createdAt: now,
      updatedAt: now,
    });

    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) throw new ConvexError("Could not create the tournament. Please try again.");
    return { tournamentId, slug, token: await issueToken(tournament, "organiser") };
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
    token: v.string(),
    name: v.optional(v.string()),
    venue: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    organiserName: v.optional(v.string()),
    organiserPhone: v.optional(v.string()),
    showOrganiserContact: v.optional(v.boolean()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tournament = await requireOrganiser(ctx, args.tournamentId, args.token);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 3) throw new ConvexError("Name must be at least 3 characters.");
      patch.name = name.slice(0, MAX_NAME);
    }
    if (args.venue !== undefined) patch.venue = cleanText(args.venue, 160);

    const startDate = args.startDate !== undefined ? cleanText(args.startDate, 20) : undefined;
    const endDate = args.endDate !== undefined ? cleanText(args.endDate, 20) : undefined;
    assertDateShape(startDate, "Start date");
    assertDateShape(endDate, "End date");
    // Validate against whichever side of the range isn't being changed, so a
    // one-sided edit can't silently create an inverted range either.
    assertDateOrder(
      args.startDate !== undefined ? startDate : tournament.startDate,
      args.endDate !== undefined ? endDate : tournament.endDate,
    );
    if (args.startDate !== undefined) patch.startDate = startDate;
    if (args.endDate !== undefined) patch.endDate = endDate;

    if (args.notes !== undefined) patch.notes = cleanText(args.notes, 2000);
    if (args.organiserName !== undefined) patch.organiserName = cleanText(args.organiserName, 120);
    if (args.organiserPhone !== undefined) patch.organiserPhone = cleanText(args.organiserPhone, 32);
    if (args.showOrganiserContact !== undefined) {
      patch.showOrganiserContact = args.showOrganiserContact;
    }
    if (args.isPublic !== undefined) patch.isPublic = args.isPublic;

    await ctx.db.patch(args.tournamentId, patch);
    return null;
  },
});

/**
 * Hand the organiser their own phone number back.
 *
 * The public payload drops it unless it has been published, so the settings
 * form would otherwise have nothing to edit. A mutation rather than a query,
 * for the same reason as `entries.revealContact`: every read goes through the
 * PIN check that counts wrong attempts.
 */
export const revealOrganiserContact = mutation({
  args: { tournamentId: v.id("tournaments"), token: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.token);
    const tournament = await ctx.db.get(args.tournamentId);
    return tournament?.organiserPhone ?? null;
  },
});

export const changePin = mutation({
  args: { tournamentId: v.id("tournaments"), token: v.string(), newPin: v.string() },
  /** A fresh token, because the old one was signed with the old PIN hash. */
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.token);
    assertPinShape(args.newPin);
    const salt = newSalt();
    // A new salt invalidates every hash made with the old one, so a referee PIN
    // that is still in circulation has to be dropped rather than silently
    // stranded. The console tells the organiser to issue a new one.
    await ctx.db.patch(args.tournamentId, {
      pinSalt: salt,
      pinHash: await derivePinHash(args.newPin, salt),
      refereePinHash: undefined,
      failedPinAttempts: 0,
      pinLockedUntil: undefined,
      updatedAt: Date.now(),
    });
    const rotated = await ctx.db.get(args.tournamentId);
    if (!rotated) throw new ConvexError("That tournament no longer exists.");
    return await issueToken(rotated, "organiser");
  },
});

/**
 * The one door where a PIN is accepted.
 *
 * `role` says which door is being knocked on: the referee console accepts
 * either PIN, the organiser console accepts only the organiser's.
 *
 * A wrong PIN comes back as `{ ok: false }` rather than as a thrown error. A
 * Convex mutation is a transaction, so throwing here would roll back the write
 * that records the wrong guess and the lockout could never accumulate.
 */
export const signIn = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    pin: v.string(),
    role: v.optional(v.union(v.literal("organiser"), v.literal("referee"))),
    /**
     * A random id the browser keeps for itself, so repeated wrong guesses can
     * be throttled at their source before they eat into the tournament-wide
     * lockout. It is self-declared and rotatable, so it is a speed bump rather
     * than an authority — see `attemptSignIn`.
     */
    client: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    token: v.optional(v.string()),
    role: v.optional(v.union(v.literal("organiser"), v.literal("referee"))),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const allow: AccessRole[] =
      args.role === "referee" ? ["organiser", "referee"] : ["organiser"];
    const result = await attemptSignIn(ctx, args.tournamentId, args.pin, allow, args.client);
    return result.ok
      ? { ok: true, token: result.token, role: result.role }
      : { ok: false, error: result.error };
  },
});

/**
 * Set or clear the referee PIN.
 *
 * It is hashed with the tournament's existing salt, and must differ from the
 * organiser PIN — otherwise handing it out would hand out the whole console.
 */
export const setRefereePin = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    token: v.string(),
    refereePin: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tournament = await requireOrganiser(ctx, args.tournamentId, args.token);

    if (args.refereePin === null) {
      await ctx.db.patch(args.tournamentId, {
        refereePinHash: undefined,
        updatedAt: Date.now(),
      });
      return null;
    }

    assertPinShape(args.refereePin, "Referee PIN");
    if ((await verifyPin(args.refereePin, tournament.pinSalt, tournament.pinHash)).ok) {
      throw new ConvexError("The referee PIN must be different from your organiser PIN.");
    }
    await ctx.db.patch(args.tournamentId, {
      refereePinHash: await derivePinHash(args.refereePin, tournament.pinSalt),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { tournamentId: v.id("tournaments"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.token);

    // The tournament row goes at once, so the link is dead the moment the
    // organiser confirms. Its matches, entries, events and attempt records are
    // swept up behind it in bounded batches: a busy weekend can leave more
    // rows than one transaction is allowed to read, and a cascade that dies
    // half-way through would leave the tournament standing.
    await ctx.db.delete(args.tournamentId);
    await ctx.scheduler.runAfter(0, internal.tournaments.purge, {
      tournamentId: args.tournamentId,
    });
    return null;
  },
});

/** How many rows one sweep deletes before handing over to the next. */
const PURGE_BATCH = 256;

/**
 * Deletes what belonged to a removed tournament, a batch at a time.
 *
 * Reschedules itself until nothing is left, so the work is bounded by the
 * number of sweeps rather than by the size of the tournament. Internal: the
 * permission check happened in `remove`, and by now there is no tournament
 * left to check against.
 */
export const purge = internalMutation({
  args: { tournamentId: v.id("tournaments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    let budget = PURGE_BATCH;

    const sweep = async (table: "matches" | "entries" | "events" | "pinAttempts") => {
      if (budget <= 0) return;
      const rows = await ctx.db
        .query(table)
        .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
        .take(budget);
      for (const row of rows) await ctx.db.delete(row._id);
      budget -= rows.length;
    };

    await sweep("matches");
    await sweep("entries");
    await sweep("events");
    await sweep("pinAttempts");

    if (budget <= 0) {
      await ctx.scheduler.runAfter(0, internal.tournaments.purge, {
        tournamentId: args.tournamentId,
      });
    }
    return null;
  },
});
