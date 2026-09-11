/**
 * Order of play.
 *
 * Building a timetable for a club tournament is a small scheduling problem with
 * three hard rules:
 *
 *  1. A court holds one match at a time.
 *  2. A knockout match cannot start until both matches that feed it have
 *     finished, plus the rest period — the winner has to walk off and recover.
 *  3. No player is sent back on court until they have had their rest.
 *
 * Rule 3 is the reason a tournament runs several categories at once: while the
 * men's singles field is resting, the women's doubles can be on court. The
 * planner below exploits that automatically — it walks the matches in draw
 * order and drops each one into the earliest court slot that breaks no rule, so
 * the gaps left by one category are filled by another rather than left idle.
 *
 * The planner is deliberately a pure function over plain data: no Convex, no
 * dates, only minutes from the start of play. That keeps it testable and keeps
 * the awkward parts of wall-clock time in one place (`toClockTime`).
 */

export interface PlannerMatch {
  id: string;
  eventId: string;
  /** Draw position, used only to keep the order of play sensible. */
  eventOrder: number;
  round: number;
  slot: number;
  /** Entry ids on each side. Empty while a side is still undecided. */
  sides: readonly string[];
  /** Matches whose winners feed this one; it cannot start before they end. */
  feeders: readonly string[];
  /**
   * A bye or an already-finished match: it takes no court time, but later
   * rounds still depend on it.
   */
  skip: boolean;
}

export interface ScheduleOptions {
  /** How long one match holds a court, including the knock-up. */
  matchMinutes: number;
  /** Minimum rest guaranteed to a player between two of their matches. */
  restMinutes: number;
  /** Courts running in parallel. */
  courts: number;
}

export interface ScheduledSlot {
  matchId: string;
  /** Minutes from the start of play. */
  startMinute: number;
  endMinute: number;
  /** 0-based court index; `courtName` turns it into "Court 1". */
  court: number;
}

export const DEFAULT_SCHEDULE: ScheduleOptions & { dayStart: string } = {
  dayStart: "09:00",
  matchMinutes: 30,
  restMinutes: 30,
  courts: 2,
};

export class ScheduleError extends Error {}

/**
 * The key a person is tracked by while the day is planned.
 *
 * Rest is owed to a human being, not to an entry. The same player can be in the
 * singles and the doubles, which are two separate entries with two separate
 * ids, so the planner is fed names rather than entry ids — otherwise a player
 * could be put on two courts at the same minute, or sent straight from one
 * match into the next.
 */
export function personKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function assertOptions(options: ScheduleOptions): void {
  if (!Number.isFinite(options.matchMinutes) || options.matchMinutes < 5 || options.matchMinutes > 240) {
    throw new ScheduleError("A match slot must be between 5 and 240 minutes.");
  }
  if (!Number.isFinite(options.restMinutes) || options.restMinutes < 0 || options.restMinutes > 480) {
    throw new ScheduleError("The rest period must be between 0 and 480 minutes.");
  }
  if (!Number.isInteger(options.courts) || options.courts < 1 || options.courts > 24) {
    throw new ScheduleError("Set between 1 and 24 courts.");
  }
}

/**
 * Draw order: earlier rounds first so no match is placed before the one that
 * feeds it, then category order, then draw position. Categories at the same
 * round interleave naturally once the court and rest constraints are applied.
 */
function drawOrder(a: PlannerMatch, b: PlannerMatch): number {
  return a.round - b.round || a.eventOrder - b.eventOrder || a.slot - b.slot;
}

interface Booking {
  start: number;
  end: number;
}

/**
 * Earliest time at or after `ready` where a match of `duration` fits between
 * the bookings already on this court.
 *
 * Filling those gaps is the whole point. A match placed earlier can leave a
 * court idle while its players rest; without this search the next match would
 * queue behind that idle stretch instead of using it, and a two-category
 * tournament would run twice as long as it needs to.
 */
function firstFit(bookings: readonly Booking[], ready: number, duration: number): number {
  let start = ready;
  for (const booking of bookings) {
    if (start + duration <= booking.start) return start;
    if (start < booking.end) start = booking.end;
  }
  return start;
}

/** Keep a court's bookings in start order so `firstFit` can walk them once. */
function insertBooking(bookings: Booking[], booking: Booking): void {
  const at = bookings.findIndex((existing) => existing.start > booking.start);
  bookings.splice(at === -1 ? bookings.length : at, 0, booking);
}

/**
 * Lay the matches out on courts.
 *
 * Greedy by draw order: each match takes the earliest start any court can offer
 * once its dependencies and its players' rest are satisfied — including a gap
 * left open between two matches already booked on that court. Greedy is the
 * right trade here — an optimal timetable is NP-hard, an organiser needs the
 * answer instantly, and the result only has to be *legal* and *tight*, not
 * provably shortest.
 */
export function planSchedule(
  matches: readonly PlannerMatch[],
  options: ScheduleOptions,
): ScheduledSlot[] {
  assertOptions(options);

  const ordered = [...matches].sort(drawOrder);
  /** Booked intervals per court, kept in start order so gaps can be found. */
  const booked: Booking[][] = Array.from({ length: options.courts }, () => []);
  /** When each player is next available. */
  const playerFree = new Map<string, number>();
  /** When each match finishes, so the rounds after it can wait for it. */
  const endOf = new Map<string, number>();
  const slots: ScheduledSlot[] = [];

  for (const match of ordered) {
    let ready = 0;
    for (const feeder of match.feeders) {
      const feederEnd = endOf.get(feeder);
      // A feeder that was skipped or that is not in this set imposes no wait.
      if (feederEnd !== undefined) ready = Math.max(ready, feederEnd + options.restMinutes);
    }

    if (match.skip) {
      // No court time, but the round after it still waits on this result.
      endOf.set(match.id, ready);
      continue;
    }

    for (const player of match.sides) {
      ready = Math.max(ready, playerFree.get(player) ?? 0);
    }

    let bestCourt = 0;
    let bestStart = firstFit(booked[0], ready, options.matchMinutes);
    for (let court = 1; court < options.courts; court++) {
      const start = firstFit(booked[court], ready, options.matchMinutes);
      if (start < bestStart) {
        bestCourt = court;
        bestStart = start;
      }
    }

    const endMinute = bestStart + options.matchMinutes;
    insertBooking(booked[bestCourt], { start: bestStart, end: endMinute });
    endOf.set(match.id, endMinute);
    for (const player of match.sides) {
      playerFree.set(player, endMinute + options.restMinutes);
    }
    slots.push({ matchId: match.id, startMinute: bestStart, endMinute, court: bestCourt });
  }

  return slots.sort(
    (a, b) => a.startMinute - b.startMinute || a.court - b.court,
  );
}

/** "Court 1" for the first court. Organisers count from one, arrays from zero. */
export function courtName(index: number): string {
  return `Court ${index + 1}`;
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes past midnight for an "HH:MM" wall-clock string. */
export function parseClockTime(value: string): number {
  const match = CLOCK.exec(value.trim());
  if (!match) throw new ScheduleError("Start time must look like 09:00.");
  return Number(match[1]) * 60 + Number(match[2]);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Turn "minutes from the start of play" into a local timestamp string.
 *
 * Play that runs past midnight rolls onto the next date. The value is a local
 * wall-clock string with no zone, matching how `startDate` is stored: a
 * tournament happens in one hall, in one time zone, and an offset would only
 * invite a browser to shift it.
 */
export function toClockTime(startDate: string, dayStart: string, offsetMinutes: number): string {
  const total = parseClockTime(dayStart) + offsetMinutes;
  const dayShift = Math.floor(total / (24 * 60));
  const minuteOfDay = total - dayShift * 24 * 60;

  const base = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) throw new ScheduleError("The tournament needs a start date first.");
  base.setDate(base.getDate() + dayShift);

  const date = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  return `${date}T${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
}

/** "09:30" from a "YYYY-MM-DDTHH:MM" timestamp, for display. */
export function clockOf(timestamp: string): string {
  return timestamp.slice(11, 16);
}

const STAMP = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)$/;

/** "Thu 11 Sep" from a "YYYY-MM-DDTHH:MM" timestamp, for a day heading. */
export function dayOf(timestamp: string): string {
  // The shape has to be checked before Date sees it: the lenient parser turns
  // most nonsense into a real date rather than an invalid one.
  if (!STAMP.test(timestamp)) return timestamp.slice(0, 10);
  const date = new Date(`${timestamp}:00`);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10);
  return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** Minutes between two scheduled matches, for the gap rows in the order of play. */
export function gapMinutes(previousEnd: number, nextStart: number): number {
  return Math.max(0, nextStart - previousEnd);
}

/** "1 h 15 m", "45 m" — a break length an organiser can read at a glance. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}
