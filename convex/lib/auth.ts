/**
 * Access control.
 *
 * A tournament is guarded by a PIN chosen when it is created. The PIN is never
 * stored; only a SHA-256 hash of `salt + pin` is kept. Repeated wrong guesses
 * lock the tournament out for a short window so the PIN cannot be brute forced
 * over the public API.
 *
 * An organiser may also set a second, optional referee PIN. It unlocks score
 * entry and nothing else, so an umpire can be handed a phone without also being
 * handed the power to redraw the event or delete it.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 10 * 60 * 1000;

export const MIN_PIN_LENGTH = 4;
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

/**
 * Check a PIN against a tournament.
 *
 * `allow` names the roles whose PIN will be accepted. The failure counter is
 * shared across both PINs on purpose: the lockout protects the tournament, and
 * a guesser should not get a fresh eight tries by switching which PIN they
 * claim to be entering.
 */
async function verifyPinFor(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  pin: string,
  allow: readonly AccessRole[],
): Promise<{ tournament: Doc<"tournaments">; role: AccessRole }> {
  const tournament = await loadTournament(ctx, tournamentId);
  const now = Date.now();

  if (tournament.pinLockedUntil && tournament.pinLockedUntil > now) {
    const minutes = Math.ceil((tournament.pinLockedUntil - now) / 60000);
    throw new ConvexError(
      `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  const candidate = await hashPin(pin ?? "", tournament.pinSalt);
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
    const failed = (tournament.failedPinAttempts ?? 0) + 1;
    await ctx.db.patch(tournamentId, {
      failedPinAttempts: failed,
      pinLockedUntil: failed >= MAX_ATTEMPTS ? now + LOCKOUT_MS : undefined,
    });
    throw new ConvexError(
      allow.includes("referee") && allow.includes("organiser")
        ? "That PIN was not recognised."
        : "Wrong organiser PIN.",
    );
  }

  if (tournament.failedPinAttempts || tournament.pinLockedUntil) {
    await ctx.db.patch(tournamentId, { failedPinAttempts: 0, pinLockedUntil: undefined });
  }
  return { tournament, role: matched };
}

/**
 * Require the organiser PIN. Throws a ConvexError the UI can show directly.
 */
export async function requireOrganiser(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  pin: string,
): Promise<Doc<"tournaments">> {
  const { tournament } = await verifyPinFor(ctx, tournamentId, pin, ["organiser"]);
  return tournament;
}

/**
 * Require a PIN that is allowed to enter scores: either the organiser's, or the
 * referee PIN when the organiser has set one.
 */
export async function requireScorer(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  pin: string,
): Promise<{ tournament: Doc<"tournaments">; role: AccessRole }> {
  return await verifyPinFor(ctx, tournamentId, pin, ["organiser", "referee"]);
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
  return { ...rest, hasRefereePin: _refereePinHash !== undefined };
}
