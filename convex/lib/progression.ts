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
import { countKnockoutRounds, knockoutFeed, knockoutRoundName } from "../../src/lib/draw";
import {
  evaluateMatch,
  scoringForRound,
  type RoundScoring,
  type ScoringConfig,
} from "../../src/lib/scoring";

export function totalKnockoutRounds(matches: Doc<"matches">[]): number {
  return countKnockoutRounds(matches);
}

async function knockoutMatches(ctx: MutationCtx, eventId: Id<"events">) {
  return await ctx.db
    .query("matches")
    .withIndex("by_event_stage", (q) => q.eq("eventId", eventId).eq("stage", "knockout"))
    .collect();
}

/** How a group qualifier slot is labelled at draw time, e.g. "1st in Group A". */
const QUALIFIER_LABEL = /^\d+(?:st|nd|rd|th) in Group [A-Z]+$/;

/** Label on a side nobody will ever fill because the entrant pulled out. */
export const WITHDRAWN_LABEL = "Withdrawn";

/** Label on a side left empty by the draw itself. */
const BYE_LABEL = "BYE";

/**
 * Is this side permanently empty?
 *
 * An empty side is not the same as an undecided one. "Winner of Semi-final 1"
 * and "1st in Group A" are slots waiting for somebody; "BYE" and "Withdrawn"
 * are slots nobody is coming to. Only the second kind hands the opponent a
 * walkover, which is why the label has to be read and not just the missing id.
 */
function isVacant(id: Id<"entries"> | null, label: string | null): boolean {
  return id === null && (label === BYE_LABEL || label === WITHDRAWN_LABEL);
}

/** A match nobody can still play or change. */
function isSettled(status: string): boolean {
  return status === "completed" || status === "walkover" || status === "cancelled";
}

/**
 * The rules one match is played under, given the category's optional overrides
 * for the semi-finals and the final. Reads the draw only when an override is
 * actually set, so the common case costs no extra query.
 */
export async function scoringForMatch(
  ctx: MutationCtx,
  event: Doc<"events">,
  match: Pick<Doc<"matches">, "stage" | "round" | "isThirdPlace">,
): Promise<ScoringConfig> {
  const base = event.scoring as ScoringConfig;
  if (match.stage !== "knockout") return base;
  if (!event.semiFinalScoring && !event.finalScoring) return base;
  const all = await knockoutMatches(ctx, event._id);
  return scoringForRound(event as RoundScoring, match, totalKnockoutRounds(all));
}

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
      const patch: Record<string, unknown> = {
        [`${side}Id`]: loserId,
        [`${side}Label`]: loserId ? null : `Loser of Semi-final ${match.slot + 1}`,
        updatedAt: Date.now(),
      };
      // A different loser means a different bronze match. Keeping the old score
      // would credit the new arrival with a result they never played, so the
      // playoff goes back to being unplayed - exactly as the next round does.
      const currentLoser = side === "a" ? playoff.aId : playoff.bId;
      if (currentLoser !== loserId && (playoff.sets.length > 0 || playoff.winnerId)) {
        patch.sets = [];
        patch.winnerId = null;
        patch.status = "scheduled";
      }
      await ctx.db.patch(playoff._id, patch);
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
 * Empty one side of a match, because whoever was going to arrive there never
 * will. Any result already played under the old pairing is cleared, and the
 * change is rippled forward so no later round keeps a stale name.
 *
 * The match is re-read rather than taken from a caller's snapshot: a single
 * pass can touch the same match twice, and the second touch has to see the
 * first one's writes.
 */
async function vacateSide(
  ctx: MutationCtx,
  matchId: Id<"matches">,
  side: "a" | "b",
): Promise<void> {
  const target = await ctx.db.get(matchId);
  if (!target) return;

  const patch: Record<string, unknown> = {
    [`${side}Id`]: null,
    [`${side}Label`]: WITHDRAWN_LABEL,
    updatedAt: Date.now(),
  };
  const hadResult = target.sets.length > 0 || target.winnerId !== null;
  if (hadResult || target.status !== "scheduled") {
    patch.sets = [];
    patch.winnerId = null;
    patch.status = "scheduled";
  }
  await ctx.db.patch(matchId, patch);
  if (hadResult) {
    await advanceKnockout(ctx, { ...target, ...(patch as object) } as Doc<"matches">, null);
  }
}

/**
 * A match nobody can play still has to say something to the rounds after it,
 * otherwise the next slot waits forever on a winner that will never exist.
 * Pushing the vacancy forward lets the opponent there resolve on the next pass.
 */
async function propagateCancellation(ctx: MutationCtx, match: Doc<"matches">): Promise<void> {
  if (match.stage !== "knockout" || match.isThirdPlace) return;

  const all = await knockoutMatches(ctx, match.eventId);
  const totalRounds = totalKnockoutRounds(all);

  if (match.round === totalRounds - 2) {
    const playoff = all.find((m) => m.isThirdPlace);
    if (playoff) await vacateSide(ctx, playoff._id, match.slot === 0 ? "a" : "b");
  }

  const feed = knockoutFeed(match.round, match.slot, totalRounds);
  if (!feed) return;
  const next = all.find(
    (m) => !m.isThirdPlace && m.round === feed.round && m.slot === feed.slot,
  );
  if (next) await vacateSide(ctx, next._id, feed.side);
}

/** Safety net on the fixed-point loop below; a real draw settles in far fewer. */
const MAX_RESOLVE_PASSES = 16;

/**
 * Award every match that cannot be played.
 *
 * A side is only ever empty for one of two reasons: the draw left it empty (a
 * bye) or the entrant pulled out. Either way the opponent wins without playing,
 * and that walkover fills a slot in the next round, which may itself turn out to
 * be unplayable. So this runs to a fixed point, re-reading the matches each pass
 * because every patch invalidates the previous snapshot.
 *
 * Both sides empty is not a walkover at all — there is nobody to award it to —
 * so the match becomes a no contest and the vacancy travels onward instead.
 */
export async function resolveWalkovers(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<void> {
  for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
    const all = await ctx.db
      .query("matches")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();

    let changed = false;
    for (const match of all) {
      // A match with a score on it is history, whatever its sides now say.
      if (match.status !== "scheduled" || match.sets.length > 0) continue;

      const aVacant = isVacant(match.aId, match.aLabel);
      const bVacant = isVacant(match.bId, match.bLabel);
      if (!aVacant && !bVacant) continue;

      if (aVacant && bVacant) {
        await ctx.db.patch(match._id, {
          status: "cancelled",
          winnerId: null,
          updatedAt: Date.now(),
        });
        await propagateCancellation(ctx, match);
        changed = true;
        continue;
      }

      // The other side may still be waiting on an earlier round; there is no
      // winner to award yet, so leave it for a later pass.
      const winnerId = aVacant ? match.bId : match.aId;
      if (winnerId === null) continue;

      await ctx.db.patch(match._id, {
        status: "walkover",
        winnerId,
        updatedAt: Date.now(),
      });
      await advanceKnockout(ctx, { ...match, winnerId }, winnerId);
      changed = true;
    }

    if (!changed) return;
  }
}

/**
 * Take an entrant out of a draw that has already been made.
 *
 * Matches they have already played stay exactly as they are: the results are
 * part of the tournament's record and the players who beat them keep their
 * wins. Everything still to come loses them, and is then resolved through the
 * ordinary walkover machinery so their opponents advance properly instead of
 * being left facing an empty slot.
 */
export async function applyWithdrawal(
  ctx: MutationCtx,
  entry: Doc<"entries">,
): Promise<void> {
  const matches = await ctx.db
    .query("matches")
    .withIndex("by_event", (q) => q.eq("eventId", entry.eventId))
    .collect();

  for (const match of matches) {
    if (isSettled(match.status)) continue;
    const side = match.aId === entry._id ? "a" : match.bId === entry._id ? "b" : null;
    if (!side) continue;
    await vacateSide(ctx, match._id, side);
  }

  await resolveWalkovers(ctx, entry.eventId);
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

  // A cancelled group match counts as finished: nobody can ever play it, so
  // waiting for it would stall the knockout forever.
  if (groupMatches.some((m) => !isSettled(m.status))) return false;

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

  if (filled) await resolveWalkovers(ctx, event._id);
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
