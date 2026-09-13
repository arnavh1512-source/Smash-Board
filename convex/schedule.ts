import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrganiser } from "./lib/auth";
import {
  ScheduleError,
  courtName,
  endDateOverrun,
  hallLoad,
  parseClockTime,
  planSchedule,
  scheduleBasis,
  toClockTime,
  type PlannerMatch,
} from "../src/lib/schedule";
import { personKey } from "../src/lib/identity";
import { totalKnockoutRounds } from "./lib/progression";

/**
 * Building the order of play.
 *
 * The arithmetic lives in `src/lib/schedule.ts` as a pure function; this file
 * only turns the stored draw into that function's input and writes the answer
 * back onto the matches. Doing it that way keeps the interesting part testable
 * without a database.
 */

/**
 * Matches that need no court from a new plan: byes, walkovers awarded without
 * play, no contests where both sides withdrew, and matches already played.
 * They still hold their place in the bracket, so they are kept in the ordering
 * and simply given no time slot.
 *
 * A finished match is here because an organiser may regenerate once play has
 * begun, and a plan made then is a plan for the matches still to be played.
 * Booking a court for a result already on the board would waste that court,
 * and it would also count the match's players as busy, pushing their next
 * match back for a rest they have already had. Nothing records when a match
 * actually finished — `updatedAt` moves with every correction — so the plan
 * does not pretend to know; it simply leaves the played match out.
 */
const EMPTY_LABELS = new Set(["BYE", "Withdrawn"]);

function needsNoCourt(match: Doc<"matches">): boolean {
  if (match.status === "completed") return true;
  if (match.status === "walkover" || match.status === "cancelled") return true;
  const aEmpty = match.aId === null && (match.aLabel === null || EMPTY_LABELS.has(match.aLabel));
  const bEmpty = match.bId === null && (match.bLabel === null || EMPTY_LABELS.has(match.bLabel));
  return aEmpty || bEmpty;
}

/**
 * Which matches must finish before this one can start.
 *
 * Knockout rounds are linked by position — (round r, slot s) is fed by
 * (r - 1, 2s) and (r - 1, 2s + 1) — and the third-place playoff is fed by both
 * semi-finals. The first knockout round of a group event waits for the whole
 * group stage, because until the tables are final nobody knows who is in it.
 */
function feedersFor(
  match: Doc<"matches">,
  eventMatches: readonly Doc<"matches">[],
  groupMatchIds: readonly Id<"matches">[],
): Id<"matches">[] {
  if (match.stage === "group") return [];

  const knockout = eventMatches.filter((m) => m.stage === "knockout");
  const totalRounds = totalKnockoutRounds([...eventMatches]);

  if (match.isThirdPlace) {
    return knockout
      .filter((m) => !m.isThirdPlace && m.round === totalRounds - 2)
      .map((m) => m._id);
  }

  if (match.round === 0) return [...groupMatchIds];

  return knockout
    .filter(
      (m) =>
        !m.isThirdPlace &&
        m.round === match.round - 1 &&
        (m.slot === match.slot * 2 || m.slot === match.slot * 2 + 1),
    )
    .map((m) => m._id);
}

/**
 * Everything the planner reads, in the shape the planner reads it.
 *
 * Shared by the generator and by the staleness check, so the fingerprint is
 * taken over exactly the input the plan was built from rather than over a
 * second, drifting description of it.
 */
async function plannerInput(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<{ matches: Doc<"matches">[]; planner: PlannerMatch[] }> {
  const events = await ctx.db
    .query("events")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  const matches = await ctx.db
    .query("matches")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  const entries = await ctx.db
    .query("entries")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();

  // One entry can hold two people, and one person can hold several entries
  // across the categories. The planner owes its rest to the people.
  const peopleOf = new Map<Id<"entries">, string[]>(
    entries.map((entry) => [
      entry._id,
      [entry.playerOne, entry.playerTwo]
        .filter((name): name is string => typeof name === "string" && name.trim() !== "")
        .map(personKey),
    ]),
  );

  const orderOf = new Map(events.map((event) => [event._id, event.order] as const));
  const byEvent = new Map<Id<"events">, Doc<"matches">[]>();
  for (const match of matches) {
    const list = byEvent.get(match.eventId) ?? [];
    list.push(match);
    byEvent.set(match.eventId, list);
  }

  const planner: PlannerMatch[] = matches.map((match) => {
    const eventMatches = byEvent.get(match.eventId) ?? [];
    const groupMatchIds = eventMatches.filter((m) => m.stage === "group").map((m) => m._id);
    const sides = [match.aId, match.bId]
      .filter((id): id is Id<"entries"> => id !== null)
      .flatMap((id) => peopleOf.get(id) ?? [id as string]);
    return {
      id: match._id,
      eventId: match.eventId,
      eventOrder: orderOf.get(match.eventId) ?? 0,
      // Group matches all sit at round 0 of their event; knockout rounds
      // follow the group stage, so they are pushed past it.
      round: match.stage === "group" ? match.round : match.round + 1000,
      slot: match.slot,
      sides,
      feeders: feedersFor(match, eventMatches, groupMatchIds),
      skip: needsNoCourt(match),
    };
  });

  return { matches, planner };
}

/**
 * Whether a generated order of play still matches the tournament it was built
 * from. Public: a spectator looking at an out-of-date timetable is the person
 * this warning is for.
 */
export const status = query({
  args: { tournamentId: v.id("tournaments") },
  returns: v.union(
    v.null(),
    v.object({ generatedAt: v.union(v.number(), v.null()), stale: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament?.schedule) return null;
    const { planner } = await plannerInput(ctx, args.tournamentId);
    const basis = scheduleBasis(tournament.startDate ?? "", tournament.endDate, planner);
    return {
      generatedAt: tournament.schedule.generatedAt,
      // A plan made before this check existed carries no fingerprint. It cannot
      // be shown to be current, so it is reported as needing a regeneration.
      stale: tournament.schedule.basis !== basis,
    };
  },
});

export const generate = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    token: v.string(),
    dayStart: v.string(),
    matchMinutes: v.number(),
    restMinutes: v.number(),
    courts: v.number(),
    categoriesAtOnce: v.number(),
  },
  returns: v.object({
    scheduled: v.number(),
    lastFinish: v.string(),
    peakInHall: v.number(),
  }),
  handler: async (ctx, args) => {
    const tournament = await requireOrganiser(ctx, args.tournamentId, args.token);
    if (!tournament.startDate) {
      throw new ConvexError("Set the tournament start date before planning the order of play.");
    }

    const { matches, planner } = await plannerInput(ctx, args.tournamentId);
    if (matches.length === 0) {
      throw new ConvexError("Generate a draw first — there is nothing to schedule yet.");
    }

    let slots;
    try {
      // Validates the numbers too, and throws a message worth showing.
      parseClockTime(args.dayStart);
      slots = planSchedule(planner, {
        matchMinutes: args.matchMinutes,
        restMinutes: args.restMinutes,
        courts: args.courts,
        categoriesAtOnce: args.categoriesAtOnce,
      });
    } catch (error) {
      if (error instanceof ScheduleError) throw new ConvexError(error.message);
      throw error;
    }

    // The whole plan has to fit inside the dates the organiser booked the hall
    // for. Checked here, on the finished plan and before the first patch, so a
    // tournament that does not fit is refused outright rather than half
    // written into the matches and discovered on the timetable afterwards.
    const lastEnd = slots.reduce((latest, slot) => Math.max(latest, slot.endMinute), 0);
    const overrun = endDateOverrun(
      tournament.startDate,
      tournament.endDate,
      args.dayStart,
      lastEnd,
    );
    if (overrun) throw new ConvexError(overrun);

    const now = Date.now();
    const placed = new Set<string>();
    for (const slot of slots) {
      placed.add(slot.matchId);
      await ctx.db.patch(slot.matchId as Id<"matches">, {
        scheduledAt: toClockTime(tournament.startDate, args.dayStart, slot.startMinute),
        scheduleOffset: slot.startMinute,
        court: courtName(slot.court),
        updatedAt: now,
      });
    }

    // Matches that took no slot in this plan - byes, walkovers, and matches
    // already played - must not keep a time from an earlier one, or the new
    // timetable would show them on a court the plan has just given to somebody
    // else.
    for (const match of matches) {
      if (placed.has(match._id)) continue;
      if (match.scheduledAt === undefined && match.scheduleOffset === undefined) continue;
      await ctx.db.patch(match._id, {
        scheduledAt: undefined,
        scheduleOffset: undefined,
        court: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.tournamentId, {
      schedule: {
        dayStart: args.dayStart,
        matchMinutes: args.matchMinutes,
        restMinutes: args.restMinutes,
        courts: args.courts,
        categoriesAtOnce: args.categoriesAtOnce,
        generatedAt: now,
        basis: scheduleBasis(tournament.startDate, tournament.endDate, planner),
      },
      updatedAt: now,
    });

    return {
      scheduled: slots.length,
      lastFinish: toClockTime(tournament.startDate, args.dayStart, lastEnd),
      // Reported so the organiser can hold the number against the seats and
      // the door, and lower the category limit if the hall cannot take it.
      peakInHall: hallLoad(planner, slots).peak,
    };
  },
});

export const clear = mutation({
  args: { tournamentId: v.id("tournaments"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganiser(ctx, args.tournamentId, args.token);
    const matches = await ctx.db
      .query("matches")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .collect();
    const now = Date.now();
    for (const match of matches) {
      if (match.scheduledAt === undefined && match.scheduleOffset === undefined) continue;
      await ctx.db.patch(match._id, {
        scheduledAt: undefined,
        scheduleOffset: undefined,
        court: undefined,
        updatedAt: now,
      });
    }
    await ctx.db.patch(args.tournamentId, { schedule: undefined, updatedAt: now });
    return null;
  },
});
