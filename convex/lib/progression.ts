/**
 * Moving winners through a draw.
 *
 * Knockout matches are linked by position rather than by stored pointers:
 * the winner of (round r, slot s) plays in (round r + 1, slot floor(s / 2)),
 * on side A for even slots and side B for odd ones. Keeping the link implicit
 * means a redraw never leaves stale references behind.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { computeStandings } from "../../src/lib/standings";
import { entryName } from "../../src/lib/display";
import { knockoutFeed, knockoutRoundName } from "../../src/lib/draw";
import { evaluateMatch, type ScoringConfig } from "../../src/lib/scoring";

export function totalKnockoutRounds(matches: Doc<"matches">[]): number {
  const knockout = matches.filter((m) => m.stage === "knockout" && !m.isThirdPlace);
  if (knockout.length === 0) return 0;
  return Math.max(...knockout.map((m) => m.round)) + 1;
}

async function knockoutMatches(ctx: MutationCtx, eventId: Id<"events">) {
  return await ctx.db
    .query("matches")
    .withIndex("by_event_stage", (q) => q.eq("eventId", eventId).eq("stage", "knockout"))
    .collect();
}

/** How a group qualifier slot is labelled at draw time, e.g. "1st in Group A". */
const QUALIFIER_LABEL = /^\d+(?:st|nd|rd|th) in Group [A-Z]+$/;

/**
 * Push the winner of one knockout match into the next round, and the loser
 * into the third-place playoff when the match was a semi-final.
 */
export async function advanceKnockout(
  ctx: MutationCtx,
  match: Doc<"matches">,
  winnerId: Id<"entries"> | null,
): Promise<void> {
  if (match.stage !== "knockout" || match.isThirdPlace) return;

  const all = await knockoutMatches(ctx, match.eventId);
  const totalRounds = totalKnockoutRounds(all);
  const isSemiFinal = match.round === totalRounds - 2;
  const loserId =
    winnerId === null ? null : match.aId === winnerId ? match.bId : match.aId;

  if (isSemiFinal) {
    const playoff = all.find((m) => m.isThirdPlace);
    if (playoff) {
      const side = match.slot === 0 ? "a" : "b";
      await ctx.db.patch(playoff._id, {
        [`${side}Id`]: loserId,
        [`${side}Label`]: loserId ? null : `Loser of Semi-final ${match.slot + 1}`,
        updatedAt: Date.now(),
      });
    }
  }

  const feed = knockoutFeed(match.round, match.slot, totalRounds);
  if (!feed) return;
  const { round: nextRound, slot: nextSlot, side } = feed;
  const next = all.find(
    (m) => !m.isThirdPlace && m.round === nextRound && m.slot === nextSlot,
  );
  if (!next) return;

  // Replacing an entrant already sitting in the next slot means an earlier
  // result was edited; any score played under the old pairing is no longer
  // valid, so it is cleared rather than silently kept.
  const current = side === "a" ? next.aId : next.bId;
  const changed = current !== winnerId;
  const patch: Record<string, unknown> = {
    [`${side}Id`]: winnerId,
    [`${side}Label`]: winnerId
      ? null
      : `Winner of ${knockoutRoundName(match.round, totalRounds)} ${match.slot + 1}`,
    updatedAt: Date.now(),
  };

  if (changed && (next.sets.length > 0 || next.winnerId)) {
    patch.sets = [];
    patch.winnerId = null;
    patch.status = "scheduled";
    await ctx.db.patch(next._id, patch);
    // The change ripples forward: whoever was in later rounds must come out.
    await advanceKnockout(ctx, { ...next, ...(patch as object) } as Doc<"matches">, null);
    return;
  }

  await ctx.db.patch(next._id, patch);
}

/**
 * Resolve first-round byes: a match with exactly one entrant is marked as a
 * walkover and its entrant moves straight into the next round.
 */
export async function resolveByes(ctx: MutationCtx, eventId: Id<"events">): Promise<void> {
  const all = await knockoutMatches(ctx, eventId);
  for (const match of all) {
    if (match.round !== 0 || match.status !== "scheduled") continue;
    const hasA = match.aId !== null;
    const hasB = match.bId !== null;
    if (hasA === hasB) continue;
    const winnerId = (hasA ? match.aId : match.bId) as Id<"entries">;
    await ctx.db.patch(match._id, {
      status: "walkover",
      winnerId,
      updatedAt: Date.now(),
    });
    await advanceKnockout(ctx, { ...match, winnerId }, winnerId);
  }
}

/**
 * Once every group match is played, seed the knockout from the group tables.
 * Qualifier slots were labelled at draw time ("1st in Group A"), so this fills
 * whichever label matches each finishing position.
 */
export async function fillKnockoutFromGroups(
  ctx: MutationCtx,
  event: Doc<"events">,
): Promise<boolean> {
  const groupMatches = await ctx.db
    .query("matches")
    .withIndex("by_event_stage", (q) => q.eq("eventId", event._id).eq("stage", "group"))
    .collect();
  if (groupMatches.length === 0) return false;

  const unfinished = groupMatches.some(
    (m) => m.status !== "completed" && m.status !== "walkover",
  );
  if (unfinished) return false;

  const entries = await ctx.db
    .query("entries")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
    .collect();
  const nameOf = (id: string) => entryName(entries.find((e) => e._id === id));

  const groupIndexes = [...new Set(groupMatches.map((m) => m.groupIndex ?? 0))].sort(
    (a, b) => a - b,
  );

  /** Group letter -> finishing order of entrant ids. */
  const placings = new Map<number, string[]>();
  for (const groupIndex of groupIndexes) {
    const inGroup = groupMatches.filter((m) => (m.groupIndex ?? 0) === groupIndex);
    const ids = [
      ...new Set(
        inGroup.flatMap((m) => [m.aId, m.bId]).filter((id): id is Id<"entries"> => id !== null),
      ),
    ];
    const table = computeStandings(
      ids,
      inGroup.map((m) => ({
        aId: m.aId,
        bId: m.bId,
        sets: m.sets,
        status: m.status,
        walkoverWinnerId: m.winnerId,
      })),
      event.scoring as ScoringConfig,
      nameOf,
    );
    placings.set(
      groupIndex,
      table.map((row) => row.entryId),
    );
  }

  const knockout = await knockoutMatches(ctx, event._id);
  const firstRound = knockout.filter((m) => m.round === 0 && !m.isThirdPlace);
  if (firstRound.length === 0) return false;

  const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
  const lookup = new Map<string, Id<"entries">>();
  for (const [groupIndex, ids] of placings) {
    const letter = String.fromCharCode(65 + groupIndex);
    ids.forEach((id, position) => {
      lookup.set(`${ordinal(position + 1)} in Group ${letter}`, id as Id<"entries">);
    });
  }

  let filled = false;
  for (const match of firstRound) {
    const patch: Record<string, unknown> = {};
    // The label stays: it is how `clearGroupQualifiers` finds the slot again if
    // a group result is edited afterwards, and the UI shows the entrant's name
    // in preference to it as soon as the slot is filled.
    if (match.aLabel && lookup.has(match.aLabel) && match.aId !== lookup.get(match.aLabel)) {
      patch.aId = lookup.get(match.aLabel);
    }
    if (match.bLabel && lookup.has(match.bLabel) && match.bId !== lookup.get(match.bLabel)) {
      patch.bId = lookup.get(match.bLabel);
    }
    if (Object.keys(patch).length === 0) continue;

    // A qualifier changing means the group table was edited after the knockout
    // had already started; anything played under the old pairing is void.
    if (match.sets.length > 0 || match.winnerId) {
      patch.sets = [];
      patch.winnerId = null;
      patch.status = "scheduled";
    }
    await ctx.db.patch(match._id, { ...patch, updatedAt: Date.now() });
    await advanceKnockout(ctx, { ...match, ...patch } as Doc<"matches">, null);
    filled = true;
  }

  if (filled) await resolveByes(ctx, event._id);
  return filled;
}

/** Recompute a match's winner from its sets under the event's scoring rules. */
export function winnerFromSets(
  match: Pick<Doc<"matches">, "aId" | "bId" | "sets">,
  scoring: ScoringConfig,
): Id<"entries"> | null {
  const outcome = evaluateMatch(match.sets, scoring);
  if (!outcome.winner) return null;
  return outcome.winner === "a" ? match.aId : match.bId;
}

/**
 * Empty every knockout slot that was filled from a group table.
 *
 * Called whenever a group result changes: the finishing order may be different
 * now, so any qualifier already sitting in the knockout — and any result played
 * under the old pairing — has to come out before the table is read again.
 */
export async function clearGroupQualifiers(
  ctx: MutationCtx,
  event: Doc<"events">,
): Promise<void> {
  const knockout = await knockoutMatches(ctx, event._id);
  for (const match of knockout) {
    if (match.round !== 0 || match.isThirdPlace) continue;
    const patch: Record<string, unknown> = {};
    if (match.aId !== null && match.aLabel && QUALIFIER_LABEL.test(match.aLabel)) patch.aId = null;
    if (match.bId !== null && match.bLabel && QUALIFIER_LABEL.test(match.bLabel)) patch.bId = null;
    if (Object.keys(patch).length === 0) continue;

    patch.sets = [];
    patch.winnerId = null;
    patch.status = "scheduled";
    patch.updatedAt = Date.now();
    await ctx.db.patch(match._id, patch);
    await advanceKnockout(ctx, { ...match, ...patch } as Doc<"matches">, null);
  }
}
