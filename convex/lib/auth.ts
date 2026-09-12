/**
 * Access control.
 *
 * A tournament is guarded by a PIN chosen when it is created. The PIN is never
 * stored; only a SHA-256 hash of `salt + pin` is kept.
 *
 * An organiser may also set a second, optional referee PIN. It unlocks score
 * entry and nothing else, so an umpire can be handed a phone without also being
 * handed the power to redraw the event or delete it.
 *
 * The PIN itself is accepted at exactly one place: `attemptSignIn`, which trades
 * it for a short-lived signed token. Every other mutation takes the token and
 * never sees the PIN. Two reasons:
 *
 *  1. A Convex mutation is a transaction. A guard that recorded a wrong guess
 *     and then threw would have that write rolled back with the throw, so the
 *     failure counter could never accumulate and the lockout could never fire.
 *     `attemptSignIn` returns a verdict instead of throwing, so the counter
 *     commits and the lockout works.
 *  2. With one door, rate limiting has one place to live. A guesser cannot
 *     sidestep the counter by hammering some other mutation that also happened
 *     to take a PIN.
 *
 * The token is stateless: a MAC over the tournament, the role, the expiry and
 * the PIN hash for that role, keyed by the tournament's own salt. Nothing is
 * stored, and rotating a PIN silently invalidates every token issued for it.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Wrong guesses a whole tournament tolerates before its PINs stop working. */
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60 * 1000;

/**
 * The per-source layer.
 *
 * The tournament-wide lockout above is the last line, and on its own it is also
 * an attack: the sign-in door is public, so anybody holding the link could post
 * eight wrong PINs and shut the organiser out of their own console mid-match.
 * So each caller is throttled first, and — the part that actually defuses the
 * attack — a single caller may only spend `SOURCE_QUOTA` of the tournament's
 * eight. Locking a tournament out now takes a crowd rather than one person.
 *
 * The source is self-declared (the console sends a random id it keeps in the
 * browser), so it proves nothing and can be rotated. That is exactly why the
 * tournament-wide lock stays underneath it: the two layers are weak and strong
 * against opposite things.
 */
const SOURCE_MAX_ATTEMPTS = 5;
const SOURCE_LOCKOUT_MS = 15 * 60 * 1000;
const SOURCE_QUOTA = 3;

/** A token lasts a tournament day, then the organiser signs in again. */
export const SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * Six, not four.
 *
 * The stored PIN is a SHA-256 of a per-tournament salt and the PIN, which
 * keeps plaintext out of the database but is deliberately fast to compute.
 * Anybody holding a copy of the database could therefore run the whole
 * four-digit space in a moment. Online guessing is already throttled; this is
 * about the offline case, and two more characters is the cheapest defence
 * against it that costs an organiser nothing at the desk.
 */
export const MIN_PIN_LENGTH = 6;
export const MAX_PIN_LENGTH = 64;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export function assertPinShape(pin: string, label = "Organiser PIN"): void {
  if (typeof pin !== "string" || pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
    throw new ConvexError(
      `${label} must be between ${MIN_PIN_LENGTH} and ${MAX_PIN_LENGTH} characters.`,
    );
  }
}

/** Constant-time string compare, so timing does not leak the hash. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function loadTournament(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"tournaments">> {
  const tournament = await ctx.db.get(tournamentId);
  if (!tournament) throw new ConvexError("That tournament no longer exists.");
  return tournament;
}

/** What a caller is allowed to do once their PIN checks out. */
export type AccessRole = "organiser" | "referee";

/** The PIN hash a role's token is bound to, or null when that role has no PIN. */
function hashForRole(tournament: Doc<"tournaments">, role: AccessRole): string | null {
  return role === "organiser" ? tournament.pinHash : (tournament.refereePinHash ?? null);
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/**
 * Mint a session token for a role that has already been proven.
 *
 * The role's PIN hash is part of the signed message, so changing that PIN
 * invalidates its outstanding tokens without touching the other role's.
 */
async function mintToken(
  tournament: Doc<"tournaments">,
  role: AccessRole,
  expiresAt: number,
): Promise<string> {
  const bound = hashForRole(tournament, role);
  if (bound === null) throw new ConvexError("That role has no PIN set.");
  const mac = await sign(
    tournament.pinSalt,
    `${tournament._id}:${role}:${expiresAt}:${bound}`,
  );
  return `${role}.${expiresAt}.${mac}`;
}

/** The role a token proves, or null if it is malformed, expired or forged. */
async function readToken(
  tournament: Doc<"tournaments">,
  token: string,
  now: number,
): Promise<AccessRole | null> {
  if (typeof token !== "string") return null;
  const [role, expiry, mac] = token.split(".");
  if (role !== "organiser" && role !== "referee") return null;
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  if (typeof mac !== "string" || mac.length !== 64) return null;
  if (hashForRole(tournament, role) === null) return null;
  const expected = await mintToken(tournament, role, expiresAt);
  return timingSafeEqual(token, expected) ? role : null;
}

/** How long is left on a lockout, worded the same wherever it is reported. */
function lockoutMessage(remainingMs: number, scope: "tournament" | "device"): string {
  const minutes = Math.ceil(remainingMs / 60000);
  const who = scope === "device" ? "from this device" : "for this tournament";
  return `Too many wrong PINs ${who}. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** What the sign-in door reports back. It never throws for a wrong PIN. */
export type SignInResult =
  | { ok: true; token: string; role: AccessRole; expiresAt: number }
  | { ok: false; error: string };

/**
 * Check a PIN and, if it is right, hand back a token.
 *
 * `allow` names the roles whose PIN will be accepted. The failure counter is
 * shared across both PINs on purpose: the lockout protects the tournament, and
 * a guesser should not get a fresh eight tries by switching which PIN they
 * claim to be entering.
 *
 * `source` is an id the caller supplies for itself — the console keeps a random
 * one in the browser. It proves nothing, which is why the tournament-wide lock
 * stays underneath it; what it buys is that an ordinary attacker throttles
 * themselves long before they can spend the tournament's whole budget of wrong
 * guesses. Callers that send nothing share a single crowded bucket.
 *
 * Returns a verdict rather than throwing, because a throw would roll back the
 * very write that records the wrong guess.
 */
export async function attemptSignIn(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  pin: string,
  allow: readonly AccessRole[],
  source?: string,
): Promise<SignInResult> {
  const tournament = await loadTournament(ctx, tournamentId);
  const now = Date.now();

  // Everyone who sends no id shares one bucket. That bucket is throttled like
  // any other, which is the point: an attacker who strips the id off their
  // requests lands in the most crowded, most quickly exhausted queue there is.
  const sourceHash = await hashPin(
    typeof source === "string" && source.trim() !== "" ? source.trim() : "anonymous",
    tournament.pinSalt,
  );
  const record = await ctx.db
    .query("pinAttempts")
    .withIndex("by_source", (q) => q.eq("tournamentId", tournamentId).eq("sourceHash", sourceHash))
    .unique();

  if (record?.lockedUntil && record.lockedUntil > now) {
    return { ok: false, error: lockoutMessage(record.lockedUntil - now, "device") };
  }
  if (tournament.pinLockedUntil && tournament.pinLockedUntil > now) {
    return { ok: false, error: lockoutMessage(tournament.pinLockedUntil - now, "tournament") };
  }

  /**
   * What this source has already spent. A lockout that has run out wipes the
   * slate, and so does a long quiet spell: the counter is there to slow a run
   * of guesses, not to hold a grudge against somebody who mistyped last week.
   */
  const spent = record && !record.lockedUntil && now - record.updatedAt < SOURCE_LOCKOUT_MS
    ? record
    : null;

  const candidate = await hashPin(typeof pin === "string" ? pin : "", tournament.pinSalt);
  let matched: AccessRole | null = null;
  if (allow.includes("organiser") && timingSafeEqual(candidate, tournament.pinHash)) {
    matched = "organiser";
  } else if (
    allow.includes("referee") &&
    tournament.refereePinHash &&
    timingSafeEqual(candidate, tournament.refereePinHash)
  ) {
    matched = "referee";
  }

  if (!matched) {
    const sourceFailed = (spent?.failed ?? 0) + 1;
    const sourceLocked = sourceFailed >= SOURCE_MAX_ATTEMPTS;
    // The quota is what stops one person locking a tournament: past their
    // share, their wrong guesses are still counted against them and no longer
    // counted against the tournament.
    const contributed = spent?.contributed ?? 0;
    const contributes = contributed < SOURCE_QUOTA;
    const attempt = {
      tournamentId,
      sourceHash,
      failed: sourceFailed,
      contributed: contributed + (contributes ? 1 : 0),
      lockedUntil: sourceLocked ? now + SOURCE_LOCKOUT_MS : undefined,
      updatedAt: now,
    };
    if (record) await ctx.db.patch(record._id, attempt);
    else await ctx.db.insert("pinAttempts", attempt);

    const failed = (tournament.failedPinAttempts ?? 0) + (contributes ? 1 : 0);
    const locked = failed >= MAX_ATTEMPTS;
    if (contributes) {
      await ctx.db.patch(tournamentId, {
        failedPinAttempts: failed,
        pinLockedUntil: locked ? now + LOCKOUT_MS : undefined,
      });
    }
    // The guess that trips the lock says so. Telling it apart from the guesses
    // before it costs an attacker nothing they could not learn by trying once
    // more, and saves an organiser who mistyped from guessing at why the right
    // PIN suddenly stopped working.
    if (sourceLocked) return { ok: false, error: lockoutMessage(SOURCE_LOCKOUT_MS, "device") };
    if (locked) return { ok: false, error: lockoutMessage(LOCKOUT_MS, "tournament") };
    return {
      ok: false,
      error:
        allow.includes("referee") && allow.includes("organiser")
          ? "That PIN was not recognised."
          : "Wrong organiser PIN.",
    };
  }

  if (record) await ctx.db.delete(record._id);
  if (tournament.failedPinAttempts || tournament.pinLockedUntil) {
    await ctx.db.patch(tournamentId, { failedPinAttempts: 0, pinLockedUntil: undefined });
  }

  const expiresAt = now + SESSION_MS;
  return {
    ok: true,
    token: await mintToken(tournament, matched, expiresAt),
    role: matched,
    expiresAt,
  };
}

/** Mint a token for someone who has just proved themselves another way. */
export async function issueToken(
  tournament: Doc<"tournaments">,
  role: AccessRole,
): Promise<string> {
  return await mintToken(tournament, role, Date.now() + SESSION_MS);
}

async function requireToken(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  token: string,
  allow: readonly AccessRole[],
): Promise<{ tournament: Doc<"tournaments">; role: AccessRole }> {
  const tournament = await loadTournament(ctx, tournamentId);
  const role = await readToken(tournament, token, Date.now());
  if (role === null) {
    throw new ConvexError("Your session has expired. Please enter the PIN again.");
  }
  // A referee holding a perfectly good token is not expired, they are simply
  // not allowed here, and saying so stops them hunting for a bug that is not
  // there.
  if (!allow.includes(role)) {
    throw new ConvexError("Only the organiser can do that. Sign in with the organiser PIN.");
  }
  return { tournament, role };
}

/**
 * Require an organiser session. Throws a ConvexError the UI can show directly.
 */
export async function requireOrganiser(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  token: string,
): Promise<Doc<"tournaments">> {
  const { tournament } = await requireToken(ctx, tournamentId, token, ["organiser"]);
  return tournament;
}

/**
 * Require a session that is allowed to enter scores: the organiser's, or a
 * referee's when the organiser has set a referee PIN.
 */
export async function requireScorer(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  token: string,
): Promise<{ tournament: Doc<"tournaments">; role: AccessRole }> {
  return await requireToken(ctx, tournamentId, token, ["organiser", "referee"]);
}

/** Strip the PIN hash before anything is sent to a browser. */
export function publicTournament(tournament: Doc<"tournaments">) {
  const {
    pinHash: _pinHash,
    pinSalt: _pinSalt,
    refereePinHash: _refereePinHash,
    failedPinAttempts: _f,
    pinLockedUntil: _l,
    ...rest
  } = tournament;
  // Whether a referee PIN exists is not secret, and the console needs to know
  // so it can offer "set one up" rather than "share the link".
  const showOrganiserContact = tournament.showOrganiserContact === true;
  return {
    ...rest,
    // A phone number is contact detail, not scoreboard data. It leaves the
    // server only when the organiser has said it may; the console reads its
    // own copy back through `revealOrganiserContact`, behind the PIN.
    organiserPhone: showOrganiserContact ? rest.organiserPhone : undefined,
    showOrganiserContact,
    hasRefereePin: _refereePinHash !== undefined,
  };
}
