import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenSecret } from "../convex/lib/secret";

describe("tokenSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to sign anything when the secret is missing", () => {
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", undefined);
    expect(() => tokenSecret()).toThrow(/SMASHBOARD_TOKEN_SECRET/);
  });

  it("refuses a secret too short to be worth having", () => {
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", "a".repeat(31));
    expect(() => tokenSecret()).toThrow(/32 characters/);
  });

  it("never echoes what the deployment currently holds", () => {
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", "short-but-private");
    expect(() => tokenSecret()).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("short-but-private") }),
    );
  });

  it("returns a secret of 32 characters or more", () => {
    const secret = "f".repeat(64);
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", secret);
    expect(tokenSecret()).toBe(secret);
  });
});
