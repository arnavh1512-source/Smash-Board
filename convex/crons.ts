import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("prune throttle rows", { minuteUTC: 17 }, internal.cleanup.pruneThrottles, {});

export default crons;
