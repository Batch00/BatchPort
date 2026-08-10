// Which STAY owns a calendar day.
//
// Pure and client-safe. Every surface that turns a date into "where were you
// that day" resolves through here: the trip story's slides, the curation
// panel's day counts, and the journal's day rows.
//
// THE THING THIS EXISTS TO PREVENT
//
// A trip's stops are ROWS, not place names. "Copenhagen, then Stockholm, then
// Oslo, then Copenhagen again" is four stays, and the two Copenhagens have
// nothing to do with each other: separate dates, separate days, separate
// photographs, separate curation. Anything that answers "which stop is this
// day" by name, or by "the first stop whose range contains it", merges them
// into one impossible stay that swallows the middle of the trip.
//
// So the answer is always a destination ID, chosen by that destination's own
// arrival and departure.
//
// THE BOUNDARY RULE
//
//   A day belongs to the stay that ARRIVED most recently on or before it.
//   When two ranges both contain a day, the later arrival takes it; a tie
//   breaks on stored visit order.
//
// The everyday consequence: a departure date shared with the next stop's
// arrival (Copenhagen 28 Sep to 1 Oct, Stockholm 1 Oct to 3 Oct) belongs to
// the stay you ARRIVE at. That direction is not a coin flip. The planner
// numbers a stay's days from its arrival (`planDayIso`, day 1 = arrival), so a
// stay that did not own its own arrival day would have a day 1 the story
// attributed to somewhere else. Giving the boundary to the arriving stay keeps
// every stay's day 1 real; the cost is that the last day of a back-to-back
// stay belongs to the next one, which is what a travel day is.
//
// The same rule settles overlaps and nesting: a stop inside another stop's
// range (a base with a side trip) takes the days it covers, and the base keeps
// the rest.
//
// A day no stay contains (a gap between two stays, or a date before the first
// arrival) belongs to NOBODY. Callers render it as a travel day or not at all;
// nothing may hand it to the nearest stop, which is how a photograph taken the
// day before the trip started ended up captioned with the first city.
//
// TWO PLACES THIS RULE DELIBERATELY DOES NOT REACH
//
//   - The PLANNER's day sections still span the whole stay, arrival to
//     departure inclusive. `experiences.planned_day` is an offset the user
//     already assigned, and dropping the contested last section would silently
//     move whatever was planned on it into "unassigned". Planning the morning
//     you leave is not the same question as which slide the day lands on.
//   - The WEATHER window is the stay's own stored range. It is a coordinate
//     and a date range handed to an archive, not a claim about who owns a day,
//     so two back-to-back stops both reporting the day they shared is correct.

/** The scheduling facts a day-ownership decision needs. */
export interface Stay {
  id: string;
  arrival: string | null;
  departure: string | null;
  /** Position in visit order. Breaks a tie between two stays that arrive on
   * the same day, so the answer never depends on array order. */
  position: number;
}

/** The days a set of stays owns, and who owns each one. */
export interface StayDays {
  /** YYYY-MM-DD to the id of the stay that owns it. */
  ownerByDay: Map<string, string>;
  /** Stay id to its own days, chronological. A stay whose every day was taken
   * by a later arrival is simply absent. */
  daysByStay: Map<string, string[]>;
  /** The earliest day any stay owns, which is the trip's first day on the
   * ground. Null when no stop is dated. */
  firstDay: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The date part of a date or timestamp string, or null when there is none. */
export function dayOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const date = value.slice(0, 10);
  return ISO_DATE.test(date) ? date : null;
}

/** The inclusive day range a stay covers, or null when it carries no date.
 * A stop dated on one side only covers that single day, and a departure typed
 * before its arrival is read as the pair it must have meant. */
export function stayRange(
  stay: Stay,
): { start: string; end: string } | null {
  const arrival = dayOf(stay.arrival);
  const departure = dayOf(stay.departure);
  if (arrival === null && departure === null) return null;
  const start = arrival ?? (departure as string);
  const end = departure ?? (arrival as string);
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Whether a stay carries any date at all. An undated stop owns no days, so it
 * keeps its own content instead of donating it to whoever holds those dates. */
export function isDatedStay(stay: Stay): boolean {
  return stayRange(stay) !== null;
}

function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** Stays in arrival order, ties on stored position. Undated stays drop out:
 * they have no range to claim days with. Sorting here rather than trusting the
 * caller is what makes "the later arrival wins" true of the data instead of
 * true of whatever order the array happened to be in. */
function byArrival(stays: Stay[]): { stay: Stay; start: string; end: string }[] {
  const dated: { stay: Stay; start: string; end: string }[] = [];
  for (const stay of stays) {
    const range = stayRange(stay);
    if (range) dated.push({ stay, start: range.start, end: range.end });
  }
  dated.sort((a, b) =>
    a.start === b.start ? a.stay.position - b.stay.position : a.start < b.start ? -1 : 1,
  );
  return dated;
}

/**
 * Deal every dated day of a trip out to the stay that owns it.
 *
 * `limit` caps how many days one stay may enumerate, so a six month stop does
 * not produce six months of slides. Days past the cap are unclaimed, exactly
 * as a gap day is.
 */
export function buildStayDays(stays: Stay[], limit: number): StayDays {
  const ownerByDay = new Map<string, string>();
  // In arrival order, so a later arrival simply overwrites the day it shares
  // with the stay before it. That single overwrite IS the boundary rule.
  for (const { stay, start, end } of byArrival(stays)) {
    let cursor = start;
    for (let count = 0; cursor <= end && count < limit; count += 1) {
      ownerByDay.set(cursor, stay.id);
      cursor = addDays(cursor, 1);
    }
  }

  const daysByStay = new Map<string, string[]>();
  const days = Array.from(ownerByDay.keys()).sort();
  for (const day of days) {
    const id = ownerByDay.get(day) as string;
    const list = daysByStay.get(id) ?? [];
    list.push(day);
    daysByStay.set(id, list);
  }
  return { ownerByDay, daysByStay, firstDay: days[0] ?? null };
}

/**
 * The stay a single date belongs to, under the same rule, without enumerating
 * a whole trip. Null when no stay contains it.
 *
 * Deliberately uncapped: this answers "which stop was I in", which is a
 * question about the stay's range, not about how many slides it is worth
 * rendering.
 */
export function stayForDate(stays: Stay[], date: string): Stay | null {
  const day = dayOf(date);
  if (day === null) return null;
  let found: Stay | null = null;
  for (const { stay, start, end } of byArrival(stays)) {
    if (start <= day && day <= end) found = stay;
  }
  return found;
}
