/** Formatting helpers shared by the public and organiser views. */

import type { Doc } from "../../convex/_generated/dataModel";
import type { ScoringConfig } from "./scoring";

export function entryName(entry: Pick<Doc<"entries">, "playerOne" | "playerTwo"> | null | undefined): string {
  if (!entry) return "";
  return entry.playerTwo ? `${entry.playerOne} / ${entry.playerTwo}` : entry.playerOne;
}

/** The name to show for one side of a match, falling back to its draw label. */
export function sideName(
  entry: Doc<"entries"> | undefined,
  label: string | null,
): string {
  if (entry) return entryName(entry);
  return label ?? "To be decided";
}

export function scoringSummary(config: ScoringConfig): string {
  const games =
    config.bestOf === 1 ? "single game" : `best of ${config.bestOf}`;
  const ending =
    config.endMode === "golden"
      ? "golden point"
      : config.cap === null
        ? "deuce, no cap"
        : `deuce, cap ${config.cap}`;
  return `${config.pointsPerSet} points, ${games}, ${ending}`;
}

/**
 * Does a category name read like a pairs event?
 *
 * Used to warn an organiser who names a category "Mens Doubles" but leaves it
 * on Singles, which would silently drop every partner name. Kept here, and
 * tested, because the same mistake inside a component is invisible: the hint
 * simply never appears.
 */
export function looksLikeDoubles(name: string): boolean {
  return /\b(doubles?|pairs?|mixed)\b/i.test(name);
}

export const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  live: "On court",
  completed: "Finished",
  walkover: "Walkover",
};

