// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import {
  WITHDRAWN_LABEL,
  advanceKnockout,
  applyWithdrawal,
  clearGroupQualifiers,
  fillKnockoutFromGroups,
  resolveWalkovers,
  scoringForMatch,
  totalKnockoutRounds,
  winnerFromSets,
} from "../convex/lib/progression";
import { DEFAULT_SCORING } from "../src/lib/scoring";

/**
 * How winners move through a draw, run against an in-memory Convex database.
 *
 * The integration suite drives the same code through the public mutations on a
 * real deployment; this one calls the helpers directly so each rule (a bye, a
 * withdrawal, an edited result rippling forward) can be pinned down alone.
 */

const modules = import.meta.glob("../convex/**/*.*s");

const WIN = [
  { a: 21, b: 10 },
  { a: 21, b: 12 },
];
const LOSS = [
  { a: 10, b: 21 },
  { a: 12, b: 21 },
];

type Side = { id?: Id<"entries"> | null; label?: string | null };
type MatchSpec = {
  stage?: "group" | "knockout";
  groupIndex?: number | null;
  round: number;
  slot: number;
  a: Side;
  b: Side;
  isThirdPlace?: boolean;
  status?: Doc<"matches">["status"];
  sets?: { a: number; b: number }[];
};

/** Run a test body against a fresh database. */
function withDb(body: (ctx: MutationCtx) => Promise<void>) {
  return () => convexTest(schema, modules).run((ctx) => body(ctx as unknown as MutationCtx));
}

async function seed(ctx: MutationCtx, players: number, event: Partial<Doc<"events">> = {}) {
  const now = Date.now();
  const tournamentId = await ctx.db.insert("tournaments", {
    name: "Club Open",
    slug: "club-open",
    pinHash: "hash",
    pinSalt: "salt",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  });
  const eventId = await ctx.db.insert("events", {
    tournamentId,
    name: "Singles",
    teamSize: 1,
    format: "knockout",
    scoring: DEFAULT_SCORING,
    thirdPlace: true,
    groupCount: 0,
    advancePerGroup: 0,
    doubleRound: false,
    drawGeneratedAt: now,
    order: 0,
    createdAt: now,
    ...event,
  });
  const entries: Id<"entries">[] = [];
  for (let i = 1; i <= players; i++) {
    entries.push(
      await ctx.db.insert("entries", {
        tournamentId,
        eventId,
        playerOne: `Player ${i}`,
        seed: 0,
        withdrawn: false,
        createdAt: now,
      }),
    );
  }
  const addMatch = (spec: MatchSpec) =>
    ctx.db.insert("matches", {
      tournamentId,
      eventId,
      stage: spec.stage ?? "knockout",
      groupIndex: spec.groupIndex ?? null,
      round: spec.round,
      slot: spec.slot,
      aId: spec.a.id ?? null,
      bId: spec.b.id ?? null,
      aLabel: spec.a.label ?? null,
      bLabel: spec.b.label ?? null,
      sets: spec.sets ?? [],
      status: spec.status ?? "scheduled",
      winnerId: null,
      isThirdPlace: spec.isThirdPlace ?? false,
      updatedAt: now,
    });
  return { eventId, entries, addMatch };
}

/** Semi-finals, a final and a bronze match between four players. */
async function fourPlayerDraw(ctx: MutationCtx, event: Partial<Doc<"events">> = {}) {
  const base = await seed(ctx, 4, event);
  const [p1, p2, p3, p4] = base.entries;
  const sf1 = await base.addMatch({ round: 0, slot: 0, a: { id: p1 }, b: { id: p2 } });
  const sf2 = await base.addMatch({ round: 0, slot: 1, a: { id: p3 }, b: { id: p4 } });
  const final = await base.addMatch({
    round: 1,
    slot: 0,
    a: { label: "Winner of Semi-final 1" },
    b: { label: "Winner of Semi-final 2" },
  });
  const bronze = await base.addMatch({
    round: 1,
    slot: 0,
    isThirdPlace: true,
    a: { label: "Loser of Semi-final 1" },
    b: { label: "Loser of Semi-final 2" },
  });
  return { ...base, sf1, sf2, final, bronze };
}

const get = async (ctx: MutationCtx, id: Id<"matches">) => (await ctx.db.get(id))!;

/** Record a result the way the score mutation does, then move the winner on. */
async function decide(ctx: MutationCtx, matchId: Id<"matches">, winnerId: Id<"entries">) {
  await ctx.db.patch(matchId, { sets: WIN, status: "completed", winnerId });
  await advanceKnockout(ctx, await get(ctx, matchId), winnerId);
}

describe("advanceKnockout", () => {
  it(
    "sends the winner to the final and the loser to the bronze match",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [p1, p2] = d.entries;
      await decide(ctx, d.sf1, p1);

      const final = await get(ctx, d.final);
      expect(final.aId).toBe(p1);
      expect(final.aLabel).toBeNull();
      const bronze = await get(ctx, d.bronze);
      expect(bronze.aId).toBe(p2);
      expect(bronze.aLabel).toBeNull();
    }),
  );

  it(
    "fills side B from the second semi-final",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [, , p3, p4] = d.entries;
      await decide(ctx, d.sf2, p4);
      expect((await get(ctx, d.final)).bId).toBe(p4);
      expect((await get(ctx, d.bronze)).bId).toBe(p3);
    }),
  );

  it(
    "voids later results when an earlier one is edited to a different winner",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [p1, p2, , p4] = d.entries;
      await decide(ctx, d.sf1, p1);
      await decide(ctx, d.sf2, p4);
      await ctx.db.patch(d.final, { sets: WIN, status: "completed", winnerId: p1 });
      await ctx.db.patch(d.bronze, { sets: WIN, status: "completed", winnerId: p2 });

      // The umpire entered semi-final 1 the wrong way round.
      await decide(ctx, d.sf1, p2);

      const final = await get(ctx, d.final);
      expect(final.aId).toBe(p2);
      expect(final.sets).toEqual([]);
      expect(final.winnerId).toBeNull();
      expect(final.status).toBe("scheduled");
      const bronze = await get(ctx, d.bronze);
      expect(bronze.aId).toBe(p1);
      expect(bronze.sets).toEqual([]);
      expect(bronze.winnerId).toBeNull();
    }),
  );

  it(
    "keeps a later result when the same winner is re-entered",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [p1, , , p4] = d.entries;
      await decide(ctx, d.sf1, p1);
      await decide(ctx, d.sf2, p4);
      await ctx.db.patch(d.final, { sets: WIN, status: "completed", winnerId: p1 });

      await decide(ctx, d.sf1, p1);
      expect((await get(ctx, d.final)).winnerId).toBe(p1);
    }),
  );

  it(
    "puts the placeholder back when a winner is taken away",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      await decide(ctx, d.sf1, d.entries[0]);
      await advanceKnockout(ctx, await get(ctx, d.sf1), null);

      const final = await get(ctx, d.final);
      expect(final.aId).toBeNull();
      expect(final.aLabel).toBe("Winner of Semi-final 1");
      expect((await get(ctx, d.bronze)).aLabel).toBe("Loser of Semi-final 1");
    }),
  );

  it(
    "leaves the draw alone for a bronze match or a group game",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [p1, p2] = d.entries;
      await ctx.db.patch(d.bronze, { aId: p1, bId: p2 });
      await advanceKnockout(ctx, await get(ctx, d.bronze), p1);

      const group = await d.addMatch({
        stage: "group",
        groupIndex: 0,
        round: 0,
        slot: 0,
        a: { id: p1 },
        b: { id: p2 },
      });
      await advanceKnockout(ctx, await get(ctx, group), p1);
      expect((await get(ctx, d.final)).aId).toBeNull();
    }),
  );
});

describe("resolveWalkovers", () => {
  it(
    "gives a bye to the entrant on the other side and moves them on",
    withDb(async (ctx) => {
      const base = await seed(ctx, 3, { thirdPlace: false });
      const [p1, p2, p3] = base.entries;
      const bye = await base.addMatch({ round: 0, slot: 0, a: { id: p1 }, b: { label: "BYE" } });
      await base.addMatch({ round: 0, slot: 1, a: { id: p2 }, b: { id: p3 } });
      const final = await base.addMatch({ round: 1, slot: 0, a: {}, b: {} });

      await resolveWalkovers(ctx, base.eventId);

      const resolved = await get(ctx, bye);
      expect(resolved.status).toBe("walkover");
      expect(resolved.winnerId).toBe(p1);
      expect((await get(ctx, final)).aId).toBe(p1);
    }),
  );

  it(
    "does not treat a slot still waiting for a winner as empty",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      await resolveWalkovers(ctx, d.eventId);
      const final = await get(ctx, d.final);
      expect(final.status).toBe("scheduled");
      expect(final.winnerId).toBeNull();
    }),
  );

  it(
    "waits for the other side before awarding a walkover",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      await ctx.db.patch(d.final, { bLabel: WITHDRAWN_LABEL });
      await resolveWalkovers(ctx, d.eventId);
      expect((await get(ctx, d.final)).status).toBe("scheduled");
    }),
  );

  it(
    "cancels a match with nobody on either side and carries the vacancy on",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [p1, p2] = d.entries;
      await ctx.db.patch(d.sf2, {
        aId: null,
        bId: null,
        aLabel: WITHDRAWN_LABEL,
        bLabel: WITHDRAWN_LABEL,
      });
      await decide(ctx, d.sf1, p1);

      await resolveWalkovers(ctx, d.eventId);

      expect((await get(ctx, d.sf2)).status).toBe("cancelled");
      const final = await get(ctx, d.final);
      expect(final.bLabel).toBe(WITHDRAWN_LABEL);
      expect(final.status).toBe("walkover");
      expect(final.winnerId).toBe(p1);
      const bronze = await get(ctx, d.bronze);
      expect(bronze.bLabel).toBe(WITHDRAWN_LABEL);
      expect(bronze.status).toBe("walkover");
      expect(bronze.winnerId).toBe(p2);
    }),
  );

  it(
    "never rewrites a match that already has a score",
    withDb(async (ctx) => {
      const base = await seed(ctx, 2, { thirdPlace: false });
      const played = await base.addMatch({
        round: 0,
        slot: 0,
        a: { id: base.entries[0] },
        b: { label: WITHDRAWN_LABEL },
        sets: [{ a: 21, b: 3 }],
      });
      await resolveWalkovers(ctx, base.eventId);
      expect((await get(ctx, played)).status).toBe("scheduled");
    }),
  );
});

describe("applyWithdrawal", () => {
  it(
    "hands the opponent a walkover and keeps results already played",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [p1, p2, p3, p4] = d.entries;
      await decide(ctx, d.sf1, p1);

      await ctx.db.patch(p4, { withdrawn: true });
      await applyWithdrawal(ctx, (await ctx.db.get(p4))!);

      const sf2 = await get(ctx, d.sf2);
      expect(sf2.bId).toBeNull();
      expect(sf2.bLabel).toBe(WITHDRAWN_LABEL);
      expect(sf2.status).toBe("walkover");
      expect(sf2.winnerId).toBe(p3);
      expect((await get(ctx, d.final)).bId).toBe(p3);

      const sf1 = await get(ctx, d.sf1);
      expect(sf1.status).toBe("completed");
      expect(sf1.winnerId).toBe(p1);
      expect((await get(ctx, d.bronze)).aId).toBe(p2);
    }),
  );

  it(
    "clears a live score the withdrawn entrant was part of",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [p1, p2] = d.entries;
      await ctx.db.patch(d.sf1, { status: "live", sets: [{ a: 11, b: 9 }] });

      await applyWithdrawal(ctx, (await ctx.db.get(p2))!);

      const sf1 = await get(ctx, d.sf1);
      expect(sf1.sets).toEqual([]);
      expect(sf1.status).toBe("walkover");
      expect(sf1.winnerId).toBe(p1);
    }),
  );

  it(
    "takes a withdrawn finalist out of the final",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const [p1, , , p4] = d.entries;
      await decide(ctx, d.sf1, p1);
      await decide(ctx, d.sf2, p4);

      await applyWithdrawal(ctx, (await ctx.db.get(p1))!);

      const final = await get(ctx, d.final);
      expect(final.aId).toBeNull();
      expect(final.aLabel).toBe(WITHDRAWN_LABEL);
      expect(final.status).toBe("walkover");
      expect(final.winnerId).toBe(p4);
    }),
  );
});

describe("scoringForMatch", () => {
  const SHORT = { ...DEFAULT_SCORING, bestOf: 1 };
  const LONG = { ...DEFAULT_SCORING, bestOf: 5 };

  it(
    "uses the category's rules when there are no overrides",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx, { scoring: SHORT });
      const event = (await ctx.db.get(d.eventId))!;
      expect(await scoringForMatch(ctx, event, await get(ctx, d.final))).toEqual(SHORT);
    }),
  );

  it(
    "uses the final's rules for the final and bronze, the semi-final's for the semis",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx, {
        scoring: SHORT,
        semiFinalScoring: DEFAULT_SCORING,
        finalScoring: LONG,
      });
      const event = (await ctx.db.get(d.eventId))!;
      expect(await scoringForMatch(ctx, event, await get(ctx, d.final))).toEqual(LONG);
      expect(await scoringForMatch(ctx, event, await get(ctx, d.bronze))).toEqual(LONG);
      expect(await scoringForMatch(ctx, event, await get(ctx, d.sf1))).toEqual(DEFAULT_SCORING);
    }),
  );

  it(
    "never applies knockout overrides to a group game",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx, { scoring: SHORT, finalScoring: LONG });
      const event = (await ctx.db.get(d.eventId))!;
      const rules = await scoringForMatch(ctx, event, {
        stage: "group",
        round: 1,
        isThirdPlace: false,
      });
      expect(rules).toEqual(SHORT);
    }),
  );
});

describe("group qualifiers", () => {
  /** Two groups of two whose winners meet in a final. */
  async function groupsDraw(ctx: MutationCtx) {
    const base = await seed(ctx, 4, {
      format: "groups_knockout",
      groupCount: 2,
      advancePerGroup: 1,
      thirdPlace: false,
    });
    const [p1, p2, p3, p4] = base.entries;
    const groupA = await base.addMatch({
      stage: "group",
      groupIndex: 0,
      round: 0,
      slot: 0,
      a: { id: p1 },
      b: { id: p2 },
    });
    const groupB = await base.addMatch({
      stage: "group",
      groupIndex: 1,
      round: 0,
      slot: 0,
      a: { id: p3 },
      b: { id: p4 },
    });
    const final = await base.addMatch({
      round: 0,
      slot: 0,
      a: { label: "1st in Group A" },
      b: { label: "1st in Group B" },
    });
    const event = (await ctx.db.get(base.eventId))!;
    return { ...base, event, groupA, groupB, final };
  }

  /** Player 1 wins group A, player 4 wins group B. */
  async function finishGroups(ctx: MutationCtx, g: Awaited<ReturnType<typeof groupsDraw>>) {
    const [p1, , , p4] = g.entries;
    await ctx.db.patch(g.groupA, { sets: WIN, status: "completed", winnerId: p1 });
    await ctx.db.patch(g.groupB, { sets: LOSS, status: "completed", winnerId: p4 });
  }

  it(
    "waits until every group game is finished",
    withDb(async (ctx) => {
      const g = await groupsDraw(ctx);
      await ctx.db.patch(g.groupA, { sets: WIN, status: "completed", winnerId: g.entries[0] });
      expect(await fillKnockoutFromGroups(ctx, g.event)).toBe(false);
      expect((await get(ctx, g.final)).aId).toBeNull();
    }),
  );

  it(
    "seeds each group winner into the slot labelled for them",
    withDb(async (ctx) => {
      const g = await groupsDraw(ctx);
      const [p1, , , p4] = g.entries;
      await finishGroups(ctx, g);

      expect(await fillKnockoutFromGroups(ctx, g.event)).toBe(true);
      const final = await get(ctx, g.final);
      expect(final.aId).toBe(p1);
      expect(final.bId).toBe(p4);
    }),
  );

  it(
    "drops a withdrawn group winner below everyone still in",
    withDb(async (ctx) => {
      const g = await groupsDraw(ctx);
      const [p1, p2] = g.entries;
      await finishGroups(ctx, g);
      await ctx.db.patch(p1, { withdrawn: true });

      await fillKnockoutFromGroups(ctx, g.event);
      expect((await get(ctx, g.final)).aId).toBe(p2);
    }),
  );

  it(
    "gives a walkover when a whole group has withdrawn",
    withDb(async (ctx) => {
      const g = await groupsDraw(ctx);
      const [p1, p2, , p4] = g.entries;
      await finishGroups(ctx, g);
      await ctx.db.patch(p1, { withdrawn: true });
      await ctx.db.patch(p2, { withdrawn: true });

      await fillKnockoutFromGroups(ctx, g.event);
      const final = await get(ctx, g.final);
      expect(final.aLabel).toBe(WITHDRAWN_LABEL);
      expect(final.status).toBe("walkover");
      expect(final.winnerId).toBe(p4);
    }),
  );

  it(
    "re-seeds and voids the knockout result when a group result is edited",
    withDb(async (ctx) => {
      const g = await groupsDraw(ctx);
      const [p1, p2] = g.entries;
      await finishGroups(ctx, g);
      await fillKnockoutFromGroups(ctx, g.event);
      await ctx.db.patch(g.final, { sets: WIN, status: "completed", winnerId: p1 });

      await ctx.db.patch(g.groupA, { sets: LOSS, winnerId: p2 });
      await clearGroupQualifiers(ctx, g.event);
      const cleared = await get(ctx, g.final);
      expect(cleared.aId).toBeNull();
      expect(cleared.bId).toBeNull();
      expect(cleared.sets).toEqual([]);
      expect(cleared.winnerId).toBeNull();
      expect(cleared.status).toBe("scheduled");

      await fillKnockoutFromGroups(ctx, g.event);
      expect((await get(ctx, g.final)).aId).toBe(p2);
    }),
  );

  it(
    "does nothing for a category with no groups",
    withDb(async (ctx) => {
      const d = await fourPlayerDraw(ctx);
      const event = (await ctx.db.get(d.eventId))!;
      expect(await fillKnockoutFromGroups(ctx, event)).toBe(false);
    }),
  );
});

describe("pure helpers", () => {
  it("winnerFromSets names the entrant who took the match", () => {
    const match = { aId: "a" as Id<"entries">, bId: "b" as Id<"entries">, sets: WIN };
    expect(winnerFromSets(match, DEFAULT_SCORING)).toBe("a");
    expect(winnerFromSets({ ...match, sets: LOSS }, DEFAULT_SCORING)).toBe("b");
    expect(winnerFromSets({ ...match, sets: [{ a: 21, b: 5 }] }, DEFAULT_SCORING)).toBeNull();
  });

  it("totalKnockoutRounds ignores the bronze match and group games", () => {
    const m = (round: number, stage: "group" | "knockout" = "knockout", isThirdPlace = false) =>
      ({ round, stage, isThirdPlace }) as Doc<"matches">;
    expect(totalKnockoutRounds([m(0), m(0), m(1), m(1, "knockout", true), m(4, "group")])).toBe(2);
    expect(totalKnockoutRounds([])).toBe(0);
  });
});
