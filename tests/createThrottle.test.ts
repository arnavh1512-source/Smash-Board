import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_CREATE_LIMIT,
  CREATE_LIMIT,
  CREATE_WINDOW_MS,
  createLimitFor,
  GLOBAL_CREATE_KEY,
  GLOBAL_CREATE_LIMIT,
  createLimitMessage,
  globalCreateLimitMessage,
  readCreateSource,
} from "@/lib/createThrottle";
import { sourceKey } from "@/lib/pinThrottle";

/**
 * The clock half of the tournament-creation throttle. The mutation stores what
 * this returns; these tests prove the window rolls over and the wait is honest.
 */

const NOW = 1_800_000_000_000;

describe("createLimitFor", () => {
  it("gives a device that sent an id the tight limit", () => {
    expect(createLimitFor("phone-1")).toBe(CREATE_LIMIT);
  });

  it("gives callers with no id a shared, looser limit", () => {
    expect(createLimitFor(null)).toBe(ANONYMOUS_CREATE_LIMIT);
  });
});

describe("readCreateSource", () => {
  it("opens a fresh window for a first-time source", () => {
    expect(readCreateSource(null, NOW, CREATE_LIMIT)).toEqual({
      allowed: true,
      retryAfter: 0,
      windowStart: NOW,
      count: 1,
    });
  });

  it("counts on within an open window", () => {
    const record = { windowStart: NOW - 60_000, count: 2 };
    expect(readCreateSource(record, NOW, CREATE_LIMIT)).toMatchObject({
      allowed: true,
      windowStart: NOW - 60_000,
      count: 3,
    });
  });

  it("refuses once the window's allowance is spent, and says how long to wait", () => {
    const record = { windowStart: NOW - 10 * 60_000, count: CREATE_LIMIT };
    expect(readCreateSource(record, NOW, CREATE_LIMIT)).toEqual({
      allowed: false,
      retryAfter: CREATE_WINDOW_MS - 10 * 60_000,
      windowStart: NOW - 10 * 60_000,
      count: CREATE_LIMIT,
    });
  });

  it("starts over once the window has run out, however much was spent", () => {
    const record = { windowStart: NOW - CREATE_WINDOW_MS, count: CREATE_LIMIT };
    expect(readCreateSource(record, NOW, CREATE_LIMIT)).toMatchObject({
      allowed: true,
      windowStart: NOW,
      count: 1,
    });
  });
});

describe("createLimitMessage", () => {
  it("rounds the wait up to whole minutes", () => {
    expect(createLimitMessage(10 * 60_000 + 1)).toContain("11 minutes");
  });

  it("never says zero minutes", () => {
    expect(createLimitMessage(0)).toContain("1 minute,");
  });

  it("uses the singular for one minute", () => {
    expect(createLimitMessage(60_000)).toMatch(/in 1 minute, or/);
  });

  it("points people who genuinely need more at a human", () => {
    expect(createLimitMessage(60_000)).toContain("WhatsApp");
  });
});

describe("the site-wide ceiling", () => {
  it("sits well above one source's allowance", () => {
    expect(GLOBAL_CREATE_LIMIT).toBeGreaterThan(ANONYMOUS_CREATE_LIMIT);
  });

  it("is counted under a key no source can claim", () => {
    expect(sourceKey(GLOBAL_CREATE_KEY)).not.toBe(GLOBAL_CREATE_KEY);
    expect(sourceKey(null)).not.toBe(GLOBAL_CREATE_KEY);
  });

  it("tells everybody how long to wait, in whole minutes", () => {
    expect(globalCreateLimitMessage(61_000)).toContain("2 minutes");
    expect(globalCreateLimitMessage(1)).toContain("1 minute,");
  });
});
