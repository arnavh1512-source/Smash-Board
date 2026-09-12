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

  it("refuses an end date before the start date on create", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.create, {
        name: `Backwards Range ${Date.now()}`,
        startDate: "2026-09-20",
        endDate: "2026-09-18",
        pin: PIN,
        isPublic: false,
      }),
    );
    expect(message).toMatch(/end date/i);
  });

  it("refuses a malformed date on create", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.create, {
        name: `Bad Date ${Date.now()}`,
        startDate: "20 Sep 2026",
        pin: PIN,
        isPublic: false,
      }),
    );
    expect(message).toMatch(/date/i);
  });

  it("refuses an update that would invert the range against the stored other end", async () => {
    await client.mutation(api.tournaments.update, {
      tournamentId,
      token,
      startDate: "2026-09-20",
      endDate: "2026-09-22",
    });

    const message = await rejects(
      client.mutation(api.tournaments.update, { tournamentId, token, startDate: "2026-09-25" }),
    );
    expect(message).toMatch(/end date/i);

    // Restore a valid range so later tests in this file aren't left with the
    // rejected write's partial state.
    await client.mutation(api.tournaments.update, {
      tournamentId,
      token,
      startDate: "2026-09-20",
      endDate: "2026-09-22",
    });
  });

  it("refuses a malformed date on update", async () => {
    const message = await rejects(
      client.mutation(api.tournaments.update, { tournamentId, token, endDate: "not-a-date" }),
    );
    expect(message).toMatch(/date/i);
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

  it("refuses an edit that adds a partner to a singles entrant", async () => {
    await client.mutation(api.entries.add, { eventId: singlesId, token, playerOne: "Solo Tester" });
    const rows = await client.query(api.entries.listByEvent, { eventId: singlesId });
    const solo = rows.find((r) => r.playerOne === "Solo Tester")!;

    // add() already refuses this. An edit that quietly drops the partner would
    // report success and leave the organiser thinking the pair went in.
    const message = await rejects(
      client.mutation(api.entries.update, { entryId: solo._id, token, playerTwo: "Priya Shah" }),
    );
    expect(message).toMatch(/singles/i);

    const after = await client.query(api.entries.listByEvent, { eventId: singlesId });
    expect(after.find((r) => r._id === solo._id)!.playerTwo).toBeUndefined();

    await client.mutation(api.entries.remove, { entryId: solo._id, token });
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

describe("event settings", () => {
  it("refuses a negative or fractional order", async () => {
    const negative = await rejects(
      client.mutation(api.events.update, { eventId, token, order: -1 }),
    );
    expect(negative).toMatch(/order/i);

    const fractional = await rejects(
      client.mutation(api.events.update, { eventId, token, order: 1.5 }),
    );
    expect(fractional).toMatch(/order/i);
  });

  it("locks the closing-round scoring rules once a semi-final is on court, even with no sets yet", async () => {
    const lockId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Scoring Lock Test",
      teamSize: 1,
      format: "knockout",
      scoring: DEFAULT_SCORING,
      semiFinalScoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    });

    await client.mutation(api.entries.addMany, {
      eventId: lockId,
      token,
      text: ["Player A", "Player B", "Player C", "Player D"].join("\n"),
    });
    await client.mutation(api.draws.generate, { eventId: lockId, token, randomise: false });

    const matches = await client.query(api.matches.listByEvent, { eventId: lockId });
    const semi = matches.find((m) => m.round === 0)!;

    // Putting the match on court with no sets yet is exactly how the UI marks
    // a semi-final "live" before either side has scored a point.
    await client.mutation(api.matches.setScore, { matchId: semi._id, token, sets: [] });
    const live = await client.query(api.matches.listByEvent, { eventId: lockId });
    expect(live.find((m) => m._id === semi._id)!.status).toBe("live");

    const message = await rejects(
      client.mutation(api.events.update, { eventId: lockId, token, semiFinalScoring: null }),
    );
    expect(message).toMatch(/already been played/i);

    await client.mutation(api.events.remove, { eventId: lockId, token });
  });
});

describe("doubles bulk import needs exactly two names", () => {
  let pairsId: Id<"events">;

  beforeAll(async () => {
    pairsId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Mixed Doubles Import",
      teamSize: 2,
      format: "knockout",
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    });
  }, 60_000);

  it("skips a line carrying three names rather than dropping one of them", async () => {
    const result = await client.mutation(api.entries.addMany, {
      eventId: pairsId,
      token,
      text: "Anita Rao / Priya Shah / Rhea Nair",
    });
    expect(result.added).toBe(0);
    expect(result.skipped.join(" ")).toMatch(/needs exactly two players/i);

    const rows = await client.query(api.entries.listByEvent, { eventId: pairsId });
    expect(rows).toHaveLength(0);
  });

  it("keeps the good lines and reports only the overloaded one", async () => {
    const result = await client.mutation(api.entries.addMany, {
      eventId: pairsId,
      token,
      text: [
        "Anita Rao / Priya Shah",
        // A missing newline between two pairs is how this actually happens.
        "Rhea Nair / Sonal Desai / Kiran Menon / Meera Iyer",
        "Tara Bose / Ila Kaur",
      ].join("\n"),
    });
    expect(result.added).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatch(/needs exactly two players/i);

    const rows = await client.query(api.entries.listByEvent, { eventId: pairsId });
    expect(rows.map((r) => r.playerOne).sort()).toEqual(["Anita Rao", "Tara Bose"]);
  });

  afterAll(async () => {
    await client.mutation(api.events.remove, { eventId: pairsId, token });
  }, 60_000);
});

describe("tournament dates must exist on the calendar", () => {
  it.each(["2026-02-31", "2026-02-29", "2026-13-01", "2026-04-31"])(
    "refuses %s on create",
    async (startDate) => {
      const message = await rejects(
        client.mutation(api.tournaments.create, {
          name: `Impossible Date ${Date.now()}`,
          venue: "Ahmedabad",
          organiserName: "Test Organiser",
          organiserPhone: "+918140081461",
          pin: PIN,
          isPublic: false,
          startDate,
        }),
      );
      expect(message).toMatch(/start date must be a valid date/i);
    },
  );

  it("refuses an impossible end date on update and leaves the stored one alone", async () => {
    const before = await client.query(api.tournaments.getBySlug, { slug });
    const message = await rejects(
      client.mutation(api.tournaments.update, { tournamentId, token, endDate: "2026-06-31" }),
    );
    expect(message).toMatch(/end date must be a valid date/i);

    const after = await client.query(api.tournaments.getBySlug, { slug });
    expect(after?.endDate).toBe(before?.endDate);
  });

  it("accepts a real leap day and a real month end", async () => {
    const before = await client.query(api.tournaments.getBySlug, { slug });

    // 2028 is a leap year, so 29 February exists; 2026 is not, so it does not.
    await client.mutation(api.tournaments.update, {
      tournamentId,
      token,
      startDate: "2028-02-29",
      endDate: "2028-04-30",
    });
    const after = await client.query(api.tournaments.getBySlug, { slug });
    expect(after?.startDate).toBe("2028-02-29");
    expect(after?.endDate).toBe("2028-04-30");

    // Put the tournament back the way the other suites left it.
    await client.mutation(api.tournaments.update, {
      tournamentId,
      token,
      startDate: before?.startDate ?? "",
      endDate: before?.endDate ?? "",
    });
  });
});

describe("entries close when the draw is made", () => {
  let closedId: Id<"events">;

  beforeAll(async () => {
    closedId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Entries Closed Test",
      teamSize: 1,
      format: "knockout",
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    });
    await client.mutation(api.entries.addMany, {
      eventId: closedId,
      token,
      text: ["Player One", "Player Two", "Player Three", "Player Four"].join("\n"),
    });
    await client.mutation(api.draws.generate, { eventId: closedId, token, randomise: false });
  }, 60_000);

  it("refuses a late entrant one at a time, and leaves the bracket alone", async () => {
    const before = await client.query(api.matches.listByEvent, { eventId: closedId });

    const message = await rejects(
      client.mutation(api.entries.add, { eventId: closedId, token, playerOne: "Player Nine" }),
    );
    expect(message).toMatch(/entries for this category are closed/i);

    // A ninth name in the entry list over an eight-player bracket is the state
    // this guard exists to prevent, so check the list as well as the matches.
    const rows = await client.query(api.entries.listByEvent, { eventId: closedId });
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.playerOne === "Player Nine")).toBe(false);
    expect(await client.query(api.matches.listByEvent, { eventId: closedId })).toEqual(before);
  });

  it("refuses a pasted list too, rather than skipping the lines one by one", async () => {
    const message = await rejects(
      client.mutation(api.entries.addMany, {
        eventId: closedId,
        token,
        text: ["Player Nine", "Player Ten"].join("\n"),
      }),
    );
    expect(message).toMatch(/entries for this category are closed/i);

    const rows = await client.query(api.entries.listByEvent, { eventId: closedId });
    expect(rows).toHaveLength(4);
  });

  it("refuses a form import as well, so no door is left open", async () => {
    const message = await rejects(
      client.mutation(api.entries.importRows, {
        eventId: closedId,
        token,
        rows: [{ playerOne: "Player Nine" }],
      }),
    );
    expect(message).toMatch(/entries for this category are closed/i);

    const rows = await client.query(api.entries.listByEvent, { eventId: closedId });
    expect(rows).toHaveLength(4);
  });

  it("opens again once the draw is cleared", async () => {
    await client.mutation(api.draws.clear, { eventId: closedId, token });
    await client.mutation(api.entries.add, { eventId: closedId, token, playerOne: "Player Nine" });

    const rows = await client.query(api.entries.listByEvent, { eventId: closedId });
    expect(rows).toHaveLength(5);
  });

  afterAll(async () => {
    await client.mutation(api.events.remove, { eventId: closedId, token });
  }, 60_000);
});


/**
 * Importing the sheet a Google Form filled in.
 *
 * The browser parses the sheet and maps the columns; these tests are about
 * what the server does with the rows it is handed, which is where the rules
 * that matter are enforced - a pair needs two people, a singles category
 * refuses one, and nobody gets entered twice however many times they filled
 * the form in.
 */
describe("importing entrants from a form response sheet", () => {
  let importId: Id<"events">;
  let importPairsId: Id<"events">;

  beforeAll(async () => {
    const common = {
      tournamentId,
      token,
      format: "knockout" as const,
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    };
    importId = await client.mutation(api.events.create, {
      ...common,
      name: "Form Import Singles",
      teamSize: 1,
    });
    importPairsId = await client.mutation(api.events.create, {
      ...common,
      name: "Form Import Doubles",
      teamSize: 2,
    });
  }, 60_000);

  it("takes the club and the phone number the form asked for", async () => {
    const outcome = await client.mutation(api.entries.importRows, {
      eventId: importId,
      token,
      rows: [
        { playerOne: "Rohan Mehta", club: "Ahmedabad SC", phone: "9876543210" },
        { playerOne: "Dev Patel" },
      ],
    });
    expect(outcome).toEqual({ added: 2, skipped: [] });

    const rows = await client.query(api.entries.listByEvent, { eventId: importId });
    const rohan = rows.find((r) => r.playerOne === "Rohan Mehta")!;
    expect(rohan.club).toBe("Ahmedabad SC");
    // The public list never carries a phone number; the organiser reads it
    // back through revealContact, which checks the PIN.
    expect("phone" in rohan).toBe(false);
    expect(await client.mutation(api.entries.revealContact, { entryId: rohan._id, token })).toBe(
      "9876543210",
    );
  });

  it("refuses to enter the same person twice, however the form was filled in", async () => {
    // Somebody submits, panics, and submits again with different capitals.
    const outcome = await client.mutation(api.entries.importRows, {
      eventId: importId,
      token,
      rows: [
        { playerOne: "rohan   MEHTA" },
        { playerOne: "Kabir Shah" },
        { playerOne: "Kabir Shah" },
      ],
    });
    expect(outcome.added).toBe(1);
    expect(outcome.skipped).toHaveLength(2);
    expect(outcome.skipped.every((line) => /already entered/i.test(line))).toBe(true);

    const rows = await client.query(api.entries.listByEvent, { eventId: importId });
    expect(rows.filter((r) => /kabir/i.test(r.playerOne))).toHaveLength(1);
  });

  it("refuses a partner in a singles category rather than dropping the name", async () => {
    const outcome = await client.mutation(api.entries.importRows, {
      eventId: importId,
      token,
      rows: [{ playerOne: "Vivek Nair", playerTwo: "Ila Kaur" }],
    });
    expect(outcome.added).toBe(0);
    expect(outcome.skipped[0]).toMatch(/singles category/i);
  });

  it("keeps both halves of a pair, and skips a row missing one", async () => {
    const outcome = await client.mutation(api.entries.importRows, {
      eventId: importPairsId,
      token,
      rows: [
        { playerOne: "Anita Rao", playerTwo: "Priya Shah" },
        { playerOne: "Meera Iyer" },
        { playerOne: "Tara Bose", playerTwo: "Sonal Desai" },
      ],
    });
    expect(outcome.added).toBe(2);
    expect(outcome.skipped[0]).toMatch(/needs exactly two players/i);

    const rows = await client.query(api.entries.listByEvent, { eventId: importPairsId });
    expect(rows.map((r) => `${r.playerOne} / ${r.playerTwo}`).sort()).toEqual([
      "Anita Rao / Priya Shah",
      "Tara Bose / Sonal Desai",
    ]);
  });

  it("will not let a pair reuse somebody already playing in the category", async () => {
    const outcome = await client.mutation(api.entries.importRows, {
      eventId: importPairsId,
      token,
      rows: [{ playerOne: "Ila Kaur", playerTwo: "priya shah" }],
    });
    expect(outcome.added).toBe(0);
    expect(outcome.skipped[0]).toMatch(/already entered/i);
  });

  it("needs the organiser PIN like every other way in", async () => {
    const message = await rejects(
      client.mutation(api.entries.importRows, {
        eventId: importId,
        token: "not-a-token",
        rows: [{ playerOne: "Gate Crasher" }],
      }),
    );
    expect(message).toMatch(/pin|session|organiser/i);
  });

  afterAll(async () => {
    await client.mutation(api.events.remove, { eventId: importId, token });
    await client.mutation(api.events.remove, { eventId: importPairsId, token });
  }, 60_000);
});

/**
 * One person, one place in a category.
 *
 * `personKey` decides whether two spellings are the same human being, and the
 * scheduler rests people rather than registrations. Two entries for one person
 * in the same category is therefore a player the planner will put on two courts
 * at once, and a bracket line that can draw them against themselves. The rule
 * has to hold at every door into the entry list: the single form, the paste
 * box, the form import and the edit.
 */
describe("one person enters a category once", () => {
  let onceId: Id<"events">;
  let oncePairsId: Id<"events">;

  beforeAll(async () => {
    const common = {
      tournamentId,
      token,
      format: "knockout" as const,
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    };
    onceId = await client.mutation(api.events.create, {
      ...common,
      name: "One Person Singles",
      teamSize: 1,
    });
    oncePairsId = await client.mutation(api.events.create, {
      ...common,
      name: "One Person Doubles",
      teamSize: 2,
    });
  }, 60_000);

  it("refuses the same person typed again with different spacing and capitals", async () => {
    await client.mutation(api.entries.add, { eventId: onceId, token, playerOne: "Rohan Mehta" });
    const message = await rejects(
      client.mutation(api.entries.add, { eventId: onceId, token, playerOne: "rohan   MEHTA" }),
    );
    expect(message).toMatch(/already entered/i);
    // The refusal names the entry it clashes with, so the organiser can find it.
    expect(message).toMatch(/Rohan Mehta/);

    const rows = await client.query(api.entries.listByEvent, { eventId: onceId });
    expect(rows.filter((row) => /rohan/i.test(row.playerOne))).toHaveLength(1);
  });

  it("counts a withdrawn entrant, because they are still in the draw", async () => {
    const added = await client.mutation(api.entries.add, {
      eventId: onceId,
      token,
      playerOne: "Kabir Shah",
    });
    await client.mutation(api.entries.update, { entryId: added, token, withdrawn: true });
    const message = await rejects(
      client.mutation(api.entries.add, { eventId: onceId, token, playerOne: "Kabir Shah" }),
    );
    expect(message).toMatch(/already entered/i);
  });

  it("skips the repeat when a pasted list is pasted twice", async () => {
    const text = "Dev Patel\nVivek Nair";
    const first = await client.mutation(api.entries.addMany, { eventId: onceId, token, text });
    expect(first.added).toBe(2);

    const second = await client.mutation(api.entries.addMany, { eventId: onceId, token, text });
    expect(second.added).toBe(0);
    expect(second.skipped).toHaveLength(2);
    expect(second.skipped.every((line) => /already entered/i.test(line))).toBe(true);
  });

  it("refuses a pair that is one person entered as both halves", async () => {
    const message = await rejects(
      client.mutation(api.entries.add, {
        eventId: oncePairsId,
        token,
        playerOne: "Anita Rao",
        playerTwo: "anita  rao",
      }),
    );
    expect(message).toMatch(/same person/i);
  });

  it("refuses a partner who is already playing with somebody else", async () => {
    await client.mutation(api.entries.add, {
      eventId: oncePairsId,
      token,
      playerOne: "Tara Bose",
      playerTwo: "Sonal Desai",
    });
    const message = await rejects(
      client.mutation(api.entries.add, {
        eventId: oncePairsId,
        token,
        playerOne: "Meera Iyer",
        playerTwo: "SONAL   desai",
      }),
    );
    expect(message).toMatch(/already entered/i);
  });

  it("refuses an edit that renames somebody onto another entrant", async () => {
    const rows = await client.query(api.entries.listByEvent, { eventId: onceId });
    const dev = rows.find((row) => row.playerOne === "Dev Patel")!;
    const message = await rejects(
      client.mutation(api.entries.update, { entryId: dev._id, token, playerOne: "Vivek Nair" }),
    );
    expect(message).toMatch(/already entered/i);

    // Their own name is not a clash with themselves: a typo fix still saves.
    await client.mutation(api.entries.update, {
      entryId: dev._id,
      token,
      playerOne: "Dev Patell",
    });
    const after = await client.query(api.entries.listByEvent, { eventId: onceId });
    expect(after.find((row) => row._id === dev._id)!.playerOne).toBe("Dev Patell");
  });

  it("lets an edit that changes nothing about the name through", async () => {
    const rows = await client.query(api.entries.listByEvent, { eventId: onceId });
    const target = rows.find((row) => row.playerOne === "Vivek Nair")!;
    await client.mutation(api.entries.update, { entryId: target._id, token, club: "Nadiad BC" });
    const after = await client.query(api.entries.listByEvent, { eventId: onceId });
    expect(after.find((row) => row._id === target._id)!.club).toBe("Nadiad BC");
  });

  it("lets the same person enter a different category", async () => {
    // The rule is about one category, not the tournament: a player enters the
    // singles and the doubles, which is the whole point of a mixed entry list.
    await client.mutation(api.entries.add, {
      eventId: oncePairsId,
      token,
      playerOne: "Rohan Mehta",
      playerTwo: "Dev Patell",
    });
    const rows = await client.query(api.entries.listByEvent, { eventId: oncePairsId });
    expect(rows.some((row) => row.playerOne === "Rohan Mehta")).toBe(true);
  });

  afterAll(async () => {
    await client.mutation(api.events.remove, { eventId: onceId, token });
    await client.mutation(api.events.remove, { eventId: oncePairsId, token });
  }, 60_000);
});

/**
 * A result is corrected the same way in both directions.
 *
 * Turning a played score into a walkover already needs a reset first. The
 * reverse has to need one too, or the correction workflow is asymmetric and a
 * walkover can be typed over with no trace that the match was ever awarded.
 */
describe("a walkover is corrected the same way a score is", () => {
  let awardId: Id<"events">;
  let awarded: Id<"matches">;

  beforeAll(async () => {
    awardId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Walkover Symmetry",
      teamSize: 1,
      format: "knockout",
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 2,
      advancePerGroup: 2,
      doubleRound: false,
    });
    for (const name of ["Wo One", "Wo Two", "Wo Three", "Wo Four"]) {
      await client.mutation(api.entries.add, { eventId: awardId, token, playerOne: name });
    }
    await client.mutation(api.draws.generate, { eventId: awardId, token, randomise: false });
    const matches = await client.query(api.matches.listByEvent, { eventId: awardId });
    const semi = matches.find((match) => match.round === 0 && match.aId && match.bId)!;
    await client.mutation(api.matches.setWalkover, {
      matchId: semi._id,
      token,
      winnerId: semi.aId,
    });
    awarded = semi._id;
  }, 60_000);

  it("refuses a played score on a match that was awarded", async () => {
    const message = await rejects(
      client.mutation(api.matches.setScore, {
        matchId: awarded,
        token,
        sets: [
          { a: 21, b: 15 },
          { a: 21, b: 19 },
        ],
      }),
    );
    expect(message).toMatch(/walkover/i);
    expect(message).toMatch(/reset/i);

    const after = await client.query(api.matches.listByEvent, { eventId: awardId });
    const match = after.find((row) => row._id === awarded)!;
    expect(match.status).toBe("walkover");
    expect(match.sets).toEqual([]);
  });

  it("takes the score once the walkover has been reset", async () => {
    await client.mutation(api.matches.reset, { matchId: awarded, token });
    await client.mutation(api.matches.setScore, {
      matchId: awarded,
      token,
      sets: [
        { a: 21, b: 15 },
        { a: 21, b: 19 },
      ],
    });
    const after = await client.query(api.matches.listByEvent, { eventId: awardId });
    expect(after.find((row) => row._id === awarded)!.status).toBe("completed");
  });

  it("still refuses a walkover over a played score, the other way round", async () => {
    const matches = await client.query(api.matches.listByEvent, { eventId: awardId });
    const played = matches.find((row) => row._id === awarded)!;
    const message = await rejects(
      client.mutation(api.matches.setWalkover, {
        matchId: awarded,
        token,
        winnerId: played.aId,
      }),
    );
    expect(message).toMatch(/reset/i);
  });

  it("refuses a start time that is not a real date and time", async () => {
    for (const when of ["tomorrow", "2026-99-99T90:90", "2026-02-31T09:30", "09:30"]) {
      const message = await rejects(
        client.mutation(api.matches.setDetails, { matchId: awarded, token, scheduledAt: when }),
      );
      expect(message).toMatch(/date and time/i);
    }
  });

  it("takes the shape the planner writes, and takes a blank to clear it", async () => {
    await client.mutation(api.matches.setDetails, {
      matchId: awarded,
      token,
      scheduledAt: "2026-09-12T09:30",
      court: "Court 2",
    });
    let after = await client.query(api.matches.listByEvent, { eventId: awardId });
    expect(after.find((row) => row._id === awarded)!.scheduledAt).toBe("2026-09-12T09:30");

    await client.mutation(api.matches.setDetails, { matchId: awarded, token, scheduledAt: "" });
    after = await client.query(api.matches.listByEvent, { eventId: awardId });
    expect(after.find((row) => row._id === awarded)!.scheduledAt).toBeUndefined();
  });

  afterAll(async () => {
    // The category ends the run with a played result in it, which is exactly
    // what the deletion barrier refuses without a confirmation.
    await client.mutation(api.events.remove, { eventId: awardId, token, force: true });
  }, 60_000);
});
