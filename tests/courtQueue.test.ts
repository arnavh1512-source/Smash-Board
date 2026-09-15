import { describe, expect, it } from "vitest";
import { courtQueue, courtsInUse, type QueuedMatch } from "@/lib/courtQueue";

type M = QueuedMatch & { id: string };

const m = (id: string, overrides: Partial<M> = {}): M => ({
  id,
  court: "Court 1",
  status: "scheduled",
  ...overrides,
});

const ids = (matches: readonly M[]) => matches.map((match) => match.id);

describe("courtsInUse", () => {
  it("lists each court once, in the order a person counts them", () => {
    const courts = courtsInUse([
      m("a", { court: "Court 10" }),
      m("b", { court: "Court 2" }),
      m("c", { court: " Court 2 " }),
      m("d", { court: "Court 1" }),
    ]);
    expect(courts).toEqual(["Court 1", "Court 2", "Court 10"]);
  });

  it("leaves out matches with no court, a blank court, or a cancelled booking", () => {
    expect(
      courtsInUse([
        m("a", { court: undefined }),
        m("b", { court: "   " }),
        m("c", { court: "Court 3", status: "cancelled" }),
      ]),
    ).toEqual([]);
  });
});

describe("courtQueue", () => {
  it("calls matches in the planner's order, not the order they were stored in", () => {
    const queue = courtQueue(
      [m("late", { scheduleOffset: 60 }), m("early", { scheduleOffset: 0 }), m("mid", { scheduleOffset: 30 })],
      "Court 1",
    );
    expect(queue.now?.id).toBe("early");
    expect(ids(queue.upNext)).toEqual(["mid", "late"]);
  });

  it("puts the live match on court ahead of one the timetable says is due", () => {
    const queue = courtQueue(
      [m("due", { scheduleOffset: 0 }), m("running", { scheduleOffset: 30, status: "live" })],
      "Court 1",
    );
    expect(queue.now?.id).toBe("running");
    expect(ids(queue.upNext)).toEqual(["due"]);
  });

  it("falls back to the written time for a court typed in by hand, and sends untimed matches last", () => {
    const queue = courtQueue(
      [
        m("untimed"),
        m("afternoon", { scheduledAt: "2026-09-20T14:00" }),
        m("morning", { scheduledAt: "2026-09-20T09:30" }),
      ],
      "Court 1",
    );
    expect(queue.now?.id).toBe("morning");
    expect(ids(queue.upNext)).toEqual(["afternoon", "untimed"]);
  });

  it("keeps finished and conceded matches apart, the most recent first", () => {
    const queue = courtQueue(
      [
        m("first", { scheduleOffset: 0, status: "completed" }),
        m("second", { scheduleOffset: 30, status: "walkover" }),
        m("third", { scheduleOffset: 60 }),
        m("off", { scheduleOffset: 90, status: "cancelled" }),
      ],
      "Court 1",
    );
    expect(queue.now?.id).toBe("third");
    expect(queue.upNext).toEqual([]);
    expect(ids(queue.finished)).toEqual(["second", "first"]);
  });

  it("shows only the court asked for, matching a court name with stray spaces", () => {
    const queue = courtQueue(
      [m("here", { court: "Court 2 " }), m("elsewhere", { court: "Court 1" })],
      "Court 2",
    );
    expect(queue.now?.id).toBe("here");
    expect(queue.upNext).toEqual([]);
  });

  it("has nothing on court once every match there is played", () => {
    const queue = courtQueue([m("done", { status: "completed" })], "Court 1");
    expect(queue.now).toBeNull();
    expect(queue.upNext).toEqual([]);
    expect(ids(queue.finished)).toEqual(["done"]);
  });
});
