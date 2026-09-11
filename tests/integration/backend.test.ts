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

/**
 * A structurally valid token whose MAC is wrong. Every guarded mutation should
 * refuse it, which is what proves the guard checks the signature rather than
 * merely the shape.
 */
const FORGED_TOKEN = `organiser.${Date.now() + 3600_000}.${"0".repeat(64)}`;

let tournamentId: Id<"tournaments">;
let token: string;
let slug: string;
let eventId: Id<"events">;

/**
 * Assert that a call fails, and hand back the message for inspection.
 *
 * A production Convex deployment redacts `error.message` down to
 * "[Request ID: ...] Server Error" but still ships the `ConvexError` payload in
 * `error.data`, so read that first. This mirrors `errorMessage()` in
 * src/lib/useSession.ts, which is how the UI surfaces the same failures.
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
  token = created.token;

  eventId = await client.mutation(api.events.create, {
    tournamentId,
    token,
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
  if (tournamentId) await client.mutation(api.tournaments.remove, { tournamentId, token });
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

  it("refuses a forged token", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.update, { tournamentId, token: FORGED_TOKEN, name: "Hijacked" }),
    );
    expect(message).toMatch(/PIN/i);
  });
});

describe("entrants", () => {
  it("adds a field in bulk", async () => {
    const result = await client.mutation(api.entries.addMany, {
      eventId,
      token,
      text: ["Anita Rao", "Bhavin Shah", "Chetna Patel", "Dev Mehta"].join("\n"),
    });
    expect(result.added).toBe(4);
    expect(result.skipped).toEqual([]);
  });

  it("never sends a phone number with the public entry list", async () => {
    const withPhone = await client.mutation(api.entries.add, {
      eventId,
      token,
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
      token,
    });
    expect(revealed).toBe("+919999999999");
    const message = await rejects(
      client.mutation(api.entries.revealContact, { entryId: withPhone, token: FORGED_TOKEN }),
    );
    expect(message).toMatch(/PIN/i);

    await client.mutation(api.entries.remove, { entryId: withPhone, token });
  });
});

describe("draw and scoring", () => {
  it("builds a four-entrant bracket with a third-place playoff", async () => {
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
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
      token,
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
        token,
        sets: [{ a: 40, b: 2 }],
      }),
    );
    expect(message).toMatch(/cap|set/i);
  });

  it("pulls the entrant back out of the final when the semi is reset", async () => {
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const semi = matches.find((m) => m.round === 0 && m.status === "completed")!;
    await client.mutation(api.matches.reset, { matchId: semi._id, token });

    const after = await client.query(api.matches.listByEvent, { eventId });
    expect(after.find((m) => m._id === semi._id)!.status).toBe("scheduled");
    expect(after.find((m) => m.round === 1 && !m.isThirdPlace)!.aId).toBeNull();
    expect(after.find((m) => m.isThirdPlace)!.aId).toBeNull();
  });

  it("takes a withdrawn entrant out of every round still to come", async () => {
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const semi = matches.find((m) => m.round === 0 && !m.isThirdPlace)!;
    await client.mutation(api.matches.setScore, {
      matchId: semi._id,
      token,
      sets: [
        { a: 21, b: 15 },
        { a: 21, b: 19 },
      ],
    });

    // Deleting them outright would leave "beat Withdrawn 21-15" on the record,
    // so once the draw exists the only way out is a withdrawal.
    const refusal = await rejects(
      client.mutation(api.entries.remove, { entryId: semi.aId as Id<"entries">, token }),
    );
    expect(refusal).toMatch(/withdraw/i);

    await client.mutation(api.entries.update, {
      entryId: semi.aId as Id<"entries">,
      token,
      withdrawn: true,
    });

    const after = await client.query(api.matches.listByEvent, { eventId });
    const final = after.find((m) => m.round === 1 && !m.isThirdPlace)!;
    expect(final.aId).toBeNull();
    expect(final.aLabel).toBe("Withdrawn");
    // The match they actually played keeps its result; only what is still to
    // come is handed over.
    expect(after.find((m) => m._id === semi._id)!.winnerId).toBe(semi.aId);
  });
});

/**
 * A category named "Mixed Doubles" but left on Singles used to keep only the
 * first name of every pair, quietly turning doubles entrants into singles ones.
 * Nothing may truncate a pair any more: every path either takes both names or
 * refuses the entry and says why.
 */
describe("doubles entrants keep both names", () => {
  let singlesId: Id<"events">;
  let doublesId: Id<"events">;

  const category = (name: string, teamSize: number) =>
    client.mutation(api.events.create, {
      tournamentId,
      token,
      name,
      teamSize,
      format: "knockout",
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    });

  beforeAll(async () => {
    singlesId = await category("Doubles Trap", 1);
    doublesId = await category("Women's Doubles", 2);
  }, 60_000);

  it("refuses a doubles entry with only one name", async () => {
    const message = await rejects(
      client.mutation(api.entries.add, { eventId: doublesId, token, playerOne: "Anita Rao" }),
    );
    expect(message).toMatch(/both players/i);
  });

  it("refuses a partner in a singles category instead of dropping them", async () => {
    const message = await rejects(
      client.mutation(api.entries.add, {
        eventId: singlesId,
        token,
        playerOne: "Anita Rao",
        playerTwo: "Priya Shah",
      }),
    );
    expect(message).toMatch(/singles/i);
  });

  it("skips a pasted pair in a singles category rather than halving it", async () => {
    const result = await client.mutation(api.entries.addMany, {
      eventId: singlesId,
      token,
      text: "Anita Rao / Priya Shah",
    });
    expect(result.added).toBe(0);
    expect(result.skipped.join(" ")).toMatch(/singles/i);

    const rows = await client.query(api.entries.listByEvent, { eventId: singlesId });
    expect(rows).toHaveLength(0);
  });

  it("keeps both names from a pasted pair in a doubles category", async () => {
    const result = await client.mutation(api.entries.addMany, {
      eventId: doublesId,
      token,
      text: ["Anita Rao / Priya Shah", "Rhea Nair / Sonal Desai"].join("\n"),
    });
    expect(result.added).toBe(2);

    const rows = await client.query(api.entries.listByEvent, { eventId: doublesId });
    expect(rows.map((r) => r.playerTwo).sort()).toEqual(["Priya Shah", "Sonal Desai"]);
  });

  it("will not let an edit blank out a partner", async () => {
    const rows = await client.query(api.entries.listByEvent, { eventId: doublesId });
    const message = await rejects(
      client.mutation(api.entries.update, { entryId: rows[0]._id, token, playerTwo: "  " }),
    );
    expect(message).toMatch(/both players/i);
  });

  it("refuses to draw a doubles category holding a half pair", async () => {
    // Reaching this state needs the category switched to doubles after the
    // entrants went in, which is exactly how the original bug was reported.
    await client.mutation(api.entries.addMany, {
      eventId: singlesId,
      token,
      text: ["Anita Rao", "Priya Shah"].join("\n"),
    });
    await client.mutation(api.events.update, { eventId: singlesId, token, teamSize: 2 });

    const message = await rejects(
      client.mutation(api.draws.generate, { eventId: singlesId, token, randomise: false }),
    );
    expect(message).toMatch(/two players/i);
    expect(message).toMatch(/Anita Rao/);
  });

  afterAll(async () => {
    await client.mutation(api.events.remove, { eventId: singlesId, token });
    await client.mutation(api.events.remove, { eventId: doublesId, token });
  }, 60_000);
});
