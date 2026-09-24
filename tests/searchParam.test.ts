import { describe, expect, it } from "vitest";
import { withSearchParam } from "@/lib/useSearchParam";

/** The address-bar half of useSearchParam: shared links must keep the rest of the URL. */

const BASE = "https://smash-board.vercel.app/t/club-open?tab=draw#top";

describe("withSearchParam", () => {
  it("adds a value and keeps the path, other params and hash", () => {
    const url = withSearchParam(BASE, "player", "e1");
    expect(url.pathname).toBe("/t/club-open");
    expect(url.searchParams.get("tab")).toBe("draw");
    expect(url.searchParams.get("player")).toBe("e1");
    expect(url.hash).toBe("#top");
  });

  it("replaces a value already there", () => {
    expect(withSearchParam(BASE, "tab", "courts").searchParams.getAll("tab")).toEqual(["courts"]);
  });

  it("removes the value when given null", () => {
    expect(withSearchParam(BASE, "tab", null).search).toBe("");
  });

  it("encodes values a name could contain", () => {
    expect(withSearchParam(BASE, "q", "A & B").search).toContain("q=A+%26+B");
  });
});
