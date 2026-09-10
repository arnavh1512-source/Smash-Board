/**
 * Organiser access control.
 *
 * A tournament is guarded by a PIN chosen when it is created. The PIN is never
 * stored; only a SHA-256 hash of `salt + pin` is kept. Repeated wrong guesses
 * lock the tournament out for a short window so the PIN cannot be brute forced
 * over the public API.
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

export function assertPinShape(pin: string): void {
  if (typeof pin !== "string" || pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
    throw new ConvexError(
      `Organiser PIN must be between ${MIN_PIN_LENGTH} and ${MAX_PIN_LENGTH} characters.`,
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

/**
 * Check the PIN for a tournament and return the document.
 * Throws a ConvexError the UI can show directly.
 */
export async function requireOrganiser(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  pin: string,
): Promise<Doc<"tournaments">> {
  const tournament = await loadTournament(ctx, tournamentId);
  const now = Date.now();

  if (tournament.pinLockedUntil && tournament.pinLockedUntil > now) {
    const minutes = Math.ceil((tournament.pinLockedUntil - now) / 60000);
    throw new ConvexError(
      `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  const candidate = await hashPin(pin ?? "", tournament.pinSalt);
  if (!timingSafeEqual(candidate, tournament.pinHash)) {
    const failed = (tournament.failedPinAttempts ?? 0) + 1;
    await ctx.db.patch(tournamentId, {
      failedPinAttempts: failed,
      pinLockedUntil: failed >= MAX_ATTEMPTS ? now + LOCKOUT_MS : undefined,
    });
    throw new ConvexError("Wrong organiser PIN.");
  }

  if (tournament.failedPinAttempts || tournament.pinLockedUntil) {
    await ctx.db.patch(tournamentId, { failedPinAttempts: 0, pinLockedUntil: undefined });
  }
  return tournament;
}

/** Strip the PIN hash before anything is sent to a browser. */
export function publicTournament(tournament: Doc<"tournaments">) {
  const { pinHash: _pinHash, pinSalt: _pinSalt, failedPinAttempts: _f, pinLockedUntil: _l, ...rest } =
    tournament;
  return rest;
}
