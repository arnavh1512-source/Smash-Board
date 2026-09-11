/**
 * Integration tests for the referee PIN.
 *
 * The point of the second PIN is that an umpire can be handed a phone without
 * being handed the tournament. These tests pin down both halves of that: what a
 * referee PIN opens, and — more importantly — what it does not.
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

  eventId = await client.mutation(api.events.create, {
    tournamentId,
    pin: PIN,
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
    pin: PIN,
    text: ["Anita Rao", "Bhavin Shah"].join("\n"),
  });
  await client.mutation(api.draws.generate, { eventId, pin: PIN, randomise: false });

  const matches = await client.query(api.matches.listByEvent, { eventId });
  matchId = matches[0]._id;
  sideA = matches[0].aId;

  await client.mutation(api.tournaments.setRefereePin, {
    tournamentId,
    pin: PIN,
    refereePin: REFEREE_PIN,
  });
}, 60_000);

afterAll(async () => {
  if (tournamentId) await client.mutation(api.tournaments.remove, { tournamentId, pin: PIN });
}, 60_000);

describe("setting the referee PIN", () => {
  it("tells the public page a referee PIN exists without leaking it", async () => {
    const found = await client.query(api.tournaments.getBySlug, { slug });
    expect(found?.hasRefereePin).toBe(true);
    expect(found).not.toHaveProperty("refereePinHash");
    expect(JSON.stringify(found)).not.toContain(REFEREE_PIN);
  });

  it("refuses a referee PIN that is the same as the organiser PIN", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.setRefereePin, {
        tournamentId,
        pin: PIN,
        refereePin: PIN,
      }),
    );
    expect(message).toMatch(/different|same/i);
  });

  it("refuses a referee PIN that is too short to be worth having", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.setRefereePin, {
        tournamentId,
        pin: PIN,
        refereePin: "12",
      }),
    );
    expect(message).toMatch(/Referee PIN/i);
  });

  it("will not let a referee issue a referee PIN", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.setRefereePin, {
        tournamentId,
        pin: REFEREE_PIN,
        refereePin: "778899",
      }),
    );
    expect(message).toMatch(/PIN/i);
  });
});

describe("the two sign-in doors", () => {
  it("opens the referee console with either PIN", async () => {
    await expect(
      client.mutation(api.tournaments.verifyPin, {
        tournamentId,
        pin: REFEREE_PIN,
        role: "referee",
      }),
    ).resolves.toBeNull();
    await expect(
      client.mutation(api.tournaments.verifyPin, { tournamentId, pin: PIN, role: "referee" }),
    ).resolves.toBeNull();
  });

  it("opens the organiser console only with the organiser PIN", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.verifyPin, {
        tournamentId,
        pin: REFEREE_PIN,
        role: "organiser",
      }),
    );
    expect(message).toMatch(/organiser PIN/i);
  });
});

describe("what a referee may do", () => {
  it("enters a score", async () => {
    await client.mutation(api.matches.setScore, {
      matchId,
      pin: REFEREE_PIN,
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
    await client.mutation(api.matches.reset, { matchId, pin: REFEREE_PIN });
    const matches = await client.query(api.matches.listByEvent, { eventId });
    expect(matches.find((m) => m._id === matchId)!.status).toBe("scheduled");
  });

  it("awards a walkover", async () => {
    await client.mutation(api.matches.setWalkover, {
      matchId,
      pin: REFEREE_PIN,
      winnerId: sideA,
    });
    const matches = await client.query(api.matches.listByEvent, { eventId });
    const played = matches.find((m) => m._id === matchId)!;
    expect(played.status).toBe("walkover");
    expect(played.winnerId).toBe(sideA);

    await client.mutation(api.matches.reset, { matchId, pin: REFEREE_PIN });
  });
});

describe("what a referee may not do", () => {
  it("cannot redraw or clear the event", async () => {
    expect(
      await rejects(client.mutation(api.draws.generate, { eventId, pin: REFEREE_PIN, randomise: true })),
    ).toMatch(/organiser PIN/i);
    expect(await rejects(client.mutation(api.draws.clear, { eventId, pin: REFEREE_PIN }))).toMatch(
      /organiser PIN/i,
    );
  });

  it("cannot touch the entry list", async () => {
    expect(
      await rejects(
        client.mutation(api.entries.add, { eventId, pin: REFEREE_PIN, playerOne: "Gate Crasher" }),
      ),
    ).toMatch(/organiser PIN/i);
  });

  it("cannot rename or publish the tournament", async () => {
    expect(
      await rejects(
        client.mutation(api.tournaments.update, {
          tournamentId,
          pin: REFEREE_PIN,
          name: "Hijacked",
          isPublic: true,
        }),
      ),
    ).toMatch(/organiser PIN/i);
  });

  it("cannot plan the order of play", async () => {
    expect(
      await rejects(
        client.mutation(api.schedule.generate, {
          tournamentId,
          pin: REFEREE_PIN,
          dayStart: "09:00",
          matchMinutes: 30,
          restMinutes: 30,
          courts: 2,
        }),
      ),
    ).toMatch(/organiser PIN/i);
  });

  it("cannot delete the tournament", async () => {
    expect(
      await rejects(client.mutation(api.tournaments.remove, { tournamentId, pin: REFEREE_PIN })),
    ).toMatch(/organiser PIN/i);

    // Still there.
    const found = await client.query(api.tournaments.getBySlug, { slug });
    expect(found?._id).toBe(tournamentId);
  });
});

describe("withdrawing the referee PIN", () => {
  it("stops working once the organiser clears it", async () => {
    await client.mutation(api.tournaments.setRefereePin, {
      tournamentId,
      pin: PIN,
      refereePin: null,
    });

    const found = await client.query(api.tournaments.getBySlug, { slug });
    expect(found?.hasRefereePin).toBe(false);
    expect(
      await rejects(
        client.mutation(api.tournaments.verifyPin, {
          tournamentId,
          pin: REFEREE_PIN,
          role: "referee",
        }),
      ),
    ).toMatch(/not recognised/i);

    // Put it back for the tests that follow.
    await client.mutation(api.tournaments.setRefereePin, {
      tournamentId,
      pin: PIN,
      refereePin: REFEREE_PIN,
    });
  });

  it("is dropped when the organiser changes their own PIN", async () => {
    const scratch = await makeTournament("Referee PIN Rotation");
    await client.mutation(api.tournaments.setRefereePin, {
      tournamentId: scratch.tournamentId,
      pin: PIN,
      refereePin: REFEREE_PIN,
    });

    const newPin = "9988776655";
    await client.mutation(api.tournaments.changePin, {
      tournamentId: scratch.tournamentId,
      pin: PIN,
      newPin,
    });

    // A new salt invalidates the old referee hash, so the PIN has to be reissued.
    const found = await client.query(api.tournaments.getBySlug, { slug: scratch.slug });
    expect(found?.hasRefereePin).toBe(false);
    expect(
      await rejects(
        client.mutation(api.tournaments.verifyPin, {
          tournamentId: scratch.tournamentId,
          pin: REFEREE_PIN,
          role: "referee",
        }),
      ),
    ).toMatch(/not recognised/i);

    await client.mutation(api.tournaments.remove, {
      tournamentId: scratch.tournamentId,
      pin: newPin,
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
      pin: PIN,
      refereePin: REFEREE_PIN,
    });

    // Four at the organiser door, three at the referee door: seven wrong
    // guesses in total, one short of the limit.
    for (let attempt = 0; attempt < 7; attempt++) {
      const message = await rejects(
        client.mutation(api.tournaments.verifyPin, {
          tournamentId: scratch.tournamentId,
          pin: WRONG_PIN,
          role: attempt < 4 ? "organiser" : "referee",
        }),
      );
      expect(message).not.toMatch(/Try again in/i);
    }

    // The eighth tips it over, whichever door it comes through.
    expect(
      await rejects(
        client.mutation(api.tournaments.verifyPin, {
          tournamentId: scratch.tournamentId,
          pin: WRONG_PIN,
          role: "referee",
        }),
      ),
    ).toMatch(/Too many wrong PINs/i);

    // Locked means locked: the right PIN is refused too.
    expect(
      await rejects(
        client.mutation(api.tournaments.verifyPin, { tournamentId: scratch.tournamentId, pin: PIN }),
      ),
    ).toMatch(/Try again in/i);
  }, 120_000);

  it("forgives the earlier guesses once a correct PIN lands", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await rejects(
        client.mutation(api.tournaments.verifyPin, { tournamentId, pin: WRONG_PIN }),
      );
    }
    await expect(
      client.mutation(api.tournaments.verifyPin, { tournamentId, pin: REFEREE_PIN, role: "referee" }),
    ).resolves.toBeNull();

    // The counter is back at zero, so seven more wrong guesses still do not lock.
    for (let attempt = 0; attempt < 7; attempt++) {
      const message = await rejects(
        client.mutation(api.tournaments.verifyPin, { tournamentId, pin: WRONG_PIN }),
      );
      expect(message).not.toMatch(/Try again in/i);
    }
    await expect(
      client.mutation(api.tournaments.verifyPin, { tournamentId, pin: PIN }),
    ).resolves.toBeNull();
  }, 120_000);
});
