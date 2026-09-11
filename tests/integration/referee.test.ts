/**
 * Integration tests for the referee PIN and the sign-in door.
 *
 * The point of the second PIN is that an umpire can be handed a phone without
 * being handed the tournament. These tests pin down both halves of that: what a
 * referee session opens, and — more importantly — what it does not.
 *
 * They also cover the lockout, which is the reason `signIn` returns a verdict
 * instead of throwing: a Convex mutation is a transaction, so a guard that
 * recorded a wrong guess and then threw would lose that write to the rollback
 * and the counter would never climb.
 *
 * Like the rest of the integration suite these run against the deployment in
 * NEXT_PUBLIC_CONVEX_URL via `npm run test:integration`.
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
const REFEREE_PIN = "445566";
const WRONG_PIN = "0000";

let tournamentId: Id<"tournaments">;
let slug: string;
let eventId: Id<"events">;
let matchId: Id<"matches">;
let sideA: Id<"entries"> | null;
let token: string;
let refToken: string;

/** See the note on the same helper in backend.test.ts — production redacts `message`. */
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

function signIn(id: Id<"tournaments">, pin: string, role?: "organiser" | "referee") {
  return client.mutation(api.tournaments.signIn, { tournamentId: id, pin, role });
}

/** Sign in and insist it worked, for the setup steps that assume a good PIN. */
async function tokenFor(
  id: Id<"tournaments">,
  pin: string,
  role?: "organiser" | "referee",
): Promise<string> {
  const result = await signIn(id, pin, role);
  if (!result.ok || !result.token) throw new Error(result.error ?? "Sign-in failed.");
  return result.token;
}

async function makeTournament(name: string) {
  return await client.mutation(api.tournaments.create, {
    name: `${name} ${Date.now()}`,
    venue: "Ahmedabad",
    organiserName: "Test Organiser",
    organiserPhone: "+918140081461",
    pin: PIN,
    isPublic: false,
  });
}

beforeAll(async () => {
  const created = await makeTournament("Referee Run");
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
    thirdPlace: false,
    groupCount: 2,
    advancePerGroup: 2,
    doubleRound: false,
  });

  await client.mutation(api.entries.addMany, {
    eventId,
    token,
    text: ["Anita Rao", "Bhavin Shah"].join("\n"),
  });
  await client.mutation(api.draws.generate, { eventId, token, randomise: false });

  const matches = await client.query(api.matches.listByEvent, { eventId });
  matchId = matches[0]._id;
  sideA = matches[0].aId;

  await client.mutation(api.tournaments.setRefereePin, {
    tournamentId,
    token,
    refereePin: REFEREE_PIN,
  });
  refToken = await tokenFor(tournamentId, REFEREE_PIN, "referee");
}, 60_000);

afterAll(async () => {
  if (tournamentId) await client.mutation(api.tournaments.remove, { tournamentId, token });
}, 60_000);

describe("the sign-in door", () => {
  it("hands back a token the guarded mutations accept", async () => {
    const result = await signIn(tournamentId, PIN);
    expect(result.ok).toBe(true);
    expect(result.role).toBe("organiser");
    expect(typeof result.token).toBe("string");
  });

  it("reports a wrong PIN instead of throwing", async () => {
    const result = await signIn(tournamentId, WRONG_PIN);
    expect(result.ok).toBe(false);
    expect(result.token).toBeUndefined();
    expect(result.error).toMatch(/PIN/i);
  });

  it("never lets a token be forged from its own shape", async () => {
    const forged = `organiser.${Date.now() + 3_600_000}.${"0".repeat(64)}`;
    expect(
      await rejects(client.mutation(api.tournaments.update, { tournamentId, token: forged, name: "Hijacked" })),
    ).toMatch(/session/i);
  });

  it("refuses a token whose expiry has been pushed forward by hand", async () => {
    const [role, , mac] = (await tokenFor(tournamentId, PIN)).split(".");
    const stretched = `${role}.${Date.now() + 90 * 24 * 3_600_000}.${mac}`;
    expect(
      await rejects(client.mutation(api.tournaments.update, { tournamentId, token: stretched, name: "Hijacked" })),
    ).toMatch(/session/i);
  });
});

describe("setting the referee PIN", () => {
  it("tells the public page a referee PIN exists without leaking it", async () => {
    const found = await client.query(api.tournaments.getBySlug, { slug });
    expect(found?.hasRefereePin).toBe(true);
    expect(found).not.toHaveProperty("refereePinHash");
    expect(JSON.stringify(found)).not.toContain(REFEREE_PIN);
  });

  it("refuses a referee PIN that is the same as the organiser PIN", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.setRefereePin, { tournamentId, token, refereePin: PIN }),
    );
    expect(message).toMatch(/different|same/i);
  });

  it("refuses a referee PIN that is too short to be worth having", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.setRefereePin, { tournamentId, token, refereePin: "12" }),
    );
    expect(message).toMatch(/Referee PIN/i);
  });

  it("will not let a referee issue a referee PIN", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.setRefereePin, {
        tournamentId,
        token: refToken,
        refereePin: "778899",
      }),
    );
    expect(message).toMatch(/organiser/i);
  });
});

describe("the two sign-in doors", () => {
  it("opens the referee console with either PIN", async () => {
    await expect(signIn(tournamentId, REFEREE_PIN, "referee")).resolves.toMatchObject({
      ok: true,
      role: "referee",
    });
    await expect(signIn(tournamentId, PIN, "referee")).resolves.toMatchObject({
      ok: true,
      role: "organiser",
    });
  });

  it("opens the organiser console only with the organiser PIN", async () => {
    const result = await signIn(tournamentId, REFEREE_PIN, "organiser");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/organiser PIN/i);
  });
});

describe("what a referee may do", () => {
  it("enters a score", async () => {
    await client.mutation(api.matches.setScore, {
      matchId,
      token: refToken,
      sets: [
        { a: 21, b: 15 },
        { a: 21, b: 19 },
      ],
    });

    const matches = await client.query(api.matches.listByEvent, { eventId });
    const played = matches.find((m) => m._id === matchId)!;
    expect(played.status).toBe("completed");
    expect(played.winnerId).toBe(sideA);
  });

  it("resets a match it got wrong", async () => {
    await client.mutation(api.matches.reset, { matchId, token: refToken });
    const matches = await client.query(api.matches.listByEvent, { eventId });
    expect(matches.find((m) => m._id === matchId)!.status).toBe("scheduled");
  });

  it("awards a walkover", async () => {
    await client.mutation(api.matches.setWalkover, {
      matchId,
      token: refToken,
      winnerId: sideA,
    });
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const played = matches.find((m) => m._id === matchId)!;
    expect(played.status).toBe("walkover");
    expect(played.winnerId).toBe(sideA);

    await client.mutation(api.matches.reset, { matchId, token: refToken });
  });
});

describe("what a referee may not do", () => {
  it("cannot redraw or clear the event", async () => {
    expect(
      await rejects(
        client.mutation(api.draws.generate, { eventId, token: refToken, randomise: true }),
      ),
    ).toMatch(/organiser/i);
    expect(
      await rejects(client.mutation(api.draws.clear, { eventId, token: refToken })),
    ).toMatch(/organiser/i);
  });

  it("cannot touch the entry list", async () => {
    expect(
      await rejects(
        client.mutation(api.entries.add, {
          eventId,
          token: refToken,
          playerOne: "Gate Crasher",
        }),
      ),
    ).toMatch(/organiser/i);
  });

  it("cannot rename or publish the tournament", async () => {
    expect(
      await rejects(
        client.mutation(api.tournaments.update, {
          tournamentId,
          token: refToken,
          name: "Hijacked",
          isPublic: true,
        }),
      ),
    ).toMatch(/organiser/i);
  });

  it("cannot plan the order of play", async () => {
    expect(
      await rejects(
        client.mutation(api.schedule.generate, {
          tournamentId,
          token: refToken,
          dayStart: "09:00",
          matchMinutes: 30,
          restMinutes: 30,
          courts: 2,
        }),
      ),
    ).toMatch(/organiser/i);
  });

  it("cannot delete the tournament", async () => {
    expect(
      await rejects(client.mutation(api.tournaments.remove, { tournamentId, token: refToken })),
    ).toMatch(/organiser/i);

    // Still there.
    const found = await client.query(api.tournaments.getBySlug, { slug });
    expect(found?._id).toBe(tournamentId);
  });
});

describe("withdrawing the referee PIN", () => {
  it("stops working once the organiser clears it", async () => {
    await client.mutation(api.tournaments.setRefereePin, {
      tournamentId,
      token,
      refereePin: null,
    });

    const found = await client.query(api.tournaments.getBySlug, { slug });
    expect(found?.hasRefereePin).toBe(false);
    expect((await signIn(tournamentId, REFEREE_PIN, "referee")).error).toMatch(/not recognised/i);

    // The token that PIN bought dies with it, so a referee already holding one
    // cannot keep scoring after being stood down.
    expect(
      await rejects(client.mutation(api.matches.reset, { matchId, token: refToken })),
    ).toMatch(/session/i);

    // Put it back for the tests that follow.
    await client.mutation(api.tournaments.setRefereePin, {
      tournamentId,
      token,
      refereePin: REFEREE_PIN,
    });
  });

  it("is dropped when the organiser changes their own PIN", async () => {
    const scratch = await makeTournament("Referee PIN Rotation");
    await client.mutation(api.tournaments.setRefereePin, {
      tournamentId: scratch.tournamentId,
      token: scratch.token,
      refereePin: REFEREE_PIN,
    });

    const newPin = "9988776655";
    const rotated = await client.mutation(api.tournaments.changePin, {
      tournamentId: scratch.tournamentId,
      token: scratch.token,
      newPin,
    });

    // A new salt invalidates the old referee hash, so the PIN has to be reissued.
    const found = await client.query(api.tournaments.getBySlug, { slug: scratch.slug });
    expect(found?.hasRefereePin).toBe(false);
    expect(
      (await signIn(scratch.tournamentId, REFEREE_PIN, "referee")).error,
    ).toMatch(/not recognised/i);

    // The organiser's own old token dies with the old hash too, which is why
    // `changePin` hands back a replacement.
    expect(
      await rejects(
        client.mutation(api.tournaments.update, {
          tournamentId: scratch.tournamentId,
          token: scratch.token,
          name: "Stale session",
        }),
      ),
    ).toMatch(/session/i);

    await client.mutation(api.tournaments.remove, {
      tournamentId: scratch.tournamentId,
      token: rotated,
    });
  }, 60_000);
});

describe("the lockout", () => {
  /**
   * The failure counter is shared across both PINs on purpose, so a guesser
   * cannot buy a fresh set of tries by switching which door they knock on.
   *
   * This test deliberately locks a throwaway tournament and then cannot delete
   * it — a locked tournament refuses even the correct organiser PIN, which is
   * the whole point. It is created unlisted, and the lock expires on its own
   * after ten minutes, so the record is left behind rather than orphaned
   * forever. That is the cost of covering this path honestly.
   */
  it("counts wrong guesses at both doors towards one lockout", async () => {
    const scratch = await makeTournament("Referee Lockout");
    await client.mutation(api.tournaments.setRefereePin, {
      tournamentId: scratch.tournamentId,
      token: scratch.token,
      refereePin: REFEREE_PIN,
    });

    // Four at the organiser door, three at the referee door: seven wrong
    // guesses in total, one short of the limit.
    for (let attempt = 0; attempt < 7; attempt++) {
      const result = await signIn(
        scratch.tournamentId,
        WRONG_PIN,
        attempt < 4 ? "organiser" : "referee",
      );
      expect(result.ok).toBe(false);
      expect(result.error).not.toMatch(/Try again in/i);
    }

    // The eighth tips it over, whichever door it comes through.
    expect((await signIn(scratch.tournamentId, WRONG_PIN, "referee")).error).toMatch(
      /Too many wrong PINs/i,
    );

    // Locked means locked: the right PIN is refused too.
    expect((await signIn(scratch.tournamentId, PIN)).error).toMatch(/Try again in/i);

    // A token minted before the lock still works. The lock guards the door, not
    // the organiser who is already inside and may need to fix what went wrong.
    await client.mutation(api.tournaments.update, {
      tournamentId: scratch.tournamentId,
      token: scratch.token,
      name: "Locked but reachable",
    });
  }, 120_000);

  it("forgives the earlier guesses once a correct PIN lands", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await signIn(tournamentId, WRONG_PIN)).ok).toBe(false);
    }
    expect((await signIn(tournamentId, REFEREE_PIN, "referee")).ok).toBe(true);

    // The counter is back at zero, so seven more wrong guesses still do not lock.
    for (let attempt = 0; attempt < 7; attempt++) {
      const result = await signIn(tournamentId, WRONG_PIN);
      expect(result.ok).toBe(false);
      expect(result.error).not.toMatch(/Try again in/i);
    }
    expect((await signIn(tournamentId, PIN)).ok).toBe(true);
  }, 120_000);
});
