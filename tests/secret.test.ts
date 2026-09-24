import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_IN_UNAVAILABLE, tokenSecret } from "../convex/lib/secret";

describe("tokenSecret", () => {
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    logged.mockRestore();
  });

  it("refuses to sign anything when the secret is missing", () => {
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", undefined);
    expect(() => tokenSecret()).toThrow();
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/SMASHBOARD_TOKEN_SECRET/));
  });

  it("refuses a secret too short to be worth having", () => {
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", "a".repeat(31));
    expect(() => tokenSecret()).toThrow();
    expect(logged).toHaveBeenCalledWith(expect.stringMatching(/32 characters/));
  });

  it("tells the visitor sign-in is unavailable without naming the configuration", () => {
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", undefined);
    let thrown: unknown;
    try {
      tokenSecret();
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { data: unknown }).data).toBe(SIGN_IN_UNAVAILABLE);
    expect(SIGN_IN_UNAVAILABLE).not.toMatch(/SMASHBOARD|secret|characters/i);
  });

  it("never echoes what the deployment currently holds", () => {
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", "short-but-private");
    expect(() => tokenSecret()).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("short-but-private") }),
    );
    expect(logged).not.toHaveBeenCalledWith(expect.stringContaining("short-but-private"));
  });

  it("returns a secret of 32 characters or more", () => {
    const secret = "f".repeat(64);
    vi.stubEnv("SMASHBOARD_TOKEN_SECRET", secret);
    expect(tokenSecret()).toBe(secret);
    expect(logged).not.toHaveBeenCalled();
  });
});
