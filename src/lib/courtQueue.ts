/**
 * One court's day, read the way the umpire sitting at it reads it: what is on
 * now, what comes on after it, and what has already been played.
 *
 * Pure so the ordering rules can be tested without a browser, and generic over
 * the few fields it needs so it takes a stored match as it comes.
 */

export interface QueuedMatch {
  court?: string;
  scheduledAt?: string;
  scheduleOffset?: number;
  status: string;
}

export interface CourtQueue<M extends QueuedMatch> {
  /** The live match, or else the first one still waiting to be called. */
  now: M | null;
  /** Everything else still to be played here, in the order it is called. */
  upNext: M[];
  /** Played or conceded, most recent first, for correcting a score. */
  finished: M[];
}

const PENDING = new Set(["scheduled", "live"]);
const DONE = new Set(["completed", "walkover"]);

/**
 * The planner's offset first, because it is the order of play itself. A court
 * typed in by hand has no offset, so it falls back to the time written on the
 * match, and a match with neither goes last rather than jumping the queue.
 */
function callOrder(a: QueuedMatch, b: QueuedMatch): number {
  const byOffset = (a.scheduleOffset ?? Infinity) - (b.scheduleOffset ?? Infinity);
  if (byOffset !== 0 && !Number.isNaN(byOffset)) return byOffset;
  return (a.scheduledAt ?? "￿").localeCompare(b.scheduledAt ?? "￿");
}

/** Every court at least one match has been put on, "Court 2" before "Court 10". */
export function courtsInUse(matches: readonly QueuedMatch[]): string[] {
  const courts = new Set<string>();
  for (const match of matches) {
    const court = match.court?.trim();
    if (court && match.status !== "cancelled") courts.add(court);
  }
  return [...courts].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export function courtQueue<M extends QueuedMatch>(matches: readonly M[], court: string): CourtQueue<M> {
  const here = matches.filter((match) => match.court?.trim() === court).sort(callOrder);
  const pending = here.filter((match) => PENDING.has(match.status));
  // A match already under way outranks the one the timetable says is due: the
  // umpire has to finish the rally in front of them before calling the next.
  const now = pending.find((match) => match.status === "live") ?? pending[0] ?? null;
  return {
    now,
    upNext: pending.filter((match) => match !== now),
    finished: here.filter((match) => DONE.has(match.status)).reverse(),
  };
}
