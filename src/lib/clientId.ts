/**
 * A random id this browser keeps for itself.
 *
 * It exists for one job: letting the server tell repeated wrong PINs from one
 * device apart from wrong PINs arriving from a hall full of people. It is not
 * a credential and it identifies nobody — it is a random number, stored beside
 * nothing else, sent only with a sign-in attempt.
 *
 * Anybody who wants to can clear it, which is exactly why the tournament-wide
 * lockout still sits underneath the per-device throttle it feeds.
 */

const KEY = "smashboard.client";

/** A 128-bit random id, hex-encoded. */
function mint(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The id for this browser, minting one on first use.
 *
 * Returns undefined when there is nowhere to keep it — a server render, or a
 * browser with storage switched off. The caller simply sends nothing, and the
 * server puts the attempt in its shared bucket.
 */
export function clientId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const minted = mint();
    window.localStorage.setItem(KEY, minted);
    return minted;
  } catch {
    return undefined;
  }
}
