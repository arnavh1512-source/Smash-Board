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

export const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  live: "On court",
  completed: "Finished",
  walkover: "Walkover",
};

