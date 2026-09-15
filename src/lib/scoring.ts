/**
 * Badminton scoring engine.
 *
 * Pure, dependency-free logic shared by the Convex backend and the Next.js UI.
 * Every rule the organiser can configure lives in ScoringConfig; nothing else
 * in the app is allowed to hardcode "21 points" or "best of 3".
 */

export type EndMode = "deuce" | "golden";

export interface ScoringConfig {
  /** Points needed to take a set outright, e.g. 11, 15 or 21. */
  pointsPerSet: number;
  /** Number of sets played at most. 1, 3, 5 or 7. */
  bestOf: number;
  /**
   * How a set ends once both sides reach pointsPerSet - 1:
   * - "deuce":  a side must lead by 2 (classic badminton), capped by `cap`.
   * - "golden": the very next point wins the set (sudden death).
   */
  endMode: EndMode;
  /**
   * Hard ceiling for a deuce set. At this score the leader wins with a
   * one-point margin. `null` means the set can run indefinitely.
   * Ignored when endMode is "golden".
   */
  cap: number | null;
}

export const DEFAULT_SCORING: ScoringConfig = {
  pointsPerSet: 21,
  bestOf: 3,
  endMode: "deuce",
  cap: 30,
};

/** Presets offered in the UI. Caps follow BWF convention. */
export const SCORING_PRESETS: { id: string; label: string; config: ScoringConfig }[] = [
  { id: "21x3", label: "21 points | best of 3 | deuce (BWF standard)", config: { pointsPerSet: 21, bestOf: 3, endMode: "deuce", cap: 30 } },
  { id: "21x1", label: "21 points | single set | deuce", config: { pointsPerSet: 21, bestOf: 1, endMode: "deuce", cap: 30 } },
  { id: "15x3", label: "15 points | best of 3 | deuce", config: { pointsPerSet: 15, bestOf: 3, endMode: "deuce", cap: 21 } },
  { id: "15x1", label: "15 points | single set | deuce", config: { pointsPerSet: 15, bestOf: 1, endMode: "deuce", cap: 21 } },
  { id: "11x3", label: "11 points | best of 3 | deuce", config: { pointsPerSet: 11, bestOf: 3, endMode: "deuce", cap: 15 } },
  { id: "11x5", label: "11 points | best of 5 | deuce", config: { pointsPerSet: 11, bestOf: 5, endMode: "deuce", cap: 15 } },
  { id: "11x1g", label: "11 points | single set | golden point", config: { pointsPerSet: 11, bestOf: 1, endMode: "golden", cap: null } },
  { id: "11x3g", label: "11 points | best of 3 | golden point", config: { pointsPerSet: 11, bestOf: 3, endMode: "golden", cap: null } },
  { id: "21x3g", label: "21 points | best of 3 | golden point", config: { pointsPerSet: 21, bestOf: 3, endMode: "golden", cap: null } },
];

export interface SetScore {
  a: number;
  b: number;
}

export type Side = "a" | "b";

export class ScoringError extends Error {}

export function validateConfig(config: ScoringConfig): void {
  if (!Number.isInteger(config.pointsPerSet) || config.pointsPerSet < 1 || config.pointsPerSet > 99) {
    throw new ScoringError("Points per set must be a whole number between 1 and 99.");
  }
  if (![1, 3, 5, 7].includes(config.bestOf)) {
    throw new ScoringError("Sets must be best of 1, 3, 5 or 7.");
  }
  if (config.endMode !== "deuce" && config.endMode !== "golden") {
    throw new ScoringError("End mode must be 'deuce' or 'golden'.");
  }
  if (config.endMode === "deuce" && config.cap !== null) {
    if (!Number.isInteger(config.cap)) throw new ScoringError("Cap must be a whole number.");
    if (config.cap <= config.pointsPerSet) {
      throw new ScoringError("Cap must be higher than the points per set.");
    }
  }
}

/**
 * Winner of a completed set, or null when the set is still in progress.
 * Throws when the pair of scores could never occur under the config.
 */
export function setWinner(set: SetScore, config: ScoringConfig): Side | null {
  const { a, b } = set;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    throw new ScoringError("Set scores must be whole numbers of 0 or more.");
  }

  const target = config.pointsPerSet;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const leader: Side = a > b ? "a" : "b";

  if (config.endMode === "golden") {
    if (hi > target) throw new ScoringError(`No side can pass ${target} in a golden point set.`);
    if (hi < target) return null;
    if (a === b) throw new ScoringError("A golden point set cannot end level.");
    return leader;
  }

  const cap = config.cap;
  if (cap !== null && hi > cap) {
    throw new ScoringError(`No side can pass the cap of ${cap}.`);
  }
  // Below the target nothing is decided yet.
  if (hi < target) return null;
  // Past the target, a deuce is running, so the trailing side must be close.
  if (hi > target && lo < target - 1) {
    throw new ScoringError(
      `A score of ${hi}-${lo} is impossible: past ${target} both sides must be at ${target - 1} or more.`,
    );
  }
  if (hi === lo) return null;
  if (hi - lo >= 2) return leader;
  // One point clear: only decisive at the cap.
  if (cap !== null && hi === cap) return leader;
  return null;
}

export interface MatchOutcome {
  /** Sets taken by each side among the sets supplied. */
  setsWon: { a: number; b: number };
  /** Total points scored across all sets, used for round-robin tiebreaks. */
  points: { a: number; b: number };
  /** Winner once a side has taken enough sets, otherwise null. */
  winner: Side | null;
  /** True when the sets supplied decide the match. */
  complete: boolean;
}

export function setsToWin(config: ScoringConfig): number {
  return Math.floor(config.bestOf / 2) + 1;
}

/**
 * Roll a list of sets up into a match result.
 * Sets played after the match was already decided are rejected.
 */
export function evaluateMatch(sets: SetScore[], config: ScoringConfig): MatchOutcome {
  validateConfig(config);
  if (sets.length > config.bestOf) {
    throw new ScoringError(`A best-of-${config.bestOf} match cannot have ${sets.length} sets.`);
  }

  const needed = setsToWin(config);
  const setsWon = { a: 0, b: 0 };
  const points = { a: 0, b: 0 };
  let winner: Side | null = null;

  for (let i = 0; i < sets.length; i++) {
    if (winner) {
      throw new ScoringError(`The match was already won after set ${i}; remove the extra set.`);
    }
    const set = sets[i];
    points.a += set.a;
    points.b += set.b;
    const w = setWinner(set, config);
    if (w) {
      setsWon[w] += 1;
      if (setsWon[w] === needed) winner = w;
    } else if (i < sets.length - 1) {
      throw new ScoringError(`Set ${i + 1} is unfinished but later sets exist.`);
    }
  }

  return {
    setsWon,
    points,
    winner,
    complete: winner !== null,
  };
}


/**
 * Add a point for one side, opening a new set when the previous one is done.
 * Drives the live "+1" buttons on the score console.
 */
export function addPoint(sets: SetScore[], side: Side, config: ScoringConfig): SetScore[] {
  const outcome = evaluateMatch(sets, config);
  if (outcome.complete) throw new ScoringError("The match is already complete.");

  const next = sets.map((s) => ({ ...s }));
  const last = next[next.length - 1];
  if (!last || setWinner(last, config) !== null) {
    next.push({ a: side === "a" ? 1 : 0, b: side === "b" ? 1 : 0 });
    return next;
  }
  last[side] += 1;
  return next;
}

/**
 * A category's scoring rules, including the optional late-round overrides.
 *
 * Organisers routinely play the group stage to a single game and the closing
 * rounds to the full best-of-three, so the semi-finals and the final each get
 * their own optional config. Absent (or null) means "use the base rules".
 */
export interface RoundScoring {
  scoring: ScoringConfig;
  semiFinalScoring?: ScoringConfig | null;
  finalScoring?: ScoringConfig | null;
}

/** The parts of a match that decide which rules apply to it. */
export interface RoundScoringMatch {
  stage: string;
  round: number;
  isThirdPlace: boolean;
}

/**
 * Resolve the rules one match is played under.
 *
 * Group matches always use the base config: an override is about the closing
 * rounds of the knockout, and a group table read under two different rule sets
 * would not be comparable. The third-place playoff shares the final's round, and
 * deliberately follows the final's override — a bronze match is played to the
 * same format as the match it runs alongside.
 */
export function scoringForRound(
  event: RoundScoring,
  match: RoundScoringMatch,
  totalKnockoutRounds: number,
): ScoringConfig {
  if (match.stage !== "knockout" || totalKnockoutRounds < 1) return event.scoring;
  const fromEnd = totalKnockoutRounds - 1 - match.round;
  if (fromEnd === 0) return event.finalScoring ?? event.scoring;
  if (fromEnd === 1) return event.semiFinalScoring ?? event.scoring;
  return event.scoring;
}

/** Take a point back off one side, collapsing a set that becomes 0-0. */
export function undoPointForSide(sets: SetScore[], side: Side): SetScore[] {
  const next = sets.map((s) => ({ ...s }));
  const last = next[next.length - 1];
  if (!last || last[side] === 0) return next;
  last[side] -= 1;
  if (last.a === 0 && last.b === 0 && next.length > 1) next.pop();
  return next;
}
