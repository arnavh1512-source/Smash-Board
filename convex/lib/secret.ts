/**
 * The server-side half of the key that signs session tokens.
 *
 * Session tokens are a MAC over the tournament, the role, the expiry and the
 * role's PIN hash. That MAC used to be keyed on `tournament.pinSalt` alone —
 * but the salt lives in the same row as everything it protects, so anybody who
 * could read the tournament document could mint a valid organiser token for it
 * without ever knowing the PIN. A database read became a full compromise.
 *
 * Mixing in a secret that is only ever in the deployment's environment breaks
 * that: reading the row is no longer enough, because the other half of the key
 * is not in the database at all.
 *
 * Set it once per deployment, with at least 32 characters of randomness:
 *
 *   npx convex env set SMASHBOARD_TOKEN_SECRET "$(openssl rand -hex 32)"
 *   npx convex env set --prod SMASHBOARD_TOKEN_SECRET "$(openssl rand -hex 32)"
 *
 * Setting it for the first time, or rotating it, signs every issued token out:
 * every organiser and referee has to enter their PIN again. That is the correct
 * behaviour if it is ever exposed, but do it outside event hours.
 */

import { ConvexError } from "convex/values";

const MIN_SECRET_LENGTH = 32;

export function tokenSecret(): string {
  const secret = process.env.SMASHBOARD_TOKEN_SECRET;
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) {
    // A ConvexError, because production replaces a plain Error's message with
    // "Server Error" and the organiser would have nothing to pass on. It names
    // the variable and never anything about what the deployment currently holds.
    throw new ConvexError(
      "SMASHBOARD_TOKEN_SECRET is not set on this deployment, or is shorter than " +
        `${MIN_SECRET_LENGTH} characters. Sign-in is disabled until it is.`,
    );
  }
  return secret;
}
