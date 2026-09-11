import { ConvexHttpClient } from "convex/browser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { DEFAULT_SCORING } from "../../src/lib/scoring";

/**
 * A player pulls out halfway through their group.
 *
 * This is the awkward case: they have already beaten somebody, so their results
 * are real and the players who beat them earned those wins. The policy is that
 * the history stays and the qualification place does not — a group place is for
 * an entrant who is still in the tournament and can actually play the knockout.
 *
 * The whole thing runs against a real Convex deployment, so it exercises the
 * withdrawal, the walkover resolution and the group-to-knockout fill together.
 */

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL must be set to run the integration tests.");

const client = new ConvexHttpClient(url);
const PIN = "8140081461";
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
let eventId: Id<"events">;

const listMatches = () => client.query(api.matches.listByEvent, { eventId });
const listEntries = () => client.query(api.entries.listByEvent, { eventId });

const setScore = (matchId: Id<"matches">, sets: { a: number; b: number }[]) =>
  client.mutation(api.matches.setScore, { matchId, token, sets });

/** The entrants of one group, in the order the draw seated them. */
async function groupIds(groupIndex: number): Promise<string[]> {
  const matches = await listMatches();
  return [
    ...new Set<string>(
      matches
        .filter((m) => m.stage === "group" && m.groupIndex === groupIndex)
        .flatMap((m) => [m.aId, m.bId])
        .filter((id): id is Id<"entries"> => id !== null),
    ),
  ];
}

const settled = (match: Doc<"matches">) =>
  match.status === "completed" || match.status === "walkover" || match.status === "cancelled";

beforeAll(async () => {
  const created = await client.mutation(api.tournaments.create, {
    name: `Withdrawal Run ${Date.now()}`,
    venue: "Ahmedabad",
    startDate: "2026-11-14",
    pin: PIN,
    isPublic: false,
  });
  tournamentId = created.tournamentId;
  token = created.token;

  eventId = await client.mutation(api.events.create, {
    tournamentId,
    token,
    name: "Group Singles",
    teamSize: 1,
    format: "groups_knockout",
    scoring: DEFAULT_SCORING,
    semiFinalScoring: null,
    finalScoring: null,
    thirdPlace: false,
    groupCount: 2,
    advancePerGroup: 2,
    doubleRound: false,
  });
  await client.mutation(api.entries.addMany, {
    eventId,
    token,
    text: Array.from({ length: 8 }, (_, i) => `Player ${String(i + 1).padStart(2, "0")}`).join("\n"),
  });
  await client.mutation(api.draws.generate, { eventId, token, randomise: false });
}, 120_000);

afterAll(async () => {
  await client.mutation(api.events.remove, { eventId, token, force: true });
  await client.mutation(api.tournaments.remove, { tournamentId, token });
}, 120_000);

describe("a group-stage withdrawal after two matches have been played", () => {
  /** The entrant who will play twice and then pull out. */
  let quitter: string;

  it("lets the entrant win two group matches before anything goes wrong", async () => {
    const [first] = await groupIds(0);
    quitter = first;

    const theirs = (await listMatches()).filter(
      (m) => m.stage === "group" && m.groupIndex === 0 && (m.aId === quitter || m.bId === quitter),
    );
    // A group of four means three matches each; two of them get played.
    expect(theirs).toHaveLength(3);
    for (const match of theirs.slice(0, 2)) {
      await setScore(match._id, match.aId === quitter ? WIN : LOSS);
    }

    const played = (await listMatches()).filter(
      (m) => (m.aId === quitter || m.bId === quitter) && m.status === "completed",
    );
    expect(played).toHaveLength(2);
    expect(played.every((m) => m.winnerId === quitter)).toBe(true);
  }, 120_000);

  it("turns their unplayed match into a walkover the moment they withdraw", async () => {
    const before = (await listMatches()).find(
      (m) =>
        m.stage === "group" &&
        m.groupIndex === 0 &&
        (m.aId === quitter || m.bId === quitter) &&
        m.status === "scheduled",
    )!;
    const opponent = before.aId === quitter ? before.bId : before.aId;

    await client.mutation(api.entries.update, {
      entryId: quitter as Id<"entries">,
      token,
      withdrawn: true,
    });

    const after = (await listMatches()).find((m) => m._id === before._id)!;
    expect(after.status).toBe("walkover");
    expect(after.winnerId).toBe(opponent);
  }, 120_000);

  it("keeps the two matches they played, so the wins they earned still stand", async () => {
    const played = (await listMatches()).filter(
      (m) => m.status === "completed" && (m.aId === quitter || m.bId === quitter),
    );
    expect(played).toHaveLength(2);
    expect(played.every((m) => m.winnerId === quitter)).toBe(true);
    expect(played.every((m) => m.sets.length === 2)).toBe(true);
    // And the entrant is still on the list, marked withdrawn rather than erased.
    const entry = (await listEntries()).find((e) => e._id === quitter)!;
    expect(entry.withdrawn).toBe(true);
  }, 120_000);

  it("fills the knockout from the entrants who are still in the tournament", async () => {
    // Finish every group match that is still outstanding. Whoever is named
    // first on the card wins, which is arbitrary and therefore a fair test.
    for (const match of await listMatches()) {
      if (match.stage !== "group" || settled(match)) continue;
      await setScore(match._id, WIN);
    }

    const matches = await listMatches();
    expect(matches.filter((m) => m.stage === "group").every(settled)).toBe(true);

    const knockout = matches.filter((m) => m.stage === "knockout" && m.round === 0);
    expect(knockout).toHaveLength(2);
    expect(knockout.every((m) => m.aId !== null && m.bId !== null)).toBe(true);

    // The whole point: a withdrawn entrant with two wins still cannot qualify.
    const qualified = knockout.flatMap((m) => [m.aId, m.bId]);
    expect(qualified).not.toContain(quitter);
    expect(new Set(qualified).size).toBe(4);

    const stillIn = new Set((await listEntries()).filter((e) => !e.withdrawn).map((e) => e._id));
    for (const id of qualified) {
      expect(stillIn.has(id as Id<"entries">)).toBe(true);
    }

    // Two of the four places belong to group A, and both went to entrants who
    // were in group A and can play.
    const groupA = new Set(await groupIds(0));
    expect(qualified.filter((id) => groupA.has(id as string))).toHaveLength(2);
  }, 180_000);
});

describe("a group withdrawal from every finishing position", () => {
  /**
   * The demotion in `fillKnockoutFromGroups` sorts a withdrawn entrant to the
   * bottom of their group's table no matter how many matches they had already
   * won. That rule only has one interesting way to go wrong: getting the
   * *cutoff* wrong. So this runs the same group of four to a clean, unambiguous
   * table — a transitive 3-0/2-1/1-2/0-3 result with no tie to break — once for
   * each place the withdrawing entrant could have finished in.
   *
   * Whichever seat withdraws, the four players who did not pull out keep the
   * same order among themselves (lower index beats higher index, always), so
   * the two who qualify once the withdrawal is applied are always the two
   * strongest survivors. What changes case to case is only whether getting
   * there required promoting somebody (1st and 2nd both held a qualifying
   * place before they withdrew) or changed nothing at all (3rd and 4th never
   * held one to begin with).
   */
  async function runQualificationPositionCase(quitterIndex: number, beatsCount: number) {
    const created = await client.mutation(api.tournaments.create, {
      name: `Qualification Position ${quitterIndex} ${Date.now()}`,
      venue: "Ahmedabad",
      startDate: "2026-11-14",
      pin: PIN,
      isPublic: false,
    });
    const tournamentId = created.tournamentId;
    const token = created.token;

    const eventId = await client.mutation(api.events.create, {
      tournamentId,
      token,
      name: "Group Singles",
      teamSize: 1,
      format: "groups_knockout",
      scoring: DEFAULT_SCORING,
      thirdPlace: false,
      groupCount: 1,
      advancePerGroup: 2,
      doubleRound: false,
    });
    await client.mutation(api.entries.addMany, {
      eventId,
      token,
      text: ["Player 0", "Player 1", "Player 2", "Player 3"].join("\n"),
    });
    await client.mutation(api.draws.generate, { eventId, token, randomise: false });

    const entries = await client.query(api.entries.listByEvent, { eventId });
    const idOf = (i: number) => entries.find((e) => e.playerOne === `Player ${i}`)!._id;

    const opponents = [0, 1, 2, 3].filter((i) => i !== quitterIndex);
    // The weakest `beatsCount` opponents are the ones the quitter beats, so
    // the survivors keep their relative order regardless of how the withdrawing
    // entrant's own results are set.
    const beatenByQuitter = new Set(opponents.slice(opponents.length - beatsCount));

    /** Lower index always beats higher index, except where the quitter is involved. */
    function winnerOf(i: number, j: number): number {
      const [lo, hi] = i < j ? [i, j] : [j, i];
      if (lo === quitterIndex) return beatenByQuitter.has(hi) ? lo : hi;
      if (hi === quitterIndex) return beatenByQuitter.has(lo) ? hi : lo;
      return lo;
    }

    async function play(i: number, j: number) {
      const matches = await client.query(api.matches.listByEvent, { eventId });
      const match = matches.find(
        (m) =>
          m.stage === "group" &&
          ((m.aId === idOf(i) && m.bId === idOf(j)) || (m.aId === idOf(j) && m.bId === idOf(i))),
      )!;
      const winner = winnerOf(i, j);
      await client.mutation(api.matches.setScore, {
        matchId: match._id,
        token,
        sets: match.aId === idOf(winner) ? WIN : LOSS,
      });
    }

    // The quitter's own three matches are played out first, fixing the
    // finishing position they would have held.
    for (const opponent of opponents) await play(quitterIndex, opponent);

    await client.mutation(api.entries.update, {
      entryId: idOf(quitterIndex),
      token,
      withdrawn: true,
    });

    // Then the matches among the three survivors settle the rest of the
    // table — the last of these is what triggers the knockout to fill.
    const [a, b, c] = opponents;
    await play(a, b);
    await play(a, c);
    await play(b, c);

    const matches = await client.query(api.matches.listByEvent, { eventId });
    expect(matches.filter((m) => m.stage === "group").every(settled)).toBe(true);

    const final = matches.find((m) => m.stage === "knockout" && m.round === 0)!;
    expect(final.aId).not.toBeNull();
    expect(final.bId).not.toBeNull();

    // Whoever withdrew, the two strongest survivors take the two places.
    const [expectedFirst, expectedSecond] = opponents; // already ascending = strongest first
    const qualified = new Set([final.aId, final.bId]);
    expect(qualified).toEqual(new Set([idOf(expectedFirst), idOf(expectedSecond)]));
    expect(qualified.has(idOf(quitterIndex))).toBe(false);

    const quitterEntry = (await client.query(api.entries.listByEvent, { eventId })).find(
      (e) => e._id === idOf(quitterIndex),
    )!;
    expect(quitterEntry.withdrawn).toBe(true);

    await client.mutation(api.events.remove, { eventId, token, force: true });
    await client.mutation(api.tournaments.remove, { tournamentId, token });
  }

  it("promotes the third-placed entrant when the group's leader withdraws", async () => {
    await runQualificationPositionCase(0, 3);
  }, 120_000);

  it("promotes the third-placed entrant when the runner-up withdraws, right at the cutoff", async () => {
    await runQualificationPositionCase(1, 2);
  }, 120_000);

  it("changes nothing when a third-placed entrant withdraws — they held no qualifying place", async () => {
    await runQualificationPositionCase(2, 1);
  }, 120_000);

  it("changes nothing when the last-placed entrant withdraws", async () => {
    await runQualificationPositionCase(3, 0);
  }, 120_000);
});
