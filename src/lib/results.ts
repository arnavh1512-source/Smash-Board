/**
 * One question asked in three places: has anybody actually played this match?
 *
 * The redraw guard, the category delete guard and the walkover guard all turn
 * on it, and they must agree — a match that blocks a redraw but not a delete
 * would be a hole in the same rule.
 *
 * Byes are deliberately not counted. They are walkovers the generator awarded
 * itself the moment the draw was made, with nobody on the other side and no
 * score, so treating them as results would make a fresh draw unredrawable.
 * A walkover handed out because somebody withdrew is not counted either: the
 * withdrawn side is emptied, and a redraw leaves them out anyway.
 */
export function hasPlayedResult(match: {
  sets: unknown[];
  status: string;
  aId: unknown;
  bId: unknown;
}): boolean {
  if (match.sets.length > 0) return true;
  if (match.status === "completed") return true;
  return match.status === "walkover" && match.aId !== null && match.bId !== null;
}

/** Must match the label the draw generator writes into an empty side. */
const BYE_LABEL = "BYE";

/**
 * A walkover the generator awarded itself, with nobody on the other side.
 *
 * Worth a name because the public board has to say something different for it:
 * "Walkover" in red reads as a player pulling out, which is a rumour a draw
 * should not start. A bye is just an odd number of entrants.
 *
 * The label decides it, not the missing id: a withdrawal also empties its side,
 * but leaves "Withdrawn" behind, and that one is news.
 */
export function isBye(match: {
  status: string;
  aId: unknown;
  bId: unknown;
  aLabel: string | null;
  bLabel: string | null;
}): boolean {
  if (match.status !== "walkover") return false;
  return (match.aId === null && match.aLabel === BYE_LABEL) || (match.bId === null && match.bLabel === BYE_LABEL);
}
