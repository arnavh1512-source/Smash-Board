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
