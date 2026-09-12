/**
 * Unbiased random integers, for the one place in the product where fairness is
 * the whole point: the draw.
 */

/** The number of distinct values `crypto.getRandomValues` puts in a Uint32. */
const RANGE = 0x1_0000_0000;

/**
 * A uniform random integer in [0, bound), from the runtime's cryptographic RNG.
 *
 * Taking `random % bound` directly is very slightly biased: 2^32 is not a
 * multiple of most bounds, so the first `2^32 % bound` results come out of one
 * more source value than the rest. The bias is far too small to change who
 * plays whom, but the draw is advertised as cryptographically randomised, and a
 * draw is the one thing in a tournament that has to be defensible when somebody
 * asks how the top two seeds ended up in the same half.
 *
 * So the tail of the range that does not divide evenly is discarded and the
 * value redrawn. The loop is unbounded in principle and finishes at once in
 * practice: at most one value in `2^32 / bound` is ever rejected, and for the
 * 256 entrants a category can hold that is under one draw in sixteen million.
 */
export function randomBelow(bound: number): number {
  if (!Number.isInteger(bound) || bound < 1) {
    throw new RangeError("randomBelow needs a positive whole bound.");
  }
  if (bound === 1) return 0;
  const limit = Math.floor(RANGE / bound) * bound;
  const bytes = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(bytes);
    if (bytes[0] < limit) return bytes[0] % bound;
  }
}
