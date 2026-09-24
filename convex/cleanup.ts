import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { TRUST_MS } from "../src/lib/pinThrottle";
import { CREATE_WINDOW_MS } from "../src/lib/createThrottle";

/**
 * Housekeeping for the two throttle tables.
 *
 * Every browser that ever tried a PIN or created a tournament leaves a row
 * behind. Deleting a tournament takes its `pinAttempts` with it, but a busy one
 * can live for months, and `createAttempts` belong to no tournament at all.
 * These sweeps drop rows that can no longer change any decision, so the tables
 * stay the size of current activity rather than all-time activity.
 */

/** Rows deleted per run. Well inside a mutation's write limits. */
export const CLEANUP_BATCH = 256;

/**
 * Drop throttle rows nothing will read again, then run again straight away if
 * the batch was full.
 *
 * A `createAttempts` row is dead once its window has closed: the next creation
 * from that source opens a fresh one regardless. A `pinAttempts` row is dead
 * once it has been quiet for `TRUST_MS`: trust is always granted for exactly
 * `TRUST_MS` from the write that grants it, and every lock and quiet spell is
 * far shorter, so a row that old holds nothing but zeros.
 */
export const pruneThrottles = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const creates = await ctx.db
      .query("createAttempts")
      .withIndex("by_windowStart", (q) => q.lt("windowStart", now - CREATE_WINDOW_MS))
      .take(CLEANUP_BATCH);
    const pins = await ctx.db
      .query("pinAttempts")
      .withIndex("by_updatedAt", (q) => q.lt("updatedAt", now - TRUST_MS))
      .take(CLEANUP_BATCH - creates.length);
    for (const row of [...creates, ...pins]) await ctx.db.delete(row._id);

    // A backlog of exactly one batch costs one extra run that finds nothing,
    // which is cheaper than counting what is left before deciding.
    if (creates.length + pins.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.pruneThrottles, {});
    }
    return null;
  },
});
