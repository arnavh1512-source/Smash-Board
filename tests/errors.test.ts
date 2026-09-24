import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { GENERIC_ERROR, errorMessage } from "@/lib/errors";

describe("errorMessage", () => {
  it("shows the message a ConvexError was thrown with", () => {
    expect(errorMessage(new ConvexError("That PIN was not recognised."))).toBe(
      "That PIN was not recognised.",
    );
  });

  it("keeps the readable part of a ConvexError that arrives as text", () => {
    const error = new Error(
      "[CONVEX M(auth:signIn)] [Request ID: 1a2b] Server Error\nUncaught ConvexError: Too many attempts.\n    at handler",
    );
    expect(errorMessage(error)).toBe("Too many attempts.");
  });

  it("hides an internal server failure behind the generic message", () => {
    const error = new Error(
      "[CONVEX M(tournaments:create)] [Request ID: 9f8e] Server Error\nUncaught Error: SMASHBOARD_TOKEN_SECRET is not set",
    );
    expect(errorMessage(error)).toBe(GENERIC_ERROR);
  });

  it("hides a bare production Server Error", () => {
    expect(errorMessage(new Error("Server Error"))).toBe(GENERIC_ERROR);
    expect(errorMessage(new Error("[Request ID: 42] Server Error"))).toBe(GENERIC_ERROR);
  });

  it("shows the first line of a client-side error", () => {
    expect(errorMessage(new Error("Connection lost\nretrying"))).toBe("Connection lost");
  });

  it("falls back when there is nothing readable", () => {
    expect(errorMessage(new Error("   "))).toBe(GENERIC_ERROR);
    expect(errorMessage({ data: "" })).toBe(GENERIC_ERROR);
    expect(errorMessage({ data: { code: 1 } })).toBe(GENERIC_ERROR);
    expect(errorMessage("a string")).toBe(GENERIC_ERROR);
    expect(errorMessage(null)).toBe(GENERIC_ERROR);
  });
});
