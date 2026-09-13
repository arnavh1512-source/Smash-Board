/**
 * One player's day, pulled out of the whole tournament.
 *
 * A player reading the scoreboard has one question — when and where am I on —
 * and the answer is scattered across every category they entered and every
 * round of every draw. This gathers it back into one list.
 *
 * A person is found by name, through the same `personKey` the planner uses to
 * give them their rest, so "Rohan Mehta" in the singles and "rohan  mehta" in
 * a doubles pair are the one player here exactly as they are on the timetable.
 */

import { groupLabel, knockoutRoundName } from "./draw";
import { personKey } from "./identity";

/** The names an entrant is made of: one for singles, two for a doubles pair. */
export interface NamedEntry {
  playerOne: string;
  playerTwo?: string | null;
}

/** The parts of a match this module reads. */
export interface PlayerMatchInput {
  eventId: string;
  aId: string | null;
  bId: string | null;
  stage: "group" | "knockout";
  round: number;
  slot: number;
  status: string;
  scheduleOffset?: number;
  groupIndex?: number | null;
  isThirdPlace?: boolean;
}

/** Statuses after which a match no longer needs anybody on court. */
const FINISHED = new Set(["completed", "walkover", "cancelled"]);

export function isFinished(match: Pick<PlayerMatchInput, "status">): boolean {
  return FINISHED.has(match.status);
}

/** Every name an entrant carries, in the order they were entered. */
export function peopleOf(entry: NamedEntry): string[] {
  return entry.playerTwo ? [entry.playerOne, entry.playerTwo] : [entry.playerOne];
}

/** Whether this entrant — alone or as half of a pair — is the named person. */
export function entryHasPerson(entry: NamedEntry, name: string): boolean {
  const key = personKey(name);
  return peopleOf(entry).some((person) => personKey(person) === key);
}

/**
 * Which side of the match the person is on, or null when they are not in it.
 *
 * A person is never on both sides: the entry list refuses one person twice in
 * a category, and a match only ever pairs two entrants of the same category.
 */
export function sideOf(
  match: Pick<PlayerMatchInput, "aId" | "bId">,
  name: string,
  entries: ReadonlyMap<string, NamedEntry>,
): "a" | "b" | null {
  const holds = (id: string | null) => {
    const entry = id === null ? undefined : entries.get(id);
    return entry !== undefined && entryHasPerson(entry, name);
  };
  if (holds(match.aId)) return "a";
  if (holds(match.bId)) return "b";
  return null;
}

/**
 * The person's partner in this entrant, for a doubles pair.
 *
 * Returns null for singles, and for an entry the person is not part of.
 */
export function partnerOf(entry: NamedEntry, name: string): string | null {
  if (!entry.playerTwo) return null;
  const key = personKey(name);
  if (personKey(entry.playerOne) === key) return entry.playerTwo;
  if (personKey(entry.playerTwo) === key) return entry.playerOne;
  return null;
}

/**
 * Every match the person is drawn into, in the order they will meet them.
 *
 * Played matches come first, because they are behind the player; what is
 * still to come follows in timetable order. A match with no time — the plan
 * has not been made, or it was made before this match had players — goes
 * after the timed ones, in the order the draw would reach it.
 */
export function matchesOfPerson<M extends PlayerMatchInput>(
  name: string,
  matches: readonly M[],
  entries: ReadonlyMap<string, NamedEntry>,
): M[] {
  const rank = (match: M) => [
    isFinished(match) ? 0 : 1,
    match.scheduleOffset ?? Number.POSITIVE_INFINITY,
    match.stage === "group" ? 0 : 1,
    match.round,
    match.slot,
  ];
  return matches
    .filter((match) => sideOf(match, name, entries) !== null)
    .map((match) => ({ match, key: rank(match) }))
    .sort((x, y) => {
      for (let i = 0; i < x.key.length; i++) {
        if (x.key[i] !== y.key[i]) return x.key[i] - y.key[i];
      }
      return x.match.eventId.localeCompare(y.match.eventId);
    })
    .map(({ match }) => match);
}

/**
 * The match the player should be getting ready for.
 *
 * One already on court wins, because that player is wanted now. Otherwise it
 * is the first match still to be played, in the order `matchesOfPerson` gives.
 */
export function nextMatchOf<M extends PlayerMatchInput>(ordered: readonly M[]): M | undefined {
  return ordered.find((match) => match.status === "live") ?? ordered.find((m) => !isFinished(m));
}

/**
 * What a match is called inside its own category, for a list that mixes them.
 *
 * `categoryMatches` is every match of the same category, which is what tells a
 * semi-final apart from a quarter-final.
 */
export function roundTitle(
  match: PlayerMatchInput,
  categoryMatches: readonly PlayerMatchInput[],
  format: string,
): string {
  if (match.stage === "group") {
    const round = `Round ${match.round + 1}`;
    return format === "round_robin" ? round : `Group ${groupLabel(match.groupIndex ?? 0)} · ${round}`;
  }
  if (match.isThirdPlace) return "Third place";
  const main = categoryMatches.filter((m) => m.stage === "knockout" && !m.isThirdPlace);
  const totalRounds = Math.max(match.round, ...main.map((m) => m.round)) + 1;
  return knockoutRoundName(match.round, totalRounds);
}
