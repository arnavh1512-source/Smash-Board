import { describe, expect, it, vi, afterEach } from "vitest";
import { randomBelow } from "@/lib/random";

/**
 * The draw's randomness is advertised as cryptographic, so it is tested as
 * such: the modulo the shuffle used to do is uniform only when the bound
 * divides 2^32, and every bound a badminton draw actually uses is odd-shaped.
 */
describe("randomBelow", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Feed the generator a fixed queue of 32-bit values, in order. */
  const feed = (values: number[]) => {
    let index = 0;
    vi.stubGlobal("crypto", {
      ...crypto,
      getRandomValues: (array: Uint32Array) => {
        array[0] = values[Math.min(index++, values.length - 1)];
        return array;
      },
    });
  };

  it("stays inside the bound", () => {
    for (const bound of [1, 2, 3, 7, 16, 255, 256]) {
      for (let draw = 0; draw < 200; draw++) {
        const value = randomBelow(bound);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(bound);
      }
    }
  });

  it("discards the values that would make one seat more likely than another", () => {
    // 2^32 is not a multiple of 3: the largest multiple below it is
    // 4294967295, so 4294967295 itself is out of the fair range and has to be
    // thrown away rather than folded onto 0.
    feed([4294967295, 4294967294, 5]);
    expect(randomBelow(3)).toBe(4294967294 % 3);
    // The next call starts from the value after the one that was accepted.
    expect(randomBelow(3)).toBe(5 % 3);
  });

  it("takes the first value when the bound divides the range evenly", () => {
    // A power of two never rejects anything: 2^32 is a multiple of 16.
    feed([4294967295]);
    expect(randomBelow(16)).toBe(15);
  });

  it("answers a bound of one without asking for randomness at all", () => {
    vi.stubGlobal("crypto", {
      ...crypto,
      getRandomValues: () => {
        throw new Error("a bound of one has only one answer");
      },
    });
    expect(randomBelow(1)).toBe(0);
  });

  it("refuses a bound that is not a positive whole number", () => {
    expect(() => randomBelow(0)).toThrow(RangeError);
    expect(() => randomBelow(-4)).toThrow(RangeError);
    expect(() => randomBelow(2.5)).toThrow(RangeError);
  });

  it("covers every seat, which a badly biased generator would not", () => {
    const seen = new Set<number>();
    for (let draw = 0; draw < 2000; draw++) seen.add(randomBelow(8));
    expect(seen.size).toBe(8);
  });
});
