/**
 * Integration tests against a real Convex deployment.
 *
 * These talk to the deployment in NEXT_PUBLIC_CONVEX_URL, creating a throwaway
 * tournament and deleting it afterwards. They are excluded from the default
 * `npm test` run because they need a deployment and network; run them with
 * `npm run test:integration`.
 */

import { ConvexHttpClient } from "convex/browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEFAULT_SCORING } from "../../src/lib/scoring";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set; cannot reach a deployment.");

const client = new ConvexHttpClient(url);
const PIN = "8140081461";
const WRONG_PIN = "0000";

let tournamentId: Id<"tournaments">;
let slug: string;
let eventId: Id<"events">;

/**
 * Assert that a call fails, and hand back the message for inspection.
 *
 * A production Convex deployment redacts `error.message` down to
 * "[Request ID: ...] Server Error" but still ships the `ConvexError` payload in
 * `error.data`, so read that first. This mirrors `errorMessage()` in
 * src/lib/usePin.ts, which is how the UI surfaces the same failures.
 */
async function rejects(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error && typeof error === "object" && "data" in error) {
      const data = (error as { data: unknown }).data;
      if (typeof data === "string") return data;
    }
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the call to be rejected, but it succeeded.");
}

beforeAll(async () => {
  const created = await client.mutation(api.tournaments.create, {
    name: `Integration Run ${Date.now()}`,
    venue: "Ahmedabad",
    organiserName: "Test Organiser",
    organiserPhone: "+918140081461",
    pin: PIN,
    // Kept off the public list so a test run never shows up on the homepage.
    isPublic: false,
  });
  tournamentId = created.tournamentId;
  slug = created.slug;

  eventId = await client.mutation(api.events.create, {
    tournamentId,
    pin: PIN,
    name: "Men's Singles",
    teamSize: 1,
    format: "knockout",
    scoring: DEFAULT_SCORING,
    thirdPlace: true,
    groupCount: 2,
    advancePerGroup: 2,
    doubleRound: false,
  });
}, 60_000);

afterAll(async () => {
  if (tournamentId) await client.mutation(api.tournaments.remove, { tournamentId, pin: PIN });
}, 60_000);

describe("tournament creation", () => {
  it("returns a slug that resolves back to the tournament", async () => {
    const found = await client.query(api.tournaments.getBySlug, { slug });
    expect(found?._id).toBe(tournamentId);
    expect(found?.name).toContain("Integration Run");
  });

  it("never sends the PIN hash to a browser", async () => {
    const found = await client.query(api.tournaments.getBySlug, { slug });
    expect(found).not.toHaveProperty("pinHash");
    expect(found).not.toHaveProperty("pinSalt");
  });

  it("keeps a private tournament off the public list", async () => {
    const listed = await client.query(api.tournaments.listPublic, { limit: 100 });
    expect(listed.some((t) => t._id === tournamentId)).toBe(false);
  });

  it("refuses a wrong PIN", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.update, { tournamentId, pin: WRONG_PIN, name: "Hijacked" }),
    );
    expect(message).toMatch(/PIN/i);
  });
});

describe("entrants", () => {
  it("adds a field in bulk", async () => {
    const result = await client.mutation(api.entries.addMany, {
      eventId,
      pin: PIN,
      text: ["Anita Rao", "Bhavin Shah", "Chetna Patel", "Dev Mehta"].join("\n"),
    });
    expect(result.added).toBe(4);
    expect(result.skipped).toEqual([]);
  });

  it("never sends a phone number with the public entry list", async () => {
    const withPhone = await client.mutation(api.entries.add, {
      eventId,
      pin: PIN,
      playerOne: "Esha Joshi",
      club: "Sabarmati SC",
      phone: "+919999999999",
    });

    const rows = await client.query(api.entries.listByEvent, { eventId });
    const row = rows.find((r) => r._id === withPhone);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("phone");
    expect(JSON.stringify(rows)).not.toContain("9999999999");

    // The organiser can still read it back, but only with the PIN.
    const revealed = await client.mutation(api.entries.revealContact, {
      entryId: withPhone,
      pin: PIN,
    });
    expect(revealed).toBe("+919999999999");
    const message = await rejects(
      client.mutation(api.entries.revealContact, { entryId: withPhone, pin: WRONG_PIN }),
    );
    expect(message).toMatch(/PIN/i);

    await client.mutation(api.entries.remove, { entryId: withPhone, pin: PIN });
  });
});

describe("draw and scoring", () => {
  it("builds a four-entrant bracket with a third-place playoff", async () => {
    await client.mutation(api.draws.generate, { eventId, pin: PIN, randomise: false });
    const matches = await client.query(api.matches.listByEvent, { eventId });
    // Two semi-finals, a final, and the playoff.
    expect(matches).toHaveLength(4);
    expect(matches.filter((m) => m.round === 0 && !m.isThirdPlace)).toHaveLength(2);
    expect(matches.filter((m) => m.isThirdPlace)).toHaveLength(1);
  });

  it("moves the winner into the final and the loser into the playoff", async () => {
    const before = await client.query(api.matches.listByEvent, { eventId });
    const semi = before.find((m) => m.round === 0 && !m.isThirdPlace)!;
    await client.mutation(api.matches.setScore, {
      matchId: semi._id,
      pin: PIN,
      sets: [
        { a: 21, b: 15 },
        { a: 21, b: 19 },
      ],
    });

    const after = await client.query(api.matches.listByEvent, { eventId });
    const played = after.find((m) => m._id === semi._id)!;
    expect(played.status).toBe("completed");
    expect(played.winnerId).toBe(semi.aId);

    const final = after.find((m) => m.round === 1 && !m.isThirdPlace)!;
    expect(final.aId).toBe(semi.aId);
    const playoff = after.find((m) => m.isThirdPlace)!;
    expect(playoff.aId).toBe(semi.bId);
  });

  it("rejects a score that the scoring rules do not allow", async () => {
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const open = matches.find((m) => m.round === 0 && m.status === "scheduled")!;
    const message = await rejects(
      client.mutation(api.matches.setScore, {
        matchId: open._id,
        pin: PIN,
        sets: [{ a: 40, b: 2 }],
      }),
    );
    expect(message).toMatch(/cap|set/i);
  });

  it("pulls the entrant back out of the final when the semi is reset", async () => {
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const semi = matches.find((m) => m.round === 0 && m.status === "completed")!;
    await client.mutation(api.matches.reset, { matchId: semi._id, pin: PIN });

    const after = await client.query(api.matches.listByEvent, { eventId });
    expect(after.find((m) => m._id === semi._id)!.status).toBe("scheduled");
    expect(after.find((m) => m.round === 1 && !m.isThirdPlace)!.aId).toBeNull();
    expect(after.find((m) => m.isThirdPlace)!.aId).toBeNull();
  });

  it("clears a deleted entrant out of every round they reached", async () => {
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const semi = matches.find((m) => m.round === 0 && !m.isThirdPlace)!;
    await client.mutation(api.matches.setScore, {
      matchId: semi._id,
      pin: PIN,
      sets: [
        { a: 21, b: 15 },
        { a: 21, b: 19 },
      ],
    });

    await client.mutation(api.entries.remove, {
      entryId: semi.aId as Id<"entries">,
      pin: PIN,
    });

    const after = await client.query(api.matches.listByEvent, { eventId });
    const ids = after.flatMap((m) => [m.aId, m.bId, m.winnerId]);
    expect(ids).not.toContain(semi.aId);
  });
});
