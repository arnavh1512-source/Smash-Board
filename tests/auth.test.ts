// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { CLEANUP_BATCH } from "../convex/cleanup";
import { derivePinHash, digest, newSalt } from "../convex/lib/auth";
import { CREATE_PEPPER } from "../convex/tournaments";
import { GLOBAL_CREATE_KEY, GLOBAL_CREATE_LIMIT, CREATE_WINDOW_MS } from "@/lib/createThrottle";
import { TRUST_MS } from "@/lib/pinThrottle";

/**
 * The sign-in door, the creation throttle and the throttle sweep, run against
 * an in-memory Convex database. These are the rules an integration run against
 * a live deployment cannot reach: an old hash format, a lock already in place,
 * a site-wide count already at its ceiling, rows a month old.
 */

const modules = import.meta.glob("../convex/**/*.*s");

const ORGANISER_PIN = "organiser-pin";
const REFEREE_PIN = "referee-pin";

beforeAll(() => {
  process.env.SMASHBOARD_TOKEN_SECRET = "test-secret-that-is-at-least-32-characters";
});

afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof convexTest>;

/** A tournament with both PINs set, optionally with its organiser PIN in the old format. */
async function seed(t: Harness, { legacy = false } = {}): Promise<Id<"tournaments">> {
  const salt = newSalt();
  const pinHash = legacy ? await digest(ORGANISER_PIN, salt) : await derivePinHash(ORGANISER_PIN, salt);
  const refereePinHash = await derivePinHash(REFEREE_PIN, salt);
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("tournaments", {
      name: "Club Open",
      slug: `club-open-${now}`,
      pinHash,
      pinSalt: salt,
      refereePinHash,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function lock(t: Harness, tournamentId: Id<"tournaments">) {
  await t.run((ctx) => ctx.db.patch(tournamentId, { failedPinAttempts: 8, pinLockedUntil: Date.now() + 600_000 }));
}

describe("signIn", () => {
  it("lets the organiser in and remembers the device as organiser-trusted", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await seed(t);
    const result = await t.mutation(api.tournaments.signIn, { tournamentId, pin: ORGANISER_PIN, client: "phone-a" });
    expect(result).toMatchObject({ ok: true, role: "organiser" });

    const rows = await t.run((ctx) => ctx.db.query("pinAttempts").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ failed: 0, trustedRole: "organiser" });
  });

  it("rehashes an old-format PIN on sign-in and the token it returns still works", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await seed(t, { legacy: true });

    const result = await t.mutation(api.tournaments.signIn, { tournamentId, pin: ORGANISER_PIN, client: "phone-a" });
    expect(result.ok).toBe(true);

    const stored = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(stored?.pinHash.startsWith("p1$")).toBe(true);
    // The token was minted over the new hash, so it must pass the organiser check.
    await expect(
      t.mutation(api.tournaments.revealOrganiserContact, { tournamentId, token: result.token! }),
    ).resolves.toBeNull();

    // And the PIN still works against the upgraded hash.
    const again = await t.mutation(api.tournaments.signIn, { tournamentId, pin: ORGANISER_PIN, client: "phone-a" });
    expect(again.ok).toBe(true);
  });

  it("does not let a referee-trusted phone try the organiser PIN through a lock", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await seed(t);
    const first = await t.mutation(api.tournaments.signIn, {
      tournamentId,
      pin: REFEREE_PIN,
      role: "referee",
      client: "umpire",
    });
    expect(first).toMatchObject({ ok: true, role: "referee" });

    await lock(t, tournamentId);

    const organiserDoor = await t.mutation(api.tournaments.signIn, {
      tournamentId,
      pin: ORGANISER_PIN,
      client: "umpire",
    });
    expect(organiserDoor.ok).toBe(false);
    expect(organiserDoor.error).toContain("for this tournament");

    const organiserViaReferee = await t.mutation(api.tournaments.signIn, {
      tournamentId,
      pin: ORGANISER_PIN,
      role: "referee",
      client: "umpire",
    });
    expect(organiserViaReferee).toMatchObject({ ok: false, error: "That PIN was not recognised." });
    // A trusted phone mistyping inside a lock neither stretches it nor adds to it.
    const locked = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(locked?.failedPinAttempts).toBe(8);
    expect(locked!.pinLockedUntil! - Date.now()).toBeLessThanOrEqual(600_000);

    const refereeAgain = await t.mutation(api.tournaments.signIn, {
      tournamentId,
      pin: REFEREE_PIN,
      role: "referee",
      client: "umpire",
    });
    expect(refereeAgain).toMatchObject({ ok: true, role: "referee" });
  });

  it("lets an organiser-trusted phone through a lock, and keeps a stranger out", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await seed(t);
    await t.mutation(api.tournaments.signIn, { tournamentId, pin: ORGANISER_PIN, client: "organiser" });
    await lock(t, tournamentId);

    const stranger = await t.mutation(api.tournaments.signIn, {
      tournamentId,
      pin: ORGANISER_PIN,
      client: "stranger",
    });
    expect(stranger.ok).toBe(false);
    expect(stranger.error).toContain("for this tournament");

    const organiser = await t.mutation(api.tournaments.signIn, {
      tournamentId,
      pin: ORGANISER_PIN,
      client: "organiser",
    });
    expect(organiser).toMatchObject({ ok: true, role: "organiser" });
  });

  it("never demotes an organiser phone that later signs in as referee", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await seed(t);
    await t.mutation(api.tournaments.signIn, { tournamentId, pin: ORGANISER_PIN, client: "organiser" });
    await t.mutation(api.tournaments.signIn, {
      tournamentId,
      pin: REFEREE_PIN,
      role: "referee",
      client: "organiser",
    });
    const rows = await t.run((ctx) => ctx.db.query("pinAttempts").collect());
    expect(rows[0]?.trustedRole).toBe("organiser");
  });
});

describe("setRefereePin", () => {
  it("refuses a referee PIN equal to the organiser PIN", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await seed(t);
    const { token } = await t.mutation(api.tournaments.signIn, { tournamentId, pin: ORGANISER_PIN });
    await expect(
      t.mutation(api.tournaments.setRefereePin, { tournamentId, token: token!, refereePin: ORGANISER_PIN }),
    ).rejects.toThrow("must be different");
  });

  it("stores a new referee PIN in the current format", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await seed(t);
    const { token } = await t.mutation(api.tournaments.signIn, { tournamentId, pin: ORGANISER_PIN });
    await t.mutation(api.tournaments.setRefereePin, { tournamentId, token: token!, refereePin: "court-two" });
    const stored = await t.run((ctx) => ctx.db.get(tournamentId));
    expect(stored?.refereePinHash?.startsWith("p1$")).toBe(true);
  });
});

describe("create", () => {
  const form = { name: "Club Open", pin: ORGANISER_PIN, isPublic: true };

  it("creates a tournament and signs its organiser in", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.tournaments.create, { ...form, client: "browser-a" });
    await expect(
      t.mutation(api.tournaments.revealOrganiserContact, { tournamentId: created.tournamentId, token: created.token }),
    ).resolves.toBeNull();
  });

  it("stops every source once the site-wide ceiling is reached, without spending theirs", async () => {
    const t = convexTest(schema, modules);
    const globalHash = await digest(GLOBAL_CREATE_KEY, CREATE_PEPPER);
    await t.run((ctx) =>
      ctx.db.insert("createAttempts", {
        sourceHash: globalHash,
        count: GLOBAL_CREATE_LIMIT,
        windowStart: Date.now(),
      }),
    );

    await expect(t.mutation(api.tournaments.create, { ...form, client: "browser-a" })).rejects.toThrow(
      "Lots of tournaments are being created right now",
    );
    // The throw rolled back the source's own count along with everything else.
    const rows = await t.run((ctx) => ctx.db.query("createAttempts").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceHash).toBe(globalHash);
  });
});

describe("pruneThrottles", () => {
  it("drops closed creation windows and long-quiet PIN rows, and keeps the rest", async () => {
    const t = convexTest(schema, modules);
    const tournamentId = await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("createAttempts", { sourceHash: "old", count: 1, windowStart: now - CREATE_WINDOW_MS - 1 });
      await ctx.db.insert("createAttempts", { sourceHash: "fresh", count: 1, windowStart: now });
      const row = { tournamentId, failed: 0, contributed: 0 };
      await ctx.db.insert("pinAttempts", { ...row, sourceHash: "old", updatedAt: now - TRUST_MS - 1 });
      await ctx.db.insert("pinAttempts", { ...row, sourceHash: "fresh", updatedAt: now });
    });

    await t.mutation(internal.cleanup.pruneThrottles, {});

    const creates = await t.run((ctx) => ctx.db.query("createAttempts").collect());
    const pins = await t.run((ctx) => ctx.db.query("pinAttempts").collect());
    expect(creates.map((r) => r.sourceHash)).toEqual(["fresh"]);
    expect(pins.map((r) => r.sourceHash)).toEqual(["fresh"]);
  });

  it("keeps sweeping in fresh batches until the backlog is gone", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const stale = Date.now() - CREATE_WINDOW_MS - 1;
    await t.run(async (ctx) => {
      for (let i = 0; i < CLEANUP_BATCH + 5; i++) {
        await ctx.db.insert("createAttempts", { sourceHash: `s${i}`, count: 1, windowStart: stale });
      }
    });

    await t.mutation(internal.cleanup.pruneThrottles, {});
    const afterFirst = await t.run((ctx) => ctx.db.query("createAttempts").collect());
    expect(afterFirst).toHaveLength(5);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const afterAll = await t.run((ctx) => ctx.db.query("createAttempts").collect());
    expect(afterAll).toHaveLength(0);
  });
});
