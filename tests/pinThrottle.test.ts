import { describe, expect, it } from "vitest";
import {
  MAX_SOURCE_ID,
  TRUST_MS,
  nextTrustedRole,
  readSource,
  rolesThroughLock,
  sourceId,
  sourceKey,
  tournamentFailures,
  type SourceRecord,
} from "@/lib/pinThrottle";

/**
 * The clock-bound half of the sign-in throttle. The integration suite proves
 * the mutation applies these rules; it cannot wait thirty days to prove that
 * trust runs out, so that part is pinned down here.
 */

const QUIET_MS = 15 * 60 * 1000;
const NOW = 1_800_000_000_000;

function record(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return { failed: 2, contributed: 2, updatedAt: NOW - 60_000, ...overrides };
}

describe("sourceId", () => {
  it("trims the id a caller sent", () => {
    expect(sourceId("  phone-1 ")).toBe("phone-1");
  });

  it("treats a missing, blank or non-string id as no id", () => {
    expect(sourceId(undefined)).toBeNull();
    expect(sourceId("   ")).toBeNull();
    expect(sourceId(42)).toBeNull();
  });

  it("caps a padded id so the hash input stays bounded", () => {
    expect(sourceId("x".repeat(500))).toBe("x".repeat(MAX_SOURCE_ID));
  });
});

describe("sourceKey", () => {
  it("keeps a caller named 'anonymous' out of the shared bucket", () => {
    expect(sourceKey("anonymous")).not.toBe(sourceKey(null));
  });
});

describe("tournamentFailures", () => {
  it("carries the count while the tournament is unlocked or still locked", () => {
    expect(tournamentFailures(undefined, undefined, NOW)).toBe(0);
    expect(tournamentFailures(5, undefined, NOW)).toBe(5);
    expect(tournamentFailures(8, NOW + 1, NOW)).toBe(8);
  });

  it("starts again from zero once a lock has run out, so one typo cannot re-lock", () => {
    expect(tournamentFailures(8, NOW, NOW)).toBe(0);
    expect(tournamentFailures(9, NOW - 60_000, NOW)).toBe(0);
  });
});

describe("readSource", () => {
  it("gives a source with no record a clean, untrusted slate", () => {
    expect(readSource(null, NOW, QUIET_MS)).toEqual({ lockedFor: 0, trustedRole: null, spent: null });
  });

  it("counts recent failures against the source", () => {
    const row = record();
    expect(readSource(row, NOW, QUIET_MS).spent).toBe(row);
  });

  it("forgets failures after a quiet spell", () => {
    expect(readSource(record({ updatedAt: NOW - QUIET_MS }), NOW, QUIET_MS).spent).toBeNull();
  });

  it("reports the time left on a live lock, and a clean slate once it has run out", () => {
    const locked = readSource(record({ lockedUntil: NOW + 90_000 }), NOW, QUIET_MS);
    expect(locked.lockedFor).toBe(90_000);
    expect(locked.spent).toBeNull();

    const expired = readSource(record({ lockedUntil: NOW - 1 }), NOW, QUIET_MS);
    expect(expired).toMatchObject({ lockedFor: 0, spent: null });
  });

  it("trusts a device that signed in, until the trust runs out", () => {
    const signedIn = NOW - 1_000;
    const row = record({
      failed: 0,
      contributed: 0,
      trustedUntil: signedIn + TRUST_MS,
      trustedRole: "organiser",
    });
    expect(readSource(row, NOW, QUIET_MS).trustedRole).toBe("organiser");
    expect(readSource(row, signedIn + TRUST_MS - 1, QUIET_MS).trustedRole).toBe("organiser");
    expect(readSource(row, signedIn + TRUST_MS, QUIET_MS).trustedRole).toBeNull();
  });

  it("reads trust written before roles existed as the narrower referee trust", () => {
    const row = record({ trustedUntil: NOW + TRUST_MS });
    expect(readSource(row, NOW, QUIET_MS).trustedRole).toBe("referee");
  });

  it("keeps a trusted device subject to its own lock", () => {
    const row = record({
      lockedUntil: NOW + 60_000,
      trustedUntil: NOW + TRUST_MS,
      trustedRole: "referee",
    });
    expect(readSource(row, NOW, QUIET_MS)).toMatchObject({
      lockedFor: 60_000,
      trustedRole: "referee",
    });
  });

  it("covers a tournament weekend with room to spare", () => {
    expect(TRUST_MS).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
});

describe("rolesThroughLock", () => {
  const both = ["organiser", "referee"] as const;

  it("lets organiser trust try either PIN", () => {
    expect(rolesThroughLock(both, "organiser")).toEqual(["organiser", "referee"]);
    expect(rolesThroughLock(["organiser"], "organiser")).toEqual(["organiser"]);
  });

  it("keeps a referee phone away from the organiser PIN while locked", () => {
    expect(rolesThroughLock(both, "referee")).toEqual(["referee"]);
    expect(rolesThroughLock(["organiser"], "referee")).toEqual([]);
  });

  it("lets a stranger try nothing", () => {
    expect(rolesThroughLock(both, null)).toEqual([]);
  });
});

describe("nextTrustedRole", () => {
  it("remembers the PIN a new device got right", () => {
    expect(nextTrustedRole(null, "referee")).toBe("referee");
    expect(nextTrustedRole(null, "organiser")).toBe("organiser");
  });

  it("promotes a referee phone that later signs in as organiser", () => {
    expect(nextTrustedRole("referee", "organiser")).toBe("organiser");
  });

  it("never demotes an organiser phone that signs in as referee", () => {
    expect(nextTrustedRole("organiser", "referee")).toBe("organiser");
  });
});
