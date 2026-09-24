/**
 * How many tournaments one source may create, and how fast.
 *
 * Creating a tournament is the one mutation with no PIN in front of it — it is
 * where a PIN comes from — so it is the one door a stranger can walk through
 * unaided. Left open it is a free write endpoint: a script could fill the
 * database and push the public list off the home page in a few seconds.
 *
 * The limit is deliberately far above what a real organiser does. Clubs run a
 * handful of tournaments a year, not a handful a minute; anybody who trips this
 * is not organising badminton.
 *
 * Kept free of Convex so the window arithmetic can be unit tested without a
 * deployment. `tournaments.create` applies it.
 */

/** How long one counting window lasts. */
export const CREATE_WINDOW_MS = 60 * 60 * 1000;

/** Creations allowed per window from a caller that identifies itself. */
export const CREATE_LIMIT = 5;

/**
 * The allowance for callers that send no id.
 *
 * They all share one bucket, so a tight limit here would let one script lock
 * out every other anonymous caller. It is looser on purpose: the real defence
 * for a caller with no id is that the console always sends one, so anything
 * landing in this bucket is already unusual.
 */
export const ANONYMOUS_CREATE_LIMIT = 20;

/**
 * Creations allowed per window across every source together.
 *
 * The per-source limits trust the caller's own id, and a script can mint a
 * fresh id for every request. This ceiling does not care who is asking. It is
 * set far above what the app has ever seen in an hour, so it only closes when
 * something is being automated.
 */
export const GLOBAL_CREATE_LIMIT = 60;

/**
 * The key the site-wide bucket is counted under before it is hashed. It can
 * never collide with a source: those are always `anonymous` or `client:<id>`.
 */
export const GLOBAL_CREATE_KEY = "global";

/** The fields of a `createAttempts` row the rules below read. */
export interface CreateRecord {
  count: number;
  windowStart: number;
}

export interface CreateStanding {
  /** Whether this creation is allowed through. */
  allowed: boolean;
  /** Milliseconds until the window resets, or 0 when nothing is blocked. */
  retryAfter: number;
  /** The window start to store, which is `now` when the window has rolled over. */
  windowStart: number;
  /** The count to store once this creation is recorded. */
  count: number;
}

export function createLimitFor(id: string | null): number {
  return id === null ? ANONYMOUS_CREATE_LIMIT : CREATE_LIMIT;
}

/**
 * What a source's record means right now.
 *
 * A window that has run out is not carried forward: the counter exists to cap
 * a burst, not to hold a quota against somebody for the rest of the day.
 */
export function readCreateSource(
  record: CreateRecord | null,
  now: number,
  limit: number,
): CreateStanding {
  const fresh = record === null || now - record.windowStart >= CREATE_WINDOW_MS;
  const windowStart = fresh ? now : record.windowStart;
  const spent = fresh ? 0 : record.count;
  return spent >= limit
    ? {
        allowed: false,
        retryAfter: windowStart + CREATE_WINDOW_MS - now,
        windowStart,
        count: spent,
      }
    : { allowed: true, retryAfter: 0, windowStart, count: spent + 1 };
}

function inMinutes(retryAfter: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The message a blocked creator sees, rounded up to whole minutes. */
export function createLimitMessage(retryAfter: number): string {
  return `Too many tournaments created from here. Try again in ${inMinutes(
    retryAfter,
  )}, or message us on WhatsApp if you need more.`;
}

/** The message everybody sees while the site-wide ceiling is closed. */
export function globalCreateLimitMessage(retryAfter: number): string {
  return `Lots of tournaments are being created right now. Try again in ${inMinutes(
    retryAfter,
  )}, or message us on WhatsApp.`;
}
