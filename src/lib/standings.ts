/**
 * Round-robin standings, ordered by the BWF tiebreak sequence.
 *
 * Order of comparison:
 *  1. matches won
 *  2. matches won minus lost (protects against unequal games played)
 *  3. sets won minus sets lost
 *  4. points scored minus points conceded
 *  5. the same four keys again, recomputed over only the matches the tied
 *     entrants played against each other
 *  6. entrant name, so the order is at least stable and predictable
 *
 * Step 5 is what makes a three-way tie come out right. A pairwise head-to-head
 * check inside a flat comparator cannot order A, B and C when A beat B, B beat C
 * and C beat A: the comparator is not transitive and the result depends on the
 * order the sort happens to visit them in. Building a mini-table across just the
 * tied entrants, then recursing into whatever is still level inside it, is the
 * BWF procedure and is well defined however the cycle falls.
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
 * Tally the entrants in `entryIds` over the matches they played among
 * themselves. Matches involving anyone outside the set are ignored, which is
 * what lets the same function build both the full group table and the mini
 * table used to break a tie.
 */
function accumulate(
  entryIds: string[],
  matches: StandingsMatch[],
  config: ScoringConfig,
): Map<string, StandingRow> {
  const rows = new Map<string, StandingRow>();
  for (const id of entryIds) rows.set(id, blank(id));

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
    } else if (outcome.winner === "b") {
      b.won += 1;
      a.lost += 1;
    }
  }

  return rows;
}

/** The four ranking keys, in order. Zero means the two rows are level. */
function compareRows(x: StandingRow, y: StandingRow): number {
  return (
    y.won - x.won ||
    y.won - y.lost - (x.won - x.lost) ||
    y.setsWon - y.setsLost - (x.setsWon - x.setsLost) ||
    y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst)
  );
}

/**
 * Order one set of entrants, recursing into whatever is still tied.
 *
 * Each call tallies only the matches played inside `ids`, so the recursion
 * narrows the evidence as it goes: the whole group first, then the tied
 * entrants' results against each other, and so on. A subset that is still level
 * on every key after being measured against only itself is a genuine cycle —
 * nothing left can separate it, so it falls back to name order.
 */
function orderIds(
  ids: string[],
  matches: StandingsMatch[],
  config: ScoringConfig,
  nameOf: (entryId: string) => string,
): string[] {
  if (ids.length <= 1) return [...ids];

  const rows = accumulate(ids, matches, config);
  const sorted = ids
    .map((id) => rows.get(id) as StandingRow)
    .sort((x, y) => compareRows(x, y) || nameOf(x.entryId).localeCompare(nameOf(y.entryId)));

  const ordered: string[] = [];
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && compareRows(sorted[start], sorted[end]) === 0) end += 1;
    const tied = sorted.slice(start, end).map((row) => row.entryId);

    if (tied.length === 1 || tied.length === ids.length) {
      ordered.push(...tied);
    } else {
      ordered.push(...orderIds(tied, matches, config, nameOf));
    }
    start = end;
  }
  return ordered;
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
  // The figures on screen are every entrant's full record. Only the ordering
  // narrows to a tied subset, so a table never shows a player's win count
  // shrinking because a tiebreak was applied above them.
  const rows = accumulate(entryIds, matches, config);
  return orderIds(entryIds, matches, config, nameOf).map((id, index) => ({
    ...(rows.get(id) ?? blank(id)),
    rank: index + 1,
  }));
}
