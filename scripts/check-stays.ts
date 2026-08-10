// Deterministic checks for day-to-stay resolution.
//
// THE BUG THIS PINS DOWN
//
// A trip's stops are ROWS, not place names. The Pre Job Trip goes Copenhagen,
// Stockholm, Oslo, Copenhagen: four stays, two of them in the same city and
// with nothing in common but the name. Resolving a day to "the first stop
// whose range contains it", and then letting any dated content pull a day onto
// the stop that happened to own the row, merged the two Copenhagens into one
// impossible stay that swallowed the middle of the trip. The first Copenhagen
// showed six day slides and the second showed none, every photograph of both
// visits piled onto the first, and a photo taken the day before the trip began
// produced a slide captioned with the first city on a date it had not started.
//
// So the checks below are about identity: which destination ID owns a day,
// which stay each photograph, experience and journal entry lands on, and what
// the curation panel is therefore offering. They run against the real shapes,
// pure, no database and no dev server.
//
// Run with: npm run check-stays

import { buildStayDays, stayForDate, type Stay } from "../src/lib/stays";
import { destinationForDate, journalDays } from "../src/lib/journal";
import { planDayCount, planDayIso } from "../src/lib/day-plan";
import {
  buildStorySlides,
  placeTripContent,
  photosByStop,
  type StoryDestination,
  type StoryExperience,
  type StoryPhoto,
  type StorySlide,
  type StoryTrip,
} from "../src/lib/story";
import { buildCurationSlots } from "../src/lib/curation-slots";
import { buildYearRecap } from "../src/lib/year-recap";

// --- Tiny assertion harness -------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(detail ? `${name}\n    ${detail}` : name);
}

function equal<T>(name: string, actual: T, expected: T): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    name,
    same,
    same
      ? undefined
      : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// --- Fixtures ---------------------------------------------------------------

let sequence = 0;
function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function stop(
  stopId: string,
  name: string,
  arrival: string | null,
  departure: string | null,
  experiences: StoryExperience[] = [],
): StoryDestination {
  return {
    id: stopId,
    name,
    countryCode: "DK",
    arrivalDate: arrival,
    departureDate: departure,
    latitude: null,
    longitude: null,
    coverUrl: null,
    coverThumbUrl: null,
    experiences,
  };
}

function experience(
  name: string,
  visitedDate: string | null,
  rating: number | null = null,
): StoryExperience {
  return {
    id: id("exp"),
    name,
    rating,
    visitedDate,
    notes: null,
    categoryLabel: null,
    categoryIcon: null,
    categoryColor: null,
    featuredRank: null,
  };
}

function photo(
  photoId: string,
  dateTaken: string | null,
  destinationId: string | null,
  options: { featuredRank?: number | null } = {},
): StoryPhoto {
  return {
    id: photoId,
    url: `https://example.test/${photoId}.jpg`,
    thumbUrl: `https://example.test/${photoId}.jpg_thumb`,
    dateTaken,
    attribution: null,
    featuredRank: options.featuredRank ?? null,
    featuredSlot: options.featuredRank ? "stop" : null,
    destinationId,
    experienceId: null,
  };
}

function trip(
  name: string,
  options: {
    destinations?: StoryDestination[];
    photos?: StoryPhoto[];
    journal?: Record<string, string>;
    start?: string | null;
    end?: string | null;
  } = {},
): StoryTrip {
  return {
    id: id("trip"),
    name,
    status: "completed",
    startDate: options.start ?? null,
    endDate: options.end ?? null,
    notes: null,
    coverUrl: null,
    coverThumbUrl: null,
    destinations: options.destinations ?? [],
    photos: options.photos ?? [],
    journal: options.journal ?? {},
  };
}

const stays = (rows: [string, string | null, string | null][]): Stay[] =>
  rows.map(([stayId, arrival, departure], index) => ({
    id: stayId,
    arrival,
    departure,
    position: index,
  }));

/** Every day slide of one trip as [stay id or "-", date]. */
function dayRows(built: StoryTrip): [string, string][] {
  return buildStorySlides(built)
    .filter(
      (slide): slide is Extract<StorySlide, { kind: "day" }> =>
        slide.kind === "day",
    )
    .map((slide) => [slide.destination?.id ?? "-", slide.date]);
}

function daysOf(built: StoryTrip, stayId: string): string[] {
  return dayRows(built)
    .filter(([owner]) => owner === stayId)
    .map(([, date]) => date);
}

function photoIdsOn(built: StoryTrip, stayId: string): string[] {
  return buildStorySlides(built).flatMap((slide) =>
    (slide.kind === "day" && slide.destination?.id === stayId) ||
    (slide.kind === "stop" && slide.destination.id === stayId)
      ? slide.photos.map((item) => item.id)
      : [],
  );
}

// --- The boundary rule ------------------------------------------------------
//
// A day belongs to the stay that ARRIVED most recently on or before it. The
// direction is not arbitrary: the planner numbers a stay's days from its
// arrival, so a stay that did not own its own arrival day would have a day 1
// the story attributed to somewhere else.

{
  const back = stays([
    ["cph", "2025-09-28", "2025-10-01"],
    ["sto", "2025-10-01", "2025-10-03"],
  ]);
  equal(
    "a shared boundary day belongs to the stay arriving on it",
    stayForDate(back, "2025-10-01")?.id,
    "sto",
  );
  equal(
    "the day before it still belongs to the stay leaving",
    stayForDate(back, "2025-09-30")?.id,
    "cph",
  );
  equal(
    "every stay keeps its own arrival day",
    stayForDate(back, "2025-09-28")?.id,
    "cph",
  );

  const built = buildStayDays(back, 60);
  equal(
    "and the enumerated days agree with the single-date answer",
    [built.daysByStay.get("cph"), built.daysByStay.get("sto")],
    [
      ["2025-09-28", "2025-09-29", "2025-09-30"],
      ["2025-10-01", "2025-10-02", "2025-10-03"],
    ],
  );
  equal("the trip's first day on the ground", built.firstDay, "2025-09-28");

  // A gap between two stays belongs to nobody. Handing it to the nearest stop
  // is what captioned a travel day with a city the traveller had left.
  const gapped = stays([
    ["oslo", "2025-10-03", "2025-10-06"],
    ["cph2", "2025-10-08", "2025-10-10"],
  ]);
  equal("a gap day belongs to nobody", stayForDate(gapped, "2025-10-07"), null);
  equal(
    "and a date before the first arrival belongs to nobody",
    stayForDate(gapped, "2025-10-01"),
    null,
  );

  // A stop nested inside another stop's range (a base with a side trip) takes
  // the days it covers; the base keeps the rest.
  const nested = stays([
    ["base", "2025-05-01", "2025-05-07"],
    ["side", "2025-05-03", "2025-05-04"],
  ]);
  const nestedDays = buildStayDays(nested, 60);
  equal(
    "a nested stay takes its own days",
    nestedDays.daysByStay.get("side"),
    ["2025-05-03", "2025-05-04"],
  );
  equal("and the base keeps the rest", nestedDays.daysByStay.get("base"), [
    "2025-05-01",
    "2025-05-02",
    "2025-05-05",
    "2025-05-06",
    "2025-05-07",
  ]);

  // The rule is about the data, not about array order.
  const shuffled = stays([
    ["sto", "2025-10-01", "2025-10-03"],
    ["cph", "2025-09-28", "2025-10-01"],
  ]);
  equal(
    "the later arrival wins however the array is ordered",
    stayForDate(shuffled, "2025-10-01")?.id,
    "sto",
  );

  // An undated stop owns nothing and claims nothing.
  const undated = stays([["nowhere", null, null]]);
  equal("an undated stop owns no days", buildStayDays(undated, 60).firstDay, null);
  equal(
    "and never claims a date",
    stayForDate(undated, "2025-10-01"),
    null,
  );

  // A one-sided date is a single day, and a reversed pair is read as the pair
  // it must have meant rather than as nothing at all.
  equal(
    "a stop dated on one side covers that day",
    buildStayDays(stays([["one", "2025-06-01", null]]), 60).daysByStay.get("one"),
    ["2025-06-01"],
  );
  equal(
    "a reversed range still covers its days",
    buildStayDays(
      stays([["rev", "2025-06-03", "2025-06-01"]]),
      60,
    ).daysByStay.get("rev"),
    ["2025-06-01", "2025-06-02", "2025-06-03"],
  );
}

// --- The Pre Job Trip shape -------------------------------------------------
//
// Copenhagen, Stockholm, Oslo, Copenhagen. The two Copenhagens are separate
// stays and must never merge, whatever their photographs are hung off.

const CPH1 = "cph-1";
const STO = "sto-1";
const OSL = "osl-1";
const CPH2 = "cph-2";

function preJobTrip(options: { photos?: StoryPhoto[] } = {}): StoryTrip {
  return trip("Pre Job Trip", {
    // The stored start_date predates the first stop, which is the other half
    // of the phantom-day bug.
    start: "2025-09-27",
    end: "2025-10-09",
    destinations: [
      stop(CPH1, "Copenhagen", "2025-09-28", "2025-10-01", [
        experience("Nyhavn", "2025-09-29", 9),
      ]),
      stop(STO, "Stockholm", "2025-10-01", "2025-10-03", [
        experience("Vasa Museum", "2025-10-02", 10),
      ]),
      stop(OSL, "Oslo", "2025-10-03", "2025-10-06", [
        experience("Vigeland Park", "2025-10-04", 8),
      ]),
      stop(CPH2, "Copenhagen", "2025-10-06", "2025-10-09", [
        // Logged onto the FIRST Copenhagen row, dated during the second stay:
        // exactly what a picker showing "Copenhagen" twice produces.
        experience("Tivoli Gardens", "2025-10-07", 9),
      ]),
    ],
    photos: options.photos ?? [
      photo("cph1-a", "2025-09-28", CPH1),
      photo("cph1-b", "2025-09-30", CPH1),
      photo("sto-a", "2025-10-02", STO),
      photo("osl-a", "2025-10-04", OSL),
      // The heart of it: photographs of the SECOND stay, uploaded onto the
      // first Copenhagen row.
      photo("cph2-a", "2025-10-07", CPH1),
      photo("cph2-b", "2025-10-08", CPH1),
    ],
    journal: {
      "2025-09-29": "First morning, cinnamon and rain.",
      "2025-10-07": "Back in Copenhagen, everything familiar.",
    },
  });
}

{
  const built = preJobTrip();

  // 1. The two Copenhagens are two stays, each with its own days.
  equal("the first Copenhagen keeps its own days", daysOf(built, CPH1), [
    "2025-09-28",
    "2025-09-29",
    "2025-09-30",
  ]);
  equal("the second Copenhagen has its own days", daysOf(built, CPH2), [
    "2025-10-07",
    "2025-10-08",
  ]);
  check(
    "the first Copenhagen never reaches into the second stay",
    daysOf(built, CPH1).every((date) => date < "2025-10-01"),
  );

  // 2. Every day slide resolves to exactly one stay, in date order.
  const rows = dayRows(built);
  const dates = rows.map(([, date]) => date);
  equal("no day appears twice", dates.length, new Set(dates).size);
  equal("the slides are in date order", dates, [...dates].sort());
  equal("the whole day run, by stay", rows, [
    [CPH1, "2025-09-28"],
    [CPH1, "2025-09-29"],
    [CPH1, "2025-09-30"],
    [STO, "2025-10-02"],
    [OSL, "2025-10-04"],
    [CPH2, "2025-10-07"],
    [CPH2, "2025-10-08"],
  ]);

  // 3. Photographs land on the stay whose dates contain them, not on the row
  //    they were uploaded to.
  equal("the second stay's photos are on the second stay", photoIdsOn(built, CPH2), [
    "cph2-a",
    "cph2-b",
  ]);
  equal("and no longer pile onto the first", photoIdsOn(built, CPH1), [
    "cph1-a",
    "cph1-b",
  ]);

  // 4. The experience logged on the wrong row follows its own date too.
  const slides = buildStorySlides(built);
  const oct7 = slides.find(
    (slide) => slide.kind === "day" && slide.date === "2025-10-07",
  );
  equal(
    "an experience dated in the second stay shows there",
    oct7 && oct7.kind === "day"
      ? oct7.experiences.map((item) => item.name)
      : [],
    ["Tivoli Gardens"],
  );

  // 5. Each stay opens its own run, so each gets a header and a weather line.
  const opens = slides.filter(
    (slide) => slide.kind === "day" && slide.opensDestination,
  );
  equal(
    "every stay opens exactly once, in visit order",
    opens.map((slide) => (slide.kind === "day" ? slide.destination?.id : null)),
    [CPH1, STO, OSL, CPH2],
  );

  // 6. Day numbering is anchored to the first day on the ground, not to the
  //    stored start_date that predates it.
  const numbered = slides
    .filter((slide) => slide.kind === "day")
    .map((slide) =>
      slide.kind === "day" ? [slide.date, slide.dayNumber] : [],
    );
  equal("day one is the first arrival", numbered[0], ["2025-09-28", 1]);
  equal("and the second visit is numbered from it", numbered[5], [
    "2025-10-07",
    10,
  ]);

  // 7. Journal entries follow the same resolution.
  const journalSlide = slides.find(
    (slide) => slide.kind === "day" && slide.date === "2025-10-07",
  );
  check(
    "a journal entry written on the second visit sits on it",
    journalSlide !== undefined &&
      journalSlide.kind === "day" &&
      journalSlide.destination?.id === CPH2 &&
      journalSlide.journal !== null,
  );

  // 8. Curation: one slot per ROW, each with its own day count and photos.
  const slots = buildCurationSlots(built);
  equal(
    "one curation slot per stay that has photographs",
    slots.stops.map((slot) => [slot.destinationId, slot.dayDates.length]),
    [
      [CPH1, 3],
      [STO, 1],
      [OSL, 1],
      [CPH2, 2],
    ],
  );
  const slotOf = (stayId: string) =>
    slots.stops.find((entry) => entry.destinationId === stayId) ?? null;
  equal(
    "and the second Copenhagen's slot offers its own photographs",
    slotOf(CPH2)?.candidates.map((item) => item.id) ?? null,
    ["cph2-a", "cph2-b"],
  );
  equal(
    "which are no longer offered by the first",
    slotOf(CPH1)?.candidates.map((item) => item.id) ?? null,
    ["cph1-a", "cph1-b"],
  );
  equal(
    "the two slots are distinguishable by their dates",
    [slotOf(CPH1)?.dateLabel ?? null, slotOf(CPH2)?.dateLabel ?? null],
    ["Sep 28, 2025 to Oct 1, 2025", "Oct 6, 2025 to Oct 9, 2025"],
  );

  // 9. photosByStop, which the panel and the story share, agrees.
  const buckets = photosByStop(built);
  equal(
    "the shared photo buckets are per stay",
    [
      buckets.byDestination.get(CPH1)?.map((item) => item.id),
      buckets.byDestination.get(CPH2)?.map((item) => item.id),
    ],
    [
      ["cph1-a", "cph1-b"],
      ["cph2-a", "cph2-b"],
    ],
  );

  // 10. Planner day sections are per row and start at each stay's arrival.
  equal(
    "each Copenhagen plans its own days",
    [
      planDayCount("2025-09-28", "2025-10-01"),
      planDayCount("2025-10-06", "2025-10-09"),
    ],
    [4, 4],
  );
  equal(
    "and day 1 of each is that stay's own arrival",
    [planDayIso("2025-09-28", 1), planDayIso("2025-10-06", 1)],
    ["2025-09-28", "2025-10-06"],
  );

  // 11. The journal day list on the trip page resolves the same way.
  const rowsJournal = journalDays(
    { start_date: "2025-09-27", end_date: "2025-10-09" },
    built.destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      arrival_date: destination.arrivalDate,
      departure_date: destination.departureDate,
    })),
    [{ entry_date: "2025-10-07", body: "Back in Copenhagen." }],
  );
  const oct7Row = rowsJournal.find((row) => row.date === "2025-10-07");
  equal(
    "the journal row for the revisit names the second stay",
    oct7Row?.destinationId,
    CPH2,
  );
  const oct1Row = rowsJournal.find((row) => row.date === "2025-10-01");
  equal(
    "and a shared boundary day names the stay arriving on it",
    oct1Row?.destinationId,
    STO,
  );
  const sep27Row = rowsJournal.find((row) => row.date === "2025-09-27");
  equal(
    "a trip day before the first stop belongs to no stop",
    sep27Row?.destinationId,
    null,
  );
}

// --- The phantom day --------------------------------------------------------
//
// A photograph taken the day before the first stop began produced a slide
// reading "Day 1 - Copenhagen - Sat Sep 27". It was two mistakes at once: the
// nearest stop claimed a day it did not own, and the numbering ran off the
// stored start_date rather than the first day on the ground.

{
  const built = preJobTrip({
    photos: [
      photo("airport", "2025-09-27", null),
      photo("cph1-a", "2025-09-28", CPH1),
    ],
  });
  const rows = dayRows(built);
  check(
    "no slide predates the first stop",
    rows.every(([, date]) => date >= "2025-09-28"),
    JSON.stringify(rows),
  );
  check(
    "and no stay is captioned with a day it does not own",
    rows.every(([owner, date]) => {
      if (owner === "-") return true;
      const source = built.destinations.find(
        (destination) => destination.id === owner,
      );
      return (
        source !== undefined &&
        source.arrivalDate !== null &&
        source.arrivalDate <= date &&
        date <= (source.departureDate ?? source.arrivalDate)
      );
    }),
  );
  // The photograph is not lost: with nowhere to sit it opens the story.
  const opener = buildStorySlides(built)[0];
  equal(
    "the unplaceable photo rides the opener rather than inventing a day",
    opener.kind === "opener" ? opener.photos.map((item) => item.id) : [],
    ["airport"],
  );

  // A journal entry on that same day IS a day, but one with no stop on it.
  const written = trip("Travel day", {
    start: "2025-09-27",
    destinations: [stop(CPH1, "Copenhagen", "2025-09-28", "2025-09-29")],
    photos: [photo("cph1-a", "2025-09-28", CPH1)],
    journal: { "2025-09-27": "Airport, 5am, questioning everything." },
  });
  equal(
    "a travel day with writing is a slide with no stop, in date order",
    dayRows(written),
    [
      ["-", "2025-09-27"],
      [CPH1, "2025-09-28"],
    ],
  );
  const travel = buildStorySlides(written).find(
    (slide) => slide.kind === "day" && slide.date === "2025-09-27",
  );
  equal(
    "and it carries no day number, since the trip had not started",
    travel && travel.kind === "day" ? travel.dayNumber : "missing",
    null,
  );
}

// --- Back to back stays -----------------------------------------------------

{
  const built = trip("Back to back", {
    destinations: [
      stop("a", "Alpha", "2025-03-01", "2025-03-03"),
      stop("b", "Beta", "2025-03-03", "2025-03-05"),
    ],
    photos: [
      photo("a1", "2025-03-01", "a"),
      photo("shared", "2025-03-03", "a"),
      photo("b1", "2025-03-04", "b"),
    ],
  });
  equal("the leaving stay keeps the days before the handover", daysOf(built, "a"), [
    "2025-03-01",
  ]);
  equal("the arriving stay takes the shared day", daysOf(built, "b"), [
    "2025-03-03",
    "2025-03-04",
  ]);
  equal(
    "a photo taken on the shared day moves with it",
    photoIdsOn(built, "b"),
    ["shared", "b1"],
  );
}

// --- An undated stop in a dated trip ----------------------------------------
//
// Absence is not a conflict. An undated stop owns no days, so its own content
// stays with it rather than being donated to whoever holds those dates.

{
  const built = trip("Half dated", {
    destinations: [
      stop("dated", "Rome", "2025-04-01", "2025-04-03"),
      stop("undated", "Somewhere", null, null),
    ],
    photos: [
      photo("r1", "2025-04-01", "dated"),
      photo("u1", "2025-04-02", "undated"),
      photo("u2", null, "undated"),
    ],
  });
  equal("the dated stop keeps its own day", daysOf(built, "dated"), [
    "2025-04-01",
  ]);
  equal(
    "the undated stop gets one stop slide with its own photographs",
    photoIdsOn(built, "undated"),
    ["u1", "u2"],
  );
  const stopSlides = buildStorySlides(built).filter(
    (slide) => slide.kind === "stop",
  );
  equal("exactly one stop slide", stopSlides.length, 1);
}

// --- A single stay is unchanged ---------------------------------------------

{
  const built = trip("One stop", {
    start: "2025-07-01",
    end: "2025-07-04",
    destinations: [
      stop("only", "Lisbon", "2025-07-01", "2025-07-04", [
        experience("Miradouro", "2025-07-02", 9),
      ]),
    ],
    photos: [
      photo("p1", "2025-07-01", "only"),
      photo("p2", "2025-07-02", "only"),
      photo("p3", null, "only"),
    ],
    journal: { "2025-07-03": "Slow day." },
  });
  equal("the one stay owns every day it has content on", daysOf(built, "only"), [
    "2025-07-01",
    "2025-07-02",
    "2025-07-03",
  ]);
  equal(
    "its undated photo still rides the first slide",
    photoIdsOn(built, "only"),
    ["p1", "p3", "p2"],
  );
  const numbered = buildStorySlides(built)
    .filter((slide) => slide.kind === "day")
    .map((slide) => (slide.kind === "day" ? slide.dayNumber : null));
  equal("and the day numbers run from its arrival", numbered, [1, 2, 3]);
}

// --- Curated counts on a revisit trip ---------------------------------------
//
// The plan is computed against the stay's OWN day slides, so what the panel
// promises and what the slides draw agree even when the same city appears
// twice. Before this, both stays' picks were dealt across a merged day list.

{
  const built = preJobTrip({
    photos: [
      photo("cph1-a", "2025-09-28", CPH1),
      photo("cph1-b", "2025-09-29", CPH1),
      photo("cph1-c", "2025-09-30", CPH1),
      // Two picks for the SECOND stay, on the first stay's row.
      photo("cph2-pick1", "2025-10-07", CPH1, { featuredRank: 1 }),
      photo("cph2-pick2", "2025-10-08", CPH1, { featuredRank: 2 }),
      photo("cph2-extra", "2025-10-07", CPH1),
      photo("cph2-extra2", "2025-10-08", CPH1),
    ],
  });
  const slides = buildStorySlides(built);
  const counts = slides
    .filter(
      (slide) => slide.kind === "day" && slide.destination?.id === CPH2,
    )
    .map((slide) => (slide.kind === "day" ? slide.photos.map((p) => p.id) : []));
  equal(
    "each curated day of the second stay shows exactly its pick",
    counts,
    [["cph2-pick1"], ["cph2-pick2"]],
  );
  const firstStay = slides
    .filter((slide) => slide.kind === "day" && slide.destination?.id === CPH1)
    .map((slide) => (slide.kind === "day" ? slide.photos.map((p) => p.id) : []));
  equal(
    "and the uncurated first stay is untouched",
    firstStay,
    [["cph1-a"], ["cph1-b"], ["cph1-c"]],
  );

  // The panel is describing the same two days it will draw.
  const slot = buildCurationSlots(built).stops.find(
    (entry) => entry.destinationId === CPH2,
  );
  equal("the second stay's slot counts its own days", slot?.dayDates.length, 2);
  equal(
    "and holds its own picks",
    slot?.chosen.map((item) => item.id),
    ["cph2-pick1", "cph2-pick2"],
  );
}

// --- Placement is one answer ------------------------------------------------

{
  const built = preJobTrip();
  const placement = placeTripContent(built);
  const owners = new Set(placement.stayDays.ownerByDay.values());
  check(
    "every stay of a revisit trip owns days",
    [CPH1, STO, OSL, CPH2].every((stayId) => owners.has(stayId)),
  );
  equal(
    "and each day has exactly one owner",
    placement.stayDays.ownerByDay.get("2025-10-01"),
    STO,
  );
  equal(
    "destinationForDate agrees with the story's own resolution",
    destinationForDate(
      built.destinations.map((destination) => ({
        id: destination.id,
        name: destination.name,
        arrival_date: destination.arrivalDate,
        departure_date: destination.departureDate,
      })),
      "2025-10-07",
    )?.id,
    CPH2,
  );
}

// --- The recap still reads a revisit trip -----------------------------------

{
  const built = preJobTrip();
  const recap = buildYearRecap({ trips: [built], today: "2026-01-15" }, 2025);
  equal("the year counts the trip once", recap.trips.length, 1);
  equal("with all four stays on it", recap.trips[0]?.stops, 4);
  const scoreboard = recap.slides.find((slide) => slide.kind === "scoreboard");
  const stops =
    scoreboard && scoreboard.kind === "scoreboard"
      ? scoreboard.stats.find((stat) => stat.label === "Stops")?.value
      : null;
  equal("four stops, not three", stops, "4");
}

// --- Report -----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nStays: ${failures.length} check(s) failed.\n`);
  for (const failure of failures) console.error(`  x ${failure}`);
  console.error("");
  process.exit(1);
}
console.log(`Stays: ${passed} checks passed.`);
