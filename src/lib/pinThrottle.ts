/**
 * How the sign-in door reads one source's history of PIN attempts.
 *
 * Kept free of Convex so the rules can be unit tested — above all the ones that
 * hang on the clock, which an integration test against a live deployment cannot
 * fast-forward. The mutation that applies them is `attemptSignIn` in
 * `convex/lib/auth.ts`.
 */

/**
 * How long a device that got a PIN right may walk past a tournament-wide lock.
 *
 * Long enough to cover a tournament weekend and the week of fixtures either
 * side of it; short enough that a phone which changed hands months ago is back
 * to being a stranger.
 */
export const TRUST_MS = 30 * 24 * 60 * 60 * 1000;

/** The fields of a `pinAttempts` row the rules below read. */
export interface SourceRecord {
  failed: number;
  contributed: number;
  lockedUntil?: number;
  trustedUntil?: number;
  updatedAt: number;
}

export interface SourceStanding<T extends SourceRecord> {
  /** Milliseconds left on this source's own lock, or 0 when it is not locked. */
  lockedFor: number;
  /** Whether this source has signed in recently enough to ignore a tournament-wide lock. */
  trusted: boolean;
  /** The record whose failures still count against this source, or null for a clean slate. */
  spent: T | null;
}

/** The id a caller sent, trimmed, or null when it sent nothing usable. */
export function sourceId(source: unknown): string | null {
  return typeof source === "string" && source.trim() !== "" ? source.trim() : null;
}

/**
 * The key a source is counted under before it is hashed.
 *
 * Named ids and the shared no-id bucket live in separate namespaces, so a
 * caller cannot land in the shared bucket — or, worse, earn it trust — by
 * sending the bucket's own name as its id.
 */
export function sourceKey(id: string | null): string {
  return id === null ? "anonymous" : `client:${id}`;
}

/**
 * The tournament's count of wrong guesses before the one being recorded now.
 *
 * A lock that has run out wipes the count. Without that the counter would sit
 * at the limit after the lock expired, and the very next wrong guess — one
 * mistyped PIN — would lock the whole tournament out for another stretch.
 */
export function tournamentFailures(
  failedPinAttempts: number | undefined,
  pinLockedUntil: number | undefined,
  now: number,
): number {
  return pinLockedUntil !== undefined && pinLockedUntil <= now ? 0 : (failedPinAttempts ?? 0);
}

/**
 * What a source's record means right now.
 *
 * A lockout that has run out wipes the slate, and so does a quiet spell of
 * `quietMs`: the counter is there to slow a run of guesses, not to hold a
 * grudge against somebody who mistyped last week. Trust is separate from both —
 * a trusted device is still throttled by its own lock, it only stops being
 * locked out by other people's guesses.
 */
export function readSource<T extends SourceRecord>(
  record: T | null,
  now: number,
  quietMs: number,
): SourceStanding<T> {
  return {
    lockedFor: record?.lockedUntil && record.lockedUntil > now ? record.lockedUntil - now : 0,
    trusted: record?.trustedUntil !== undefined && record.trustedUntil > now,
    spent: record && !record.lockedUntil && now - record.updatedAt < quietMs ? record : null,
  };
}
