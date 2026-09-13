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
  /**
   * How many categories are allowed to be under way at the same time.
   *
   * Courts limit how many people are *playing*; this limits how many are in
   * the building. A category's whole field turns up when its first match is
   * called and drifts home after its last, so running six categories at once
   * puts six fields in one hall — queues at the door, nowhere to sit, and
   * players who cannot hear their name called. Set at or above the number of
   * categories to lift the limit entirely.
   */
  categoriesAtOnce: number;
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
  // Two is the smallest number that still lets one category cover another's
  // rest, which is the reason to run categories in parallel in the first
  // place. Anything higher trades a calmer hall for a shorter day.
  categoriesAtOnce: 2,
};

export class ScheduleError extends Error {}

/**
 * A short, stable digest of a string. Not a security hash and not meant to be:
 * it exists only to tell "this is the same input as last time" from "this is
 * not", cheaply and without a crypto call.
 */
function fingerprint(text: string): string {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = Math.imul(djb, 33) ^ code;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(fnv)}${hex(djb)}`;
}

/**
 * A fingerprint of everything the planner reads.
 *
 * An order of play is not a permanent fact. It is an answer derived from the
 * tournament as it stood at the minute it was generated, and the tournament
 * keeps moving: an entrant withdraws, a walkover resolves, a group decides who
 * qualifies, the categories are reordered, the whole thing moves to another
 * day. The times are still sitting on the matches afterwards, which is exactly
 * why an old plan is dangerous — it looks authoritative.
 *
 * Rather than asking every mutation to remember to raise a flag, the planner's
 * own input is fingerprinted. The value is stored when the plan is made and
 * recomputed when it is read, so anything at all that would change the
 * planner's answer shows up as stale without a mutation having to know that
 * the scheduler exists.
 *
 * Both tournament dates are part of it. The start date decides every printed
 * time; the end date decides whether the plan was allowed at all, so a plan
 * that fitted a two-day booking must not stay "current" once the booking is
 * cut to one day.
 */
export function scheduleBasis(
  startDate: string,
  endDate: string | undefined,
  matches: readonly PlannerMatch[],
): string {
  const lines = matches
    .map((match) =>
      [
        match.id,
        match.eventOrder,
        match.round,
        match.slot,
        match.skip ? "no-court" : "court",
        [...match.sides].sort().join("+"),
        [...match.feeders].sort().join("+"),
      ].join("|"),
    )
    .sort();
  return fingerprint([`${startDate}..${endDate ?? ""}`, ...lines].join("\n"));
}

function assertOptions(options: ScheduleOptions): void {
  // Whole minutes, not merely finite ones. Every time this planner produces is
  // written as "YYYY-MM-DDTHH:MM", which has no room for a half minute: a 30.5
  // minute slot would put the second match of the day at 09:30.5 and the
  // formatter would print some other minute instead. A duration the timetable
  // cannot represent is refused here rather than rounded away downstream.
  if (!Number.isInteger(options.matchMinutes) || options.matchMinutes < 5 || options.matchMinutes > 240) {
    throw new ScheduleError("A match slot must be a whole number of minutes, between 5 and 240.");
  }
  if (!Number.isInteger(options.restMinutes) || options.restMinutes < 0 || options.restMinutes > 480) {
    throw new ScheduleError("The rest period must be a whole number of minutes, between 0 and 480.");
  }
  if (!Number.isInteger(options.courts) || options.courts < 1 || options.courts > 24) {
    throw new ScheduleError("Set between 1 and 24 courts.");
  }
  if (
    !Number.isInteger(options.categoriesAtOnce) ||
    options.categoriesAtOnce < 1 ||
    options.categoriesAtOnce > 24
  ) {
    throw new ScheduleError("Between 1 and 24 categories may run at the same time.");
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
 * Split the matches into successive blocks of categories.
 *
 * Each block is planned in full before the next one is allowed to start, which
 * is what turns "at most N categories at once" into a guarantee rather than a
 * hope: a category cannot be under way in two blocks, and two blocks never
 * overlap in time. Inside a block the categories still interleave freely,
 * because that interleaving is what covers everybody's rest.
 *
 * Categories are blocked in the order the organiser put them in, so the first
 * category on the list is also the first one called to the hall.
 */
function categoryBlocks(ordered: readonly PlannerMatch[], cap: number): PlannerMatch[][] {
  const orderOf = new Map<string, number>();
  for (const match of ordered) {
    if (!orderOf.has(match.eventId)) orderOf.set(match.eventId, match.eventOrder);
  }
  const ids = [...orderOf]
    .sort(([aId, aOrder], [bId, bOrder]) => aOrder - bOrder || aId.localeCompare(bId))
    .map(([id]) => id);
  if (cap >= ids.length) return [[...ordered]];

  const blockOf = new Map(ids.map((id, index) => [id, Math.floor(index / cap)] as const));
  const blocks: PlannerMatch[][] = Array.from({ length: Math.ceil(ids.length / cap) }, () => []);
  for (const match of ordered) blocks[blockOf.get(match.eventId)!].push(match);
  return blocks;
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
  /** The last minute any match has been given, so a block can start after it. */
  let lastEnd = 0;

  for (const block of categoryBlocks(ordered, options.categoriesAtOnce)) {
    // Nothing in this block may start until the previous block is off court
    // and its players have left. That, and only that, is what keeps the hall
    // holding one block's fields rather than the whole entry list.
    const floor = lastEnd;

    for (const match of block) {
      let ready = floor;
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
      lastEnd = Math.max(lastEnd, endMinute);
      for (const player of match.sides) {
        playerFree.set(player, endMinute + options.restMinutes);
      }
      slots.push({ matchId: match.id, startMinute: bestStart, endMinute, court: bestCourt });
    }
  }

  return slots.sort(
    (a, b) => a.startMinute - b.startMinute || a.court - b.court,
  );
}

/** The busiest the hall gets under a finished plan. */
export interface HallLoad {
  /** Players in the building at the worst moment. */
  peak: number;
  /** Minutes from the start of play at which that moment begins. */
  startMinute: number;
}

/**
 * How full the hall gets.
 *
 * A player is counted as present from the start of their first match to the
 * end of their last: nobody arrives for one match and comes back for the next,
 * and in a club hall they are sitting on the same three benches the whole
 * time. The peak is therefore the largest number of those spans that overlap,
 * which is the number an organiser can compare against the seats they have.
 *
 * This measures the plan rather than shaping it — `categoriesAtOnce` is the
 * lever, and this is the reading that says whether the lever is set right.
 */
export function hallLoad(
  matches: readonly PlannerMatch[],
  slots: readonly ScheduledSlot[],
): HallLoad {
  const sidesOf = new Map(matches.map((match) => [match.id, match.sides] as const));
  const spans = new Map<string, { from: number; to: number }>();
  for (const slot of slots) {
    for (const person of sidesOf.get(slot.matchId) ?? []) {
      const known = spans.get(person);
      spans.set(
        person,
        known
          ? { from: Math.min(known.from, slot.startMinute), to: Math.max(known.to, slot.endMinute) }
          : { from: slot.startMinute, to: slot.endMinute },
      );
    }
  }

  // A departure at the same minute as an arrival is sorted first, so one
  // person leaving as another walks in is not counted as two people present.
  const moves = [...spans.values()]
    .flatMap((span) => [
      { at: span.from, change: 1 },
      { at: span.to, change: -1 },
    ])
    .sort((a, b) => a.at - b.at || a.change - b.change);

  let inHall = 0;
  let peak = 0;
  let startMinute = 0;
  for (const move of moves) {
    inHall += move.change;
    if (inHall > peak) {
      peak = inHall;
      startMinute = move.at;
    }
  }
  return { peak, startMinute };
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

/**
 * Is this a "YYYY-MM-DDTHH:MM" local timestamp naming a minute that exists?
 *
 * The shape alone is not enough. `new Date` is lenient - it rolls 2026-02-31
 * forward into March rather than refusing it - so the date is read back out
 * and compared with what was written. A timestamp that survives that is one
 * the timetable, the day headings and the rest calculation can all rely on.
 */
export function isTimestamp(value: string): boolean {
  if (!STAMP.test(value)) return false;
  const date = new Date(`${value}:00`);
  if (Number.isNaN(date.getTime())) return false;
  const readBack = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return readBack === value.slice(0, 10);
}

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

/**
 * Whether a finished plan still lands inside the tournament's own dates.
 *
 * `toClockTime` rolls past midnight on purpose - a match called at 23:40 has
 * to be printed with tomorrow's date on it or the timetable lies. But rolling
 * is a property of the clock, not a licence for the tournament to grow: an
 * organiser who wrote "20 September to 20 September" has told the app how long
 * the hall is booked for, and fifty matches on two courts at thirty minutes
 * each do not fit in that hall no matter how the planner arranges them.
 *
 * So the end date is enforced rather than decorative. The check runs on the
 * finished plan, before a single time is written, and the message names both
 * the overrun and the four levers that close it - because the answer is
 * usually another court or a shorter match, not a longer tournament.
 *
 * Returns null when the plan fits, and the message to show when it does not.
 */
/**
 * Why a hand-entered match time falls outside the tournament's dates, or null
 * when it does not.
 *
 * The planner cannot write a time past the end date, and the organiser typing
 * a time into one match should not be able to either - nor before the first
 * day, which no order of play can produce. Only the bounds the tournament has
 * are applied: an unset date is not a promise to keep.
 */
export function scheduledAtOutsideTournament(
  scheduledAt: string,
  startDate: string | undefined,
  endDate: string | undefined,
): string | null {
  // "YYYY-MM-DD" sorts as text exactly as it sorts as a date.
  const day = scheduledAt.slice(0, 10);
  if (startDate && day < startDate) {
    return `That time is on ${day}, before the tournament starts on ${startDate}.`;
  }
  if (endDate && day > endDate) {
    return `That time is on ${day}, after the tournament ends on ${endDate}. Move the end date first if the tournament really runs that long.`;
  }
  return null;
}

export function endDateOverrun(
  startDate: string,
  endDate: string | undefined,
  dayStart: string,
  lastEndMinute: number,
): string | null {
  if (!endDate) return null;
  const finish = toClockTime(startDate, dayStart, lastEndMinute);
  // Both are "YYYY-MM-DD", which sorts as text exactly as it sorts as a date.
  const finishDay = finish.slice(0, 10);
  if (finishDay <= endDate) return null;
  return (
    `This order of play finishes at ${clockOf(finish)} on ${finishDay}, which is past the ` +
    `tournament's end date of ${endDate}. Add a court, shorten the matches, start the day ` +
    `earlier, run more categories at once, or move the end date.`
  );
}
