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
