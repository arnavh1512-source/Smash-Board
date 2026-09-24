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

/** The two PINs a tournament can have. Mirrors `AccessRole` in `convex/lib/auth.ts`. */
export type TrustRole = "organiser" | "referee";

/** The fields of a `pinAttempts` row the rules below read. */
export interface SourceRecord {
  failed: number;
  contributed: number;
  lockedUntil?: number;
  trustedUntil?: number;
  trustedRole?: TrustRole;
  updatedAt: number;
}

export interface SourceStanding<T extends SourceRecord> {
  /** Milliseconds left on this source's own lock, or 0 when it is not locked. */
  lockedFor: number;
  /**
   * The PIN this source has recently got right, which lets it through a
   * tournament-wide lock for that role only — or null when it is a stranger.
   */
  trustedRole: TrustRole | null;
  /** The record whose failures still count against this source, or null for a clean slate. */
  spent: T | null;
}

/**
 * Longest id kept. The console sends a UUID; anything longer is a caller
 * padding the value, and the hash does not need more than this to tell ids apart.
 */
export const MAX_SOURCE_ID = 64;

/** The id a caller sent, trimmed and capped, or null when it sent nothing usable. */
export function sourceId(source: unknown): string | null {
  if (typeof source !== "string") return null;
  const id = source.trim().slice(0, MAX_SOURCE_ID);
  return id === "" ? null : id;
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
    trustedRole:
      record?.trustedUntil !== undefined && record.trustedUntil > now
        ? // Rows written before trust was tied to a role get the narrower one.
          (record.trustedRole ?? "referee")
        : null,
    spent: record && !record.lockedUntil && now - record.updatedAt < quietMs ? record : null,
  };
}

/**
 * Which of the requested roles may still be tried while the tournament is locked.
 *
 * Trust is earned per PIN. A phone that was only ever handed the referee PIN
 * must not be able to keep guessing at the organiser PIN through a lock the
 * crowd tripped — that would turn every umpire's phone into a way round the
 * lock. The organiser PIN also opens the referee door, so organiser trust
 * covers both.
 */
export function rolesThroughLock(
  allow: readonly TrustRole[],
  trustedRole: TrustRole | null,
): TrustRole[] {
  if (trustedRole === "organiser") return [...allow];
  if (trustedRole === "referee") return allow.filter((role) => role === "referee");
  return [];
}

/**
 * The role to remember a source as trusted for after it gets `matched` right.
 *
 * Signing in as referee on a phone the organiser already uses must not demote
 * it, so a still-valid organiser trust is kept.
 */
export function nextTrustedRole(current: TrustRole | null, matched: TrustRole): TrustRole {
  return current === "organiser" ? "organiser" : matched;
}
