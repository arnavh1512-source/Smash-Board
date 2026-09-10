/**
 * Round-robin standings, ordered by the BWF tiebreak sequence.
 *
 * Order of comparison:
 *  1. matches won
 *  2. matches won minus lost (protects against unequal games played)
 *  3. sets won minus sets lost
 *  4. points scored minus points conceded
 *  5. head-to-head result between the tied entrants
 *  6. entrant name, so the order is at least stable and predictable
 */

import { evaluateMatch, type ScoringConfig, type SetScore } from "./scoring";

export interface StandingsMatch {
  aId: string | null;
  bId: string | null;
  sets: SetScore[];
  status: string;
  /** Set when the match was awarded without play. */
  walkoverWinnerId?: string | null;
}

export interface StandingRow {
  entryId: string;
  played: number;
  won: number;
  lost: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Position after sorting, 1-based. */
  rank: number;
}

function blank(entryId: string): StandingRow {
  return {
    entryId,
    played: 0,
    won: 0,
    lost: 0,
    setsWon: 0,
    setsLost: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    rank: 0,
  };
}

/**
 * Build the table for one group.
 * `nameOf` is only used for the final alphabetical tiebreak.
 */
export function computeStandings(
  entryIds: string[],
  matches: StandingsMatch[],
  config: ScoringConfig,
  nameOf: (entryId: string) => string,
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const id of entryIds) rows.set(id, blank(id));

  // head-to-head: winner id -> set of ids it has beaten
  const beat = new Map<string, Set<string>>();

  for (const match of matches) {
    if (match.status !== "completed" && match.status !== "walkover") continue;
    const { aId, bId } = match;
    if (!aId || !bId) continue;
    const a = rows.get(aId);
    const b = rows.get(bId);
    if (!a || !b) continue;

    a.played += 1;
    b.played += 1;

    if (match.status === "walkover") {
      const winnerId = match.walkoverWinnerId ?? null;
      if (winnerId === aId) {
        a.won += 1;
        b.lost += 1;
      } else if (winnerId === bId) {
        b.won += 1;
        a.lost += 1;
      }
      if (winnerId) {
        const loserId = winnerId === aId ? bId : aId;
        if (!beat.has(winnerId)) beat.set(winnerId, new Set());
        beat.get(winnerId)!.add(loserId);
      }
      continue;
    }

    let outcome;
    try {
      outcome = evaluateMatch(match.sets, config);
    } catch {
      // A stored score that no longer fits the current config is skipped rather
      // than crashing the whole table; the organiser sees it flagged in the UI.
      continue;
    }

    a.setsWon += outcome.setsWon.a;
    a.setsLost += outcome.setsWon.b;
    b.setsWon += outcome.setsWon.b;
    b.setsLost += outcome.setsWon.a;
    a.pointsFor += outcome.points.a;
    a.pointsAgainst += outcome.points.b;
    b.pointsFor += outcome.points.b;
    b.pointsAgainst += outcome.points.a;

    if (outcome.winner === "a") {
      a.won += 1;
      b.lost += 1;
      if (!beat.has(aId)) beat.set(aId, new Set());
      beat.get(aId)!.add(bId);
    } else if (outcome.winner === "b") {
      b.won += 1;
      a.lost += 1;
      if (!beat.has(bId)) beat.set(bId, new Set());
      beat.get(bId)!.add(aId);
    }
  }

  const table = [...rows.values()].sort((x, y) => {
    if (y.won !== x.won) return y.won - x.won;
    const xDiff = x.won - x.lost;
    const yDiff = y.won - y.lost;
    if (yDiff !== xDiff) return yDiff - xDiff;
    const xSets = x.setsWon - x.setsLost;
    const ySets = y.setsWon - y.setsLost;
    if (ySets !== xSets) return ySets - xSets;
    const xPts = x.pointsFor - x.pointsAgainst;
    const yPts = y.pointsFor - y.pointsAgainst;
    if (yPts !== xPts) return yPts - xPts;
    if (beat.get(x.entryId)?.has(y.entryId)) return -1;
    if (beat.get(y.entryId)?.has(x.entryId)) return 1;
    return nameOf(x.entryId).localeCompare(nameOf(y.entryId));
  });

  return table.map((row, index) => ({ ...row, rank: index + 1 }));
}
