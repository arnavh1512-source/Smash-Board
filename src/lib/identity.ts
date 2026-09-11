/**
 * Who a name belongs to.
 *
 * SmashBoard has no player accounts, and for a club tournament it should not:
 * an organiser types a list of names on a Saturday morning and expects it to
 * work. That means a person's identity is inferred from their name, and the
 * one rule that makes this safe is that the inference must be deterministic —
 * the same human being typed twice must always collapse to the same key, and
 * two different people must never collapse into one.
 *
 * The rule is deliberately written down in one place, because several parts of
 * the app now depend on it: the planner owes its rest to a person rather than
 * to an entry, so somebody in both the singles and the doubles must be
 * recognised as one player who cannot be on two courts at once.
 */

/**
 * The key a person is tracked by.
 *
 * Normalise, trim, collapse the inner whitespace, fold the case — in that
 * order. Unicode comes first because the same name typed on two keyboards can
 * arrive as two different byte sequences: a composed "é" against an "e"
 * followed by a combining accent, a full-width letter pasted out of a
 * spreadsheet, a non-breaking space between two words. NFKC folds all of those
 * together, so they end up as one person rather than two.
 */
export function personKey(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

/** One name that more than one entrant in the same list lays claim to. */
export interface DuplicateIdentity {
  /** The normalised key the clashing entrants share. */
  key: string;
  /** The spellings that were actually typed, in the order they were entered. */
  spellings: readonly string[];
  /** How many entrants of this category hold the name. */
  count: number;
}

/** Everything a single entrant contributes a name for. */
export interface NamedEntrant {
  playerOne: string;
  playerTwo?: string | null;
}

/**
 * Names held by more than one entrant of the same category.
 *
 * Across categories this is ordinary and expected — half a club plays the
 * singles and the doubles. Inside one category it is a mistake worth pointing
 * at: either somebody has been entered twice, or two different people share a
 * name and need telling apart before the draw is made, because from here on
 * the app will treat them as one player and refuse to put them on court at the
 * same time.
 *
 * A person named twice in the same partnership counts, which is the other way
 * a doubles pair gets typed wrong.
 */
export function duplicatePeople(entrants: readonly NamedEntrant[]): DuplicateIdentity[] {
  const seen = new Map<string, string[]>();
  for (const entrant of entrants) {
    for (const name of [entrant.playerOne, entrant.playerTwo]) {
      if (typeof name !== "string" || name.trim() === "") continue;
      const key = personKey(name);
      seen.set(key, [...(seen.get(key) ?? []), name.trim()]);
    }
  }
  return [...seen]
    .filter(([, spellings]) => spellings.length > 1)
    .map(([key, spellings]) => ({ key, spellings: [...new Set(spellings)], count: spellings.length }));
}
