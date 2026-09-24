/**
 * Access control.
 *
 * A tournament is guarded by a PIN chosen when it is created. The PIN is never
 * stored; only a PBKDF2 hash of it under the tournament's salt is kept — see
 * `derivePinHash`.
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
 * the PIN hash for that role. Nothing is stored, and rotating a PIN silently
 * invalidates every token issued for it. The key is the tournament's own salt
 * combined with a deployment secret that never touches the database, so reading
 * the tournament row is not enough to forge one — see `convex/lib/secret.ts`.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { tokenSecret } from "./secret";
import {
  TRUST_MS,
  nextTrustedRole,
  readSource,
  rolesThroughLock,
  sourceId,
  sourceKey,
  tournamentFailures,
} from "../../src/lib/pinThrottle";

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
 *
 * Rotation is also what would turn the tournament lock back into a weapon: an
 * attacker who invents three ids spends the whole budget and shuts everyone
 * out for ten minutes. So a source that has signed in with a real PIN is
 * trusted for `TRUST_MS` and walks past the tournament lock, still throttled
 * by its own. The id is 128 random bits the browser never shows anyone, so an
 * attacker cannot borrow the organiser's trust by guessing it.
 */
const SOURCE_MAX_ATTEMPTS = 5;
const SOURCE_LOCKOUT_MS = 15 * 60 * 1000;
const SOURCE_QUOTA = 3;

/** A token lasts a tournament day, then the organiser signs in again. */
export const SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * Six, not four.
 *
 * Online guessing is throttled; this is about somebody holding a copy of the
 * database. The stored hash is slow on purpose (see `derivePinHash`), and two
 * more characters multiply the work of running the whole space by a hundred
 * at no cost to an organiser at the desk.
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

/**
 * A fast SHA-256 of `salt:value`.
 *
 * For throttle keys only — hashing a browser's random id so the attempt tables
 * never hold the id itself. Those ids are 128 random bits, so a slow hash would
 * buy nothing. PINs are short and human-chosen, and go through `derivePinHash`.
 */
export async function digest(value: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${value}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/**
 * PBKDF2-SHA256 work factor for new PIN hashes.
 *
 * A PIN is six-plus characters a person chose, so a fast hash of it falls to a
 * laptop in minutes once the database leaks. This makes each guess cost real
 * CPU. Stored inside the hash, so it can be raised later without stranding the
 * PINs already set: an old count still verifies, and is upgraded on sign-in.
 */
export const PIN_ITERATIONS = 100_000;

/** Marks a PBKDF2 hash. A bare 64-character hex string is the legacy SHA-256 form. */
const PIN_HASH_PREFIX = "p1$";

async function pbkdf2(pin: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations },
    key,
    256,
  );
  return toHex(bits);
}

/** The stored form of a PIN: `p1$<iterations>$<hex>`. */
export async function derivePinHash(
  pin: string,
  salt: string,
  iterations = PIN_ITERATIONS,
): Promise<string> {
  return `${PIN_HASH_PREFIX}${iterations}$${await pbkdf2(pin, salt, iterations)}`;
}

/**
 * Whether `pin` is the one behind `stored`, and whether `stored` should be
 * rewritten in the current format.
 *
 * Reads both formats, so tournaments created before PBKDF2 keep working; the
 * caller upgrades the hash the first time the right PIN is entered.
 */
export async function verifyPin(
  pin: string,
  salt: string,
  stored: string,
): Promise<{ ok: boolean; stale: boolean }> {
  if (!stored.startsWith(PIN_HASH_PREFIX)) {
    return { ok: timingSafeEqual(await digest(pin, salt), stored), stale: true };
  }
  const [iterationText, expected] = stored.slice(PIN_HASH_PREFIX.length).split("$");
  const iterations = Number(iterationText);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || typeof expected !== "string") {
    return { ok: false, stale: false };
  }
  return {
    ok: timingSafeEqual(await pbkdf2(pin, salt, iterations), expected),
    stale: iterations !== PIN_ITERATIONS,
  };
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
    `${tokenSecret()}:${tournament.pinSalt}`,
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
 * A named source that gets a PIN right is remembered as trusted, so the next
 * crowd of wrong guesses cannot lock that device out. The shared bucket is
 * never trusted: it belongs to nobody in particular.
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
  const id = sourceId(source);
  const sourceHash = await digest(sourceKey(id), tournament.pinSalt);
  const record = await ctx.db
    .query("pinAttempts")
    .withIndex("by_source", (q) => q.eq("tournamentId", tournamentId).eq("sourceHash", sourceHash))
    .unique();
  const { lockedFor, trustedRole, spent } = readSource(record, now, SOURCE_LOCKOUT_MS);

  if (lockedFor > 0) return { ok: false, error: lockoutMessage(lockedFor, "device") };
  // A device that has already signed in is not shut out by other people's
  // guesses — for the PIN it proved it knows. Its own wrong guesses still count
  // below, and its own lock holds.
  const tournamentLockedFor = (tournament.pinLockedUntil ?? 0) - now;
  const open = tournamentLockedFor > 0 ? rolesThroughLock(allow, trustedRole) : [...allow];
  if (open.length === 0) {
    return { ok: false, error: lockoutMessage(tournamentLockedFor, "tournament") };
  }

  const matched = await matchPin(tournament, typeof pin === "string" ? pin : "", open);

  if (!matched) {
    const sourceFailed = (spent?.failed ?? 0) + 1;
    const sourceLocked = sourceFailed >= SOURCE_MAX_ATTEMPTS;
    // The quota is what stops one person locking a tournament: past their
    // share, their wrong guesses are still counted against them and no longer
    // counted against the tournament. A trusted device mistyping while the
    // tournament is already locked adds nothing either: the lock is not
    // stretched, and the device is told its PIN was wrong, not that it tripped
    // a lock that was already there.
    const contributed = spent?.contributed ?? 0;
    const contributes = contributed < SOURCE_QUOTA && tournamentLockedFor <= 0;
    const attempt = {
      tournamentId,
      sourceHash,
      failed: sourceFailed,
      contributed: contributed + (contributes ? 1 : 0),
      lockedUntil: sourceLocked ? now + SOURCE_LOCKOUT_MS : undefined,
      trustedUntil: record?.trustedUntil,
      trustedRole: record?.trustedRole,
      updatedAt: now,
    };
    if (record) await ctx.db.patch(record._id, attempt);
    else await ctx.db.insert("pinAttempts", attempt);

    const failed =
      tournamentFailures(tournament.failedPinAttempts, tournament.pinLockedUntil, now) +
      (contributes ? 1 : 0);
    const locked = contributes && failed >= MAX_ATTEMPTS;
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
    return { ok: false, error: "That PIN was not recognised." };
  }

  const { role, rehash } = matched;
  if (id !== null) {
    const remembered = {
      tournamentId,
      sourceHash,
      failed: 0,
      contributed: 0,
      lockedUntil: undefined,
      trustedUntil: now + TRUST_MS,
      trustedRole: nextTrustedRole(trustedRole, role),
      updatedAt: now,
    };
    if (record) await ctx.db.patch(record._id, remembered);
    else await ctx.db.insert("pinAttempts", remembered);
  } else if (record) {
    await ctx.db.delete(record._id);
  }

  // A hash in an old format is replaced the first time its PIN is typed, which
  // is the only moment the PIN is in hand. The token MAC covers the hash, so
  // this signs out other devices on that role once — the same thing rotating
  // the deployment secret already did.
  const changes = {
    ...(rehash === null ? {} : role === "organiser" ? { pinHash: rehash } : { refereePinHash: rehash }),
    ...(tournament.failedPinAttempts || tournament.pinLockedUntil
      ? { failedPinAttempts: 0, pinLockedUntil: undefined }
      : {}),
  };
  if (Object.keys(changes).length > 0) await ctx.db.patch(tournamentId, changes);

  const expiresAt = now + SESSION_MS;
  return {
    ok: true,
    token: await mintToken({ ...tournament, ...changes }, role, expiresAt),
    role,
    expiresAt,
  };
}

/**
 * The first of `allow` whose PIN this is, and a fresh hash to store when the
 * one on file is in an outdated format — or null when it matches neither.
 */
async function matchPin(
  tournament: Doc<"tournaments">,
  pin: string,
  allow: readonly AccessRole[],
): Promise<{ role: AccessRole; rehash: string | null } | null> {
  for (const role of ["organiser", "referee"] as const) {
    const stored = hashForRole(tournament, role);
    if (!allow.includes(role) || stored === null) continue;
    const { ok, stale } = await verifyPin(pin, tournament.pinSalt, stored);
    if (ok) return { role, rehash: stale ? await derivePinHash(pin, tournament.pinSalt) : null };
  }
  return null;
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
