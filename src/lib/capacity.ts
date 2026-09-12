/**
 * How large a category may get, format by format.
 *
 * A single advertised maximum is a promise the product cannot keep. 256
 * entrants in a knockout is 255 matches, which is a large but ordinary draw.
 * The same 256 entrants in a round robin is 32,640 matches, because everybody
 * plays everybody: the draw generator would try to insert them in one Convex
 * mutation, which writes at most 16,000 documents and scans at most 32,000, and
 * deleting the category afterwards would hit the same wall from the other side.
 *
 * So the limit is on the thing that actually costs something — the number of
 * matches a draw produces — and the entrant maximum is whatever that budget
 * allows for the shape the organiser has chosen. The application refuses the
 * combination when the entrant is added, rather than discovering the limit
 * halfway through generating a draw on the morning of the tournament.
 */

import { bracketSize, splitIntoGroups } from "./draw";

/**
 * The most matches one category may generate.
 *
 * Far below Convex's transaction limits on purpose. The ceiling that binds
 * first is not the database but the hall: 512 matches at 30 minutes on eight
 * courts is thirty-two hours of play, so any category that reaches this number
 * is a configuration mistake rather than a tournament. Keeping the budget here
 * leaves the generate and delete mutations comfortably inside the 16,000-write
 * and 32,000-scan ceilings even with the reads each one does around the write.
 */
export const MAX_MATCHES_PER_DRAW = 512;

/** No category exceeds this, whatever the format allows. */
export const MAX_ENTRIES_PER_EVENT = 256;

/**
 * The other end of the same problem: deleting a tournament deletes every match
 * under it, one document at a time, inside a single mutation. A per-category
 * budget alone does not bound that, because a tournament can hold many
 * categories - so the number of categories and the total matches under them are
 * bounded too, and the whole teardown stays inside the same write ceiling.
 *
 * 24 categories at 256 entrants is 6,144 entries, and 4,096 matches on top of
 * them is a little over 10,000 documents: comfortably inside 16,000, and far
 * more than a weekend in one hall can play.
 */
export const MAX_EVENTS_PER_TOURNAMENT = 24;
export const MAX_MATCHES_PER_TOURNAMENT = 4096;

export type EventFormat = "knockout" | "round_robin" | "groups_knockout";

/** The parts of a category that decide how many matches its draw makes. */
export interface DrawShape {
  format: EventFormat;
  groupCount: number;
  advancePerGroup: number;
  doubleRound: boolean;
  thirdPlace: boolean;
}

/** Matches in a round robin of `size` entrants: everybody meets everybody. */
function roundRobinMatches(size: number, doubleRound: boolean): number {
  if (size < 2) return 0;
  return ((size * (size - 1)) / 2) * (doubleRound ? 2 : 1);
}

/** Matches in a knockout bracket holding `field` entrants or qualifiers. */
function knockoutMatches(field: number, thirdPlace: boolean): number {
  if (field < 2) return 0;
  const size = bracketSize(field);
  const rounds = Math.log2(size);
  return size - 1 + (thirdPlace && rounds >= 2 ? 1 : 0);
}

/**
 * Exactly how many match documents `generate` would write for this many
 * entrants in this shape. It mirrors the generators in `draw.ts` rather than
 * estimating, so the guard and the generator cannot drift apart.
 */
export function matchesForDraw(entrants: number, shape: DrawShape): number {
  if (entrants < 2) return 0;
  if (shape.format === "knockout") return knockoutMatches(entrants, shape.thirdPlace);
  if (shape.format === "round_robin") return roundRobinMatches(entrants, shape.doubleRound);

  // Groups: the snake split decides the group sizes, which differ by at most
  // one, and the knockout that follows is sized by the qualifiers rather than
  // by the field.
  const seats = Array.from({ length: entrants }, (_, index) => String(index));
  const groups = splitIntoGroups(seats, Math.max(1, shape.groupCount));
  const groupMatches = groups.reduce(
    (total, group) => total + roundRobinMatches(group.length, shape.doubleRound),
    0,
  );
  const qualifiers = shape.groupCount * shape.advancePerGroup;
  return groupMatches + (qualifiers < 2 ? 0 : knockoutMatches(qualifiers, shape.thirdPlace));
}

/**
 * The largest field this shape can hold inside the match budget.
 *
 * Counted rather than solved: the match count rises with the field for every
 * format, and the search is at most 256 steps, so mirroring the generators
 * exactly is worth more here than a closed form that has to be kept in step
 * with them by hand.
 */
export function maxEntrantsFor(shape: DrawShape): number {
  let allowed = 1;
  for (let entrants = 2; entrants <= MAX_ENTRIES_PER_EVENT; entrants++) {
    if (matchesForDraw(entrants, shape) > MAX_MATCHES_PER_DRAW) break;
    allowed = entrants;
  }
  return allowed;
}

const FORMAT_NAMES: Record<EventFormat, string> = {
  knockout: "knockout",
  round_robin: "round robin",
  groups_knockout: "group stage",
};

/**
 * What the organiser is told when the field is bigger than the format can run.
 * It names the format, because the answer is usually to change the format
 * rather than to turn entrants away.
 */
export function capacityMessage(shape: DrawShape): string {
  const allowed = maxEntrantsFor(shape);
  if (shape.format === "knockout") {
    return `A category holds at most ${allowed} entrants.`;
  }
  const played = matchesForDraw(allowed, shape);
  return (
    `A ${FORMAT_NAMES[shape.format]} category holds at most ${allowed} entrants, ` +
    `because ${allowed} already means ${played} matches to play. ` +
    `Use a knockout, or more groups, for a larger field.`
  );
}
