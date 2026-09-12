/**
 * The two full tournament runs a reviewer asked to be tested hard, plus the
 * guards that were added alongside them.
 *
 * Scenario A: 20 entrants, knockout, seeds 1-4, byes, every match scored, a
 * third-place playoff, a semi-final corrected, a semi-finalist withdrawn, and
 * the order of play built at the end.
 *
 * Scenario B: 16 entrants, four groups of four, top two qualify, every group
 * completed, the quarter-finals played, then one group result changed and the
 * knockout pairing checked for having reset.
 *
 * Like the rest of tests/integration these run against the deployment in
 * NEXT_PUBLIC_CONVEX_URL and clean up after themselves.
 */

import { ConvexHttpClient } from "convex/browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { DEFAULT_SCORING, type ScoringConfig } from "../../src/lib/scoring";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set; cannot reach a deployment.");

const client = new ConvexHttpClient(url);
const PIN = "8140081461";

/** A comfortable two-set win for whichever side is named first. */
const WIN = [
  { a: 21, b: 10 },
  { a: 21, b: 10 },
];
const LOSS = [
  { a: 10, b: 21 },
  { a: 10, b: 21 },
];

let tournamentId: Id<"tournaments">;
let token: string;

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

const listMatches = (eventId: Id<"events">) =>
  client.query(api.matches.listByEvent, { eventId });

const listEntries = (eventId: Id<"events">) =>
  client.query(api.entries.listByEvent, { eventId });

const setScore = (matchId: Id<"matches">, sets: { a: number; b: number }[]) =>
  client.mutation(api.matches.setScore, { matchId, token, sets });

function createEvent(fields: {
  name: string;
  format: Doc<"events">["format"];
  thirdPlace?: boolean;
  groupCount?: number;
  advancePerGroup?: number;
  scoring?: ScoringConfig;
  semiFinalScoring?: ScoringConfig | null;
  finalScoring?: ScoringConfig | null;
}): Promise<Id<"events">> {
  return client.mutation(api.events.create, {
    tournamentId,
    token,
    name: fields.name,
    teamSize: 1,
    format: fields.format,
    scoring: fields.scoring ?? DEFAULT_SCORING,
    semiFinalScoring: fields.semiFinalScoring ?? null,
    finalScoring: fields.finalScoring ?? null,
    thirdPlace: fields.thirdPlace ?? false,
    groupCount: fields.groupCount ?? 2,
    advancePerGroup: fields.advancePerGroup ?? 2,
    doubleRound: false,
  });
}

/** "Player 01" … so the entrants are distinguishable in a failure message. */
function roster(count: number): string {
  return Array.from({ length: count }, (_, i) => `Player ${String(i + 1).padStart(2, "0")}`).join(
    "\n",
  );
}

/** Highest knockout round number plus one, ignoring the third-place playoff. */
function knockoutRounds(matches: Doc<"matches">[]): number {
  const rounds = matches.filter((m) => m.stage === "knockout" && !m.isThirdPlace);
  return rounds.length === 0 ? 0 : Math.max(...rounds.map((m) => m.round)) + 1;
}

const settled = (status: string) =>
  status === "completed" || status === "walkover" || status === "cancelled";

/**
 * Score every knockout match that is ready, over and over, until the bracket
 * runs out. Each pass re-reads the draw because a result opens the next round.
 */
async function playOutKnockout(eventId: Id<"events">): Promise<void> {
  for (let pass = 0; pass < 12; pass += 1) {
    const matches = await listMatches(eventId);
    const ready = matches.filter(
      (m) => m.stage === "knockout" && !settled(m.status) && m.aId !== null && m.bId !== null,
    );
    if (ready.length === 0) return;
    for (const match of ready) await setScore(match._id, WIN);
  }
  throw new Error("The knockout never finished; the progression is looping.");
}

beforeAll(async () => {
  const created = await client.mutation(api.tournaments.create, {
    name: `Scenario Run ${Date.now()}`,
    venue: "Ahmedabad",
    startDate: "2026-11-14",
    pin: PIN,
    isPublic: false,
  });
  tournamentId = created.tournamentId;
  token = created.token;
}, 60_000);

afterAll(async () => {
  if (tournamentId) await client.mutation(api.tournaments.remove, { tournamentId, token });
}, 60_000);

describe("scenario A: 20 entrants, seeded knockout with a third-place playoff", () => {
  let eventId: Id<"events">;
  let entryIds: Id<"entries">[];

  beforeAll(async () => {
    eventId = await createEvent({ name: "Open Singles", format: "knockout", thirdPlace: true });
    const added = await client.mutation(api.entries.addMany, {
      eventId,
      token,
      text: roster(20),
    });
    expect(added.added).toBe(20);

    const rows = await listEntries(eventId);
    entryIds = rows.map((r) => r._id);
    // Seeds 1-4, which is what pulls those four apart in the bracket.
    for (let i = 0; i < 4; i += 1) {
      await client.mutation(api.entries.update, { entryId: entryIds[i], token, seed: i + 1 });
    }
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
  }, 120_000);

  it("builds a 32 bracket and hands the 12 spare places out as byes", async () => {
    const matches = await listMatches(eventId);
    expect(knockoutRounds(matches)).toBe(5);
    expect(matches.filter((m) => m.round === 0 && !m.isThirdPlace)).toHaveLength(16);

    // 32 places, 20 entrants: 12 first-round matches are byes and resolve at once.
    const firstRound = matches.filter((m) => m.round === 0 && !m.isThirdPlace);
    const byes = firstRound.filter((m) => m.aLabel === "BYE" || m.bLabel === "BYE");
    expect(byes).toHaveLength(12);
    expect(byes.every((m) => m.status === "walkover")).toBe(true);
    // Every bye winner is already standing in the second round.
    expect(matches.filter((m) => m.round === 1 && m.aId !== null && m.bId !== null).length)
      .toBeGreaterThan(0);
  });

  it("keeps the top four seeds apart until the semi-finals", async () => {
    const matches = await listMatches(eventId);
    const seeded = new Set<string>(entryIds.slice(0, 4));
    const early = matches.filter(
      (m) => m.stage === "knockout" && m.round < 3 && m.aId && m.bId,
    );
    for (const match of early) {
      const both = seeded.has(match.aId as string) && seeded.has(match.bId as string);
      expect(both).toBe(false);
    }
  });

  it("plays every match through to a champion and a third place", async () => {
    await playOutKnockout(eventId);
    const matches = await listMatches(eventId);
    expect(matches.every((m) => settled(m.status))).toBe(true);

    const final = matches.find((m) => m.round === 4 && !m.isThirdPlace)!;
    expect(final.winnerId).not.toBeNull();
    const playoff = matches.find((m) => m.isThirdPlace)!;
    expect(playoff.status).toBe("completed");
    expect(playoff.winnerId).not.toBeNull();
  });

  it("clears the third-place result when a semi-final is corrected", async () => {
    const before = await listMatches(eventId);
    const semi = before.find((m) => m.round === 3 && !m.isThirdPlace)!;
    // The result is reversed, so a different player goes up and a different one down.
    await setScore(semi._id, LOSS);

    const after = await listMatches(eventId);
    const final = after.find((m) => m.round === 4 && !m.isThirdPlace)!;
    const side = semi.slot % 2 === 0 ? final.aId : final.bId;
    expect(side).toBe(semi.bId);
    expect(final.sets).toEqual([]);
    expect(final.winnerId).toBeNull();

    const playoff = after.find((m) => m.isThirdPlace)!;
    expect(playoff.sets).toEqual([]);
    expect(playoff.winnerId).toBeNull();
    expect(playoff.status).toBe("scheduled");
    // The beaten semi-finalist is the one now in the playoff.
    expect([playoff.aId, playoff.bId]).toContain(semi.aId);
  });

  it("awards the final when a semi-finalist withdraws", async () => {
    const before = await listMatches(eventId);
    const final = before.find((m) => m.round === 4 && !m.isThirdPlace)!;
    const quitter = final.aId as Id<"entries">;
    const survivor = final.bId as Id<"entries">;

    await client.mutation(api.entries.update, { entryId: quitter, token, withdrawn: true });

    const after = await listMatches(eventId);
    const decided = after.find((m) => m._id === final._id)!;
    expect(decided.status).toBe("walkover");
    expect(decided.winnerId).toBe(survivor);
    expect(decided.aId).toBeNull();
    expect(decided.aLabel).toBe("Withdrawn");

    const rows = await listEntries(eventId);
    expect(rows.find((r) => r._id === quitter)!.withdrawn).toBe(true);
  });

  it("refuses to delete an entrant once the draw exists", async () => {
    const message = await rejects(
      client.mutation(api.entries.remove, { entryId: entryIds[5], token }),
    );
    expect(message).toMatch(/withdraw/i);
  });

  it("refuses a duplicate seed", async () => {
    const message = await rejects(
      client.mutation(api.entries.update, { entryId: entryIds[9], token, seed: 2 }),
    );
    expect(message).toMatch(/seed/i);
  });

  it("locks the category rules while the draw stands", async () => {
    const message = await rejects(
      client.mutation(api.events.update, { eventId, token, format: "round_robin" }),
    );
    expect(message).toMatch(/draw/i);

    // Renaming is still fine — it changes nothing that was already played.
    await client.mutation(api.events.update, { eventId, token, name: "Open Singles A" });
    const events = await client.query(api.events.listByTournament, { tournamentId });
    expect(events.find((e) => e._id === eventId)!.name).toBe("Open Singles A");
  });

  it("builds an order of play that gives the byes no court", async () => {
    const result = await client.mutation(api.schedule.generate, {
      tournamentId,
      token,
      dayStart: "09:00",
      matchMinutes: 30,
      restMinutes: 30,
      courts: 4,
      categoriesAtOnce: 24,
    });
    expect(result.scheduled).toBeGreaterThan(0);
    expect(result.lastFinish).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    const matches = await listMatches(eventId);
    for (const match of matches) {
      if (match.status === "walkover" || match.status === "cancelled") {
        expect(match.scheduledAt).toBeUndefined();
        expect(match.court).toBeUndefined();
      }
    }
  });

  it("refuses a plain redraw once results exist, and allows a forced reset", async () => {
    const message = await rejects(
      client.mutation(api.draws.generate, { eventId, token, randomise: false }),
    );
    expect(message).toMatch(/result|played|reset/i);

    const outcome = await client.mutation(api.draws.generate, {
      eventId,
      token,
      randomise: false,
      force: true,
    });
    expect(outcome.matches).toBeGreaterThan(0);

    const matches = await listMatches(eventId);
    // Nothing carries a score across a forced redraw except the fresh byes.
    expect(matches.filter((m) => m.status === "completed")).toHaveLength(0);
  });

  afterAll(async () => {
    await client.mutation(api.schedule.clear, { tournamentId, token });
    await client.mutation(api.events.remove, { eventId, token, force: true });
  }, 60_000);
});

describe("scenario B: 16 entrants, four groups of four, top two qualify", () => {
  let eventId: Id<"events">;

  /** Score every match in one group so `order` finishes first, second, and so on. */
  async function scoreGroup(groupIndex: number, order: string[]): Promise<void> {
    const rank = (id: string | null) => (id === null ? 99 : order.indexOf(id));
    const matches = await listMatches(eventId);
    for (const match of matches) {
      if (match.stage !== "group" || match.groupIndex !== groupIndex) continue;
      await setScore(match._id, rank(match.aId) < rank(match.bId) ? WIN : LOSS);
    }
  }

  /** The entrants of one group, in the order the draw seated them. */
  async function groupIds(groupIndex: number): Promise<string[]> {
    const matches = await listMatches(eventId);
    const ids = matches
      .filter((m) => m.stage === "group" && m.groupIndex === groupIndex)
      .flatMap((m) => [m.aId, m.bId])
      .filter((id): id is Id<"entries"> => id !== null);
    return [...new Set<string>(ids)];
  }

  beforeAll(async () => {
    eventId = await createEvent({
      name: "Group Singles",
      format: "groups_knockout",
      groupCount: 4,
      advancePerGroup: 2,
    });
    const added = await client.mutation(api.entries.addMany, {
      eventId,
      token,
      text: roster(16),
    });
    expect(added.added).toBe(16);
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
  }, 120_000);

  it("draws four groups of six matches feeding an eight-place knockout", async () => {
    const matches = await listMatches(eventId);
    const groups = matches.filter((m) => m.stage === "group");
    // Four entrants play six matches between them, four times over.
    expect(groups).toHaveLength(24);
    expect(new Set(groups.map((m) => m.groupIndex)).size).toBe(4);
    expect(knockoutRounds(matches)).toBe(3);
    expect(matches.filter((m) => m.round === 0 && m.stage === "knockout")).toHaveLength(4);
  });

  it("leaves the knockout waiting on qualifier labels until the groups finish", async () => {
    const matches = await listMatches(eventId);
    const quarters = matches.filter((m) => m.stage === "knockout" && m.round === 0);
    expect(quarters.every((m) => m.aId === null && m.bId === null)).toBe(true);
    expect(quarters.flatMap((m) => [m.aLabel, m.bLabel])).toContain("1st in Group A");
  });

  it("fills the quarter-finals once every group table is final", async () => {
    for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
      await scoreGroup(groupIndex, await groupIds(groupIndex));
    }

    const matches = await listMatches(eventId);
    expect(matches.filter((m) => m.stage === "group").every((m) => settled(m.status))).toBe(true);

    const quarters = matches.filter((m) => m.stage === "knockout" && m.round === 0);
    expect(quarters.every((m) => m.aId !== null && m.bId !== null)).toBe(true);

    const firstInA = (await groupIds(0))[0];
    const slot = quarters.find((m) => m.aLabel === "1st in Group A" || m.bLabel === "1st in Group A")!;
    expect([slot.aId, slot.bId]).toContain(firstInA);
  });

  it("resets the knockout pairing when a group result is changed", async () => {
    await playOutKnockoutQuarters();

    const before = await listMatches(eventId);
    expect(before.filter((m) => m.stage === "knockout" && m.round === 0 && m.status === "completed"))
      .toHaveLength(4);

    // Turn group A upside down: the entrant who finished last now wins it.
    const ids = await groupIds(0);
    await scoreGroup(0, [...ids].reverse());

    const after = await listMatches(eventId);
    const slot = after.find(
      (m) => m.aLabel === "1st in Group A" || m.bLabel === "1st in Group A",
    )!;
    const filled = slot.aLabel === "1st in Group A" ? slot.aId : slot.bId;
    expect(filled).toBe(ids[ids.length - 1]);

    // The quarter-final that slot sits in cannot keep its old result.
    expect(slot.status).toBe("scheduled");
    expect(slot.sets).toEqual([]);
    expect(slot.winnerId).toBeNull();

    // Nor can the semi-final it fed.
    const semi = after.find(
      (m) => m.stage === "knockout" && m.round === 1 && m.slot === Math.floor(slot.slot / 2),
    )!;
    expect(semi.winnerId).toBeNull();
    const side = slot.slot % 2 === 0 ? semi.aId : semi.bId;
    expect(side).toBeNull();
  });

  /** Only the first knockout round, so the reset above has something to undo. */
  async function playOutKnockoutQuarters(): Promise<void> {
    const matches = await listMatches(eventId);
    for (const match of matches) {
      if (match.stage !== "knockout" || match.round !== 0) continue;
      if (settled(match.status)) continue;
      await setScore(match._id, WIN);
    }
  }

  afterAll(async () => {
    // The category has been played through, so the cleanup has to say so.
    await client.mutation(api.events.remove, { eventId, token, force: true });
  }, 60_000);
});

describe("late rounds played to their own rules", () => {
  let eventId: Id<"events">;

  const base: ScoringConfig = { pointsPerSet: 21, bestOf: 1, endMode: "deuce", cap: 30 };
  const semiRules: ScoringConfig = { pointsPerSet: 11, bestOf: 1, endMode: "golden", cap: null };
  const finalRules: ScoringConfig = { pointsPerSet: 15, bestOf: 1, endMode: "golden", cap: null };

  beforeAll(async () => {
    eventId = await createEvent({
      name: "Closing Rounds",
      format: "knockout",
      scoring: base,
      semiFinalScoring: semiRules,
      finalScoring: finalRules,
      thirdPlace: true,
    });
    await client.mutation(api.entries.addMany, { eventId, token, text: roster(4) });
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
  }, 120_000);

  it("holds the semi-finals to the semi-final rules", async () => {
    const matches = await listMatches(eventId);
    const semis = matches.filter((m) => m.round === 0 && !m.isThirdPlace);

    const message = await rejects(setScore(semis[0]._id, [{ a: 21, b: 15 }]));
    expect(message).toMatch(/11|point/i);

    for (const semi of semis) await setScore(semi._id, [{ a: 11, b: 9 }]);
    const after = await listMatches(eventId);
    expect(after.filter((m) => m.round === 0 && m.status === "completed")).toHaveLength(2);
  });

  it("holds the final and the playoff to the final rules", async () => {
    const matches = await listMatches(eventId);
    const final = matches.find((m) => m.round === 1 && !m.isThirdPlace)!;
    const playoff = matches.find((m) => m.isThirdPlace)!;

    // 11-9 wins a semi-final here but is only a game in progress in the final,
    // which is the whole point of the override.
    await setScore(final._id, [{ a: 11, b: 9 }]);
    const midway = await listMatches(eventId);
    expect(midway.find((m) => m._id === final._id)!.winnerId).toBeNull();
    expect(midway.find((m) => m._id === final._id)!.status).not.toBe("completed");

    const message = await rejects(setScore(final._id, [{ a: 21, b: 15 }]));
    expect(message).toMatch(/15|point/i);

    await setScore(final._id, [{ a: 15, b: 13 }]);
    await setScore(playoff._id, [{ a: 15, b: 13 }]);

    const after = await listMatches(eventId);
    expect(after.find((m) => m._id === final._id)!.status).toBe("completed");
    expect(after.find((m) => m._id === playoff._id)!.status).toBe("completed");
  });

  it("refuses a group configuration that cannot fill its knockout", async () => {
    const message = await rejects(
      createEvent({
        name: "Impossible Groups",
        format: "groups_knockout",
        groupCount: 4,
        advancePerGroup: 9,
      }).then((id) => client.mutation(api.draws.generate, { eventId: id, token, randomise: false })),
    );
    expect(message).toMatch(/group|entrant/i);
  });

  afterAll(async () => {
    // The category has been played through, so the cleanup has to say so.
    await client.mutation(api.events.remove, { eventId, token, force: true });
  }, 60_000);
});

describe("the guards that stand between an organiser and a lost result", () => {
  /** A four-entrant knockout with its draw already made. */
  async function drawnEvent(name: string): Promise<Id<"events">> {
    const eventId = await createEvent({ name, format: "knockout" });
    await client.mutation(api.entries.addMany, { eventId, token, text: roster(4) });
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });
    return eventId;
  }

  it("locks the seeds once the draw is made but leaves the rest of the entry editable", async () => {
    const eventId = await createEvent({ name: "Seed Lock", format: "knockout" });
    await client.mutation(api.entries.addMany, { eventId, token, text: roster(4) });

    // Before the draw the seed is just a number on a form.
    const [first] = await listEntries(eventId);
    await client.mutation(api.entries.update, { entryId: first._id, token, seed: 1 });
    expect((await listEntries(eventId)).find((e) => e._id === first._id)!.seed).toBe(1);

    await client.mutation(api.draws.generate, { eventId, token, randomise: false });

    // After it, the bracket is built from that number and does not rearrange.
    const message = await rejects(
      client.mutation(api.entries.update, { entryId: first._id, token, seed: 4 }),
    );
    expect(message).toMatch(/draw|seed/i);
    expect((await listEntries(eventId)).find((e) => e._id === first._id)!.seed).toBe(1);

    // Everything that does not move a placement still saves.
    await client.mutation(api.entries.update, {
      entryId: first._id,
      token,
      playerOne: "Renamed Player",
      club: "Ahmedabad SC, Gujarat",
    });
    const renamed = (await listEntries(eventId)).find((e) => e._id === first._id)!;
    expect(renamed.playerOne).toBe("Renamed Player");
    expect(renamed.club).toBe("Ahmedabad SC, Gujarat");

    await client.mutation(api.events.remove, { eventId, token });
  }, 120_000);

  it("will not turn a played result into a walkover until it has been reset", async () => {
    const eventId = await drawnEvent("Walkover Guard");
    const match = (await listMatches(eventId)).find((m) => m.aId !== null && m.bId !== null)!;

    await setScore(match._id, WIN);
    const played = (await listMatches(eventId)).find((m) => m._id === match._id)!;
    expect(played.status).toBe("completed");

    const message = await rejects(
      client.mutation(api.matches.setWalkover, {
        matchId: match._id,
        token,
        winnerId: played.bId,
      }),
    );
    expect(message).toMatch(/reset/i);
    expect((await listMatches(eventId)).find((m) => m._id === match._id)!.sets).toHaveLength(2);

    // Reset first, then the same walkover goes through.
    await client.mutation(api.matches.reset, { matchId: match._id, token });
    await client.mutation(api.matches.setWalkover, {
      matchId: match._id,
      token,
      winnerId: played.bId,
    });
    const awarded = (await listMatches(eventId)).find((m) => m._id === match._id)!;
    expect(awarded.status).toBe("walkover");
    expect(awarded.winnerId).toBe(played.bId);
    expect(awarded.sets).toEqual([]);

    await client.mutation(api.events.remove, { eventId, token, force: true });
  }, 120_000);

  it("refuses to delete a category holding results until the deletion is confirmed", async () => {
    // An empty category is ordinary housekeeping and goes without a fight.
    const empty = await createEvent({ name: "Empty Category", format: "knockout" });
    await client.mutation(api.events.remove, { eventId: empty, token });

    const eventId = await drawnEvent("Deletion Guard");
    const match = (await listMatches(eventId)).find((m) => m.aId !== null && m.bId !== null)!;
    await setScore(match._id, WIN);

    const message = await rejects(client.mutation(api.events.remove, { eventId, token }));
    expect(message).toMatch(/has results in it/);
    // The refusal is a transaction that rolled back: nothing was thrown away.
    expect(await listMatches(eventId)).not.toHaveLength(0);
    expect(await listEntries(eventId)).toHaveLength(4);

    await client.mutation(api.events.remove, { eventId, token, force: true });
    expect(await listMatches(eventId)).toHaveLength(0);
  }, 120_000);
});
