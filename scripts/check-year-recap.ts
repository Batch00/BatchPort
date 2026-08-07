// Deterministic checks for the Year in Travel derivation.
//
// lib/year-recap.ts is pure, so its rules can be asserted directly against
// fixtures rather than by clicking through a recap and squinting. Everything
// here is about the data: which years exist, how a year slices, what counts as
// planned, and what a thin year produces. Layout and pacing are judged on
// screen; nothing below renders anything.
//
// Run with: npm run check-year-recap

import {
  buildYearRecap,
  hasRecap,
  recapYears,
  type YearRecapInput,
  type YearSlide,
} from "../src/lib/year-recap";
import type { StoryDestination, StoryExperience, StoryTrip } from "../src/lib/story";

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

// --- Fixture builders -------------------------------------------------------

let sequence = 0;
function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function experience(
  name: string,
  options: { rating?: number | null; visitedDate?: string | null } = {},
): StoryExperience {
  return {
    id: id("exp"),
    name,
    rating: options.rating ?? null,
    visitedDate: options.visitedDate ?? null,
    notes: null,
    categoryLabel: null,
    categoryIcon: null,
    categoryColor: null,
  };
}

function stop(
  name: string,
  options: {
    countryCode?: string | null;
    arrival?: string | null;
    departure?: string | null;
    lat?: number;
    lng?: number;
    experiences?: StoryExperience[];
  } = {},
): StoryDestination {
  return {
    id: id("dest"),
    name,
    countryCode: options.countryCode ?? null,
    arrivalDate: options.arrival ?? null,
    departureDate: options.departure ?? null,
    latitude: options.lat ?? null,
    longitude: options.lng ?? null,
    coverUrl: null,
    experiences: options.experiences ?? [],
  };
}

function trip(
  name: string,
  options: {
    status?: string;
    start?: string | null;
    end?: string | null;
    destinations?: StoryDestination[];
    photos?: StoryTrip["photos"];
    journal?: Record<string, string>;
  } = {},
): StoryTrip {
  return {
    id: id("trip"),
    name,
    status: options.status ?? "completed",
    startDate: options.start ?? null,
    endDate: options.end ?? null,
    notes: null,
    coverUrl: null,
    destinations: options.destinations ?? [],
    photos: options.photos ?? [],
    journal: options.journal ?? {},
  };
}

function kinds(slides: YearSlide[]): string[] {
  return slides.map((slide) => slide.kind);
}

function input(trips: StoryTrip[], today: string): YearRecapInput {
  return { trips, today };
}

// --- 1. Year selection ------------------------------------------------------

{
  const trips = [
    trip("Japan", {
      start: "2023-04-02",
      end: "2023-04-16",
      destinations: [stop("Tokyo", { countryCode: "JP", arrival: "2023-04-02" })],
    }),
    trip("Iceland", {
      start: "2025-02-10",
      end: "2025-02-18",
      destinations: [
        stop("Reykjavik", { countryCode: "IS", arrival: "2025-02-10" }),
      ],
    }),
    // A year with nothing but a plan is not a year in travel.
    trip("Peru someday", {
      status: "planned",
      start: "2024-06-01",
      end: "2024-06-20",
      destinations: [stop("Lima", { countryCode: "PE", arrival: "2024-06-01" })],
    }),
    // Dateless trips cannot be placed in any year.
    trip("Undated wandering", {
      destinations: [stop("Somewhere", { countryCode: "FR" })],
    }),
    // A completed trip dated into the future is not offered either.
    trip("Mars", {
      start: "2030-01-01",
      end: "2030-01-10",
      destinations: [stop("Olympus", { countryCode: "US", arrival: "2030-01-01" })],
    }),
  ];

  equal(
    "year list: only years with a dated non-planned trip, newest first",
    recapYears(trips, "2026-08-07"),
    [2025, 2023],
  );
  check("hasRecap is true when years exist", hasRecap(trips, "2026-08-07"));
  check(
    "hasRecap is false with nothing but plans",
    !hasRecap([trips[2], trips[3]], "2026-08-07"),
  );
  equal(
    "year list is empty with no history at all",
    recapYears([trips[2], trips[3]], "2026-08-07"),
    [],
  );
}

// A year in the future is never offered, even when the clock is inside a
// trip's range.
{
  const trips = [
    trip("New Year crossing", {
      start: "2026-12-28",
      end: "2027-01-05",
      destinations: [
        stop("Lisbon", { countryCode: "PT", arrival: "2026-12-28" }),
        stop("Porto", { countryCode: "PT", arrival: "2027-01-02" }),
      ],
    }),
  ];
  equal(
    "a trip running into next year does not offer next year",
    recapYears(trips, "2026-12-30"),
    [2026],
  );
  equal(
    "once next year arrives, both years are offered",
    recapYears(trips, "2027-03-01"),
    [2027, 2026],
  );
}

// --- 2. Slicing a trip that crosses new year --------------------------------

{
  const crossing = trip("Southeast Asia", {
    start: "2024-12-20",
    end: "2025-01-10",
    destinations: [
      stop("Bangkok", {
        countryCode: "TH",
        arrival: "2024-12-20",
        departure: "2024-12-31",
        lat: 13.75,
        lng: 100.5,
        experiences: [
          experience("Wat Pho", { rating: 9, visitedDate: "2024-12-22" }),
        ],
      }),
      stop("Hanoi", {
        countryCode: "VN",
        arrival: "2025-01-01",
        departure: "2025-01-10",
        lat: 21.03,
        lng: 105.85,
        experiences: [
          experience("Old Quarter", { rating: 8, visitedDate: "2025-01-03" }),
        ],
      }),
    ],
    photos: [
      {
        id: id("photo"),
        url: "https://example.test/a.jpg",
        thumbUrl: "https://example.test/a-t.jpg",
        dateTaken: "2024-12-21",
        attribution: null,
        destinationId: null,
      },
      {
        id: id("photo"),
        url: "https://example.test/b.jpg",
        thumbUrl: "https://example.test/b-t.jpg",
        dateTaken: "2025-01-04",
        attribution: null,
        destinationId: null,
      },
    ],
    journal: { "2024-12-24": "Christmas Eve away.", "2025-01-02": "New city." },
  });

  const source = input([crossing], "2026-08-07");
  const first = buildYearRecap(source, 2024);
  const second = buildYearRecap(source, 2025);

  equal("crossing trip counts in both years", [first.stats.trips, second.stats.trips], [1, 1]);
  equal("stops land in the year of their own dates", [first.stats.stops, second.stats.stops], [1, 1]);
  equal(
    "days are clipped to the year (Dec 20-31 is 12, Jan 1-10 is 10)",
    [first.stats.days, second.stats.days],
    [12, 10],
  );
  equal(
    "countries follow the stops, not the trip",
    [first.stats.countryCodes, second.stats.countryCodes],
    [["TH"], ["VN"]],
  );
  equal(
    "experiences land by visited date",
    [first.stats.experiences, second.stats.experiences],
    [1, 1],
  );
  equal(
    "photos land by capture date",
    [first.stats.photos, second.stats.photos],
    [1, 1],
  );
  equal(
    "journal days land by entry date",
    [first.stats.journalEntries, second.stats.journalEntries],
    [1, 1],
  );
  check(
    "the leg over new year counts once, in the arriving year",
    first.stats.distanceKm === 0 && second.stats.distanceKm > 0,
    `2024 ${first.stats.distanceKm} km, 2025 ${second.stats.distanceKm} km`,
  );
  // The map animates whole routes, so both years draw both stops.
  const map2025 = second.slides.find((slide) => slide.kind === "map");
  check(
    "the map slide keeps the whole route rather than cutting it at midnight",
    map2025 !== undefined && map2025.kind === "map" && map2025.stops.length === 2,
  );
}

// --- 3. Planned data is excluded --------------------------------------------

{
  const trips = [
    trip("Real trip", {
      start: "2025-05-01",
      end: "2025-05-08",
      destinations: [
        stop("Oslo", {
          countryCode: "NO",
          arrival: "2025-05-01",
          lat: 59.91,
          lng: 10.75,
          experiences: [
            experience("Vigeland Park", { rating: 8, visitedDate: "2025-05-02" }),
          ],
        }),
        stop("Bergen", {
          countryCode: "NO",
          arrival: "2025-05-05",
          lat: 60.39,
          lng: 5.32,
        }),
      ],
    }),
    trip("Planned trip in the same year", {
      status: "planned",
      start: "2025-09-01",
      end: "2025-09-14",
      destinations: [
        stop("Reykjavik", {
          countryCode: "IS",
          arrival: "2025-09-01",
          lat: 64.15,
          lng: -21.94,
          experiences: [experience("Blue Lagoon", { rating: 10 })],
        }),
      ],
    }),
  ];

  const recap = buildYearRecap(input(trips, "2026-08-07"), 2025);
  equal("planned trips do not count", recap.stats.trips, 1);
  equal("planned stops do not count", recap.stats.stops, 2);
  equal("planned countries do not appear", recap.stats.countryCodes, ["NO"]);
  equal("planned experiences do not count", recap.stats.experiences, 1);
  check(
    "planned stops are not on the animated map",
    recap.slides.every(
      (slide) =>
        slide.kind !== "map" ||
        slide.stops.every((entry) => entry.countryCode !== "IS"),
    ),
  );
  check(
    "a planned trip whose dates have passed is not offered as what is next",
    recap.slides.some(
      (slide) => slide.kind === "closing" && slide.upcoming.length === 0,
    ),
  );
}

// A planned trip whose dates have already passed is not something to look
// forward to.
{
  const trips = [
    trip("Real", {
      start: "2025-05-01",
      end: "2025-05-08",
      destinations: [stop("Oslo", { countryCode: "NO", arrival: "2025-05-01" })],
    }),
    trip("Stale plan", {
      status: "planned",
      start: "2025-06-01",
      end: "2025-06-10",
      destinations: [stop("Rome", { countryCode: "IT", arrival: "2025-06-01" })],
    }),
    trip("Live plan", {
      status: "planned",
      start: "2026-11-01",
      end: "2026-11-12",
      destinations: [stop("Kyoto", { countryCode: "JP", arrival: "2026-11-01" })],
    }),
  ];
  const closing = buildYearRecap(input(trips, "2026-08-07"), 2025).slides.find(
    (slide) => slide.kind === "closing",
  );
  check(
    "a past planned trip is not offered as upcoming",
    closing !== undefined &&
      closing.kind === "closing" &&
      closing.upcoming.length === 1 &&
      closing.upcoming[0].name === "Live plan",
  );
  check(
    "an upcoming trip carries its countdown",
    closing !== undefined &&
      closing.kind === "closing" &&
      closing.upcoming[0].daysAway !== null &&
      closing.upcoming[0].daysAway > 0,
  );
}

// --- 4. A sparse year is coherent, not padded -------------------------------

{
  const sparse = [
    trip("A long weekend", {
      start: "2022-09-16",
      end: "2022-09-18",
      destinations: [
        stop("Copenhagen", {
          countryCode: "DK",
          arrival: "2022-09-16",
          departure: "2022-09-18",
          lat: 55.68,
          lng: 12.57,
        }),
      ],
    }),
  ];
  const recap = buildYearRecap(input(sparse, "2026-08-07"), 2022);

  // Denmark had never been visited before, so "somewhere new" is a real thing
  // to say about this year, not padding. Everything else stays out.
  equal(
    "one short trip yields opener, scale, the trip, one true insight, scoreboard, closing",
    kinds(recap.slides),
    ["opener", "scale", "trip", "insight", "scoreboard", "closing"],
  );
  equal(
    "the only insight is the one the data supports",
    recap.insights.map((insight) => insight.id),
    ["new-countries"],
  );
  check("no moments slide without a rated experience", recap.moments.length === 0);
  check(
    "no map slide for a single located stop",
    !recap.slides.some((slide) => slide.kind === "map"),
  );
  check(
    "the scoreboard has no zero tiles",
    recap.slides.every(
      (slide) =>
        slide.kind !== "scoreboard" ||
        slide.tiles.every((tile) => tile.numeric === null || tile.numeric > 0),
    ),
  );
  const scoreboard = recap.slides.find((slide) => slide.kind === "scoreboard");
  check(
    "the scoreboard is present and non-empty",
    scoreboard !== undefined &&
      scoreboard.kind === "scoreboard" &&
      scoreboard.tiles.length > 0,
  );
}

// A thin year with nothing new to say about it produces no insight at all,
// rather than reaching for a category to fill.
{
  const trips = [
    trip("Denmark, again", {
      start: "2021-05-01",
      end: "2021-05-04",
      destinations: [
        stop("Copenhagen", { countryCode: "DK", arrival: "2021-05-01", lat: 55.68, lng: 12.57 }),
      ],
    }),
    trip("Denmark, once", {
      start: "2022-09-16",
      end: "2022-09-18",
      destinations: [
        stop("Aarhus", { countryCode: "DK", arrival: "2022-09-16", lat: 56.16, lng: 10.2 }),
      ],
    }),
  ];
  const recap = buildYearRecap(input(trips, "2026-08-07"), 2022);
  equal("a repeat country in a one-trip year yields no insight", recap.insights, []);
  equal(
    "and no insight slide with it",
    kinds(recap.slides),
    ["opener", "scale", "trip", "scoreboard", "closing"],
  );
}

// An empty year still produces something the view can render without crashing,
// even though the selector will never offer it.
{
  const recap = buildYearRecap(input([], "2026-08-07"), 2020);
  equal("an empty year is opener and closing only", kinds(recap.slides), [
    "opener",
    "closing",
  ]);
  equal("an empty year has no numbers", recap.stats.trips, 0);
}

// --- 5. The current year reads as in progress -------------------------------

{
  const trips = [
    trip("Spring in Spain", {
      start: "2026-03-04",
      end: "2026-03-19",
      destinations: [
        stop("Madrid", { countryCode: "ES", arrival: "2026-03-04", lat: 40.4, lng: -3.7 }),
        stop("Seville", { countryCode: "ES", arrival: "2026-03-12", lat: 37.4, lng: -6 }),
      ],
    }),
  ];
  const current = buildYearRecap(input(trips, "2026-08-07"), 2026);
  check("the current year is flagged in progress", current.inProgress);
  equal("the current year is labelled so far", current.label, "2026 so far");

  const past = buildYearRecap(input(trips, "2027-01-05"), 2026);
  check("the same year is final once it has ended", !past.inProgress);
  equal("a finished year is labelled plainly", past.label, "2026");
}

// --- 6. Insights are derived, not forced ------------------------------------

{
  const history = [
    trip("Italy 2019", {
      start: "2019-06-01",
      end: "2019-06-10",
      destinations: [stop("Rome", { countryCode: "IT", arrival: "2019-06-01" })],
    }),
    trip("Italy again", {
      start: "2024-04-01",
      end: "2024-04-06",
      destinations: [
        stop("Milan", { countryCode: "IT", arrival: "2024-04-01", lat: 45.5, lng: 9.2 }),
        stop("Turin", { countryCode: "IT", arrival: "2024-04-04", lat: 45.1, lng: 7.7 }),
      ],
    }),
    trip("Portugal first time", {
      start: "2024-09-02",
      end: "2024-09-20",
      destinations: [
        stop("Lisbon", { countryCode: "PT", arrival: "2024-09-02", lat: 38.7, lng: -9.1 }),
        stop("Porto", { countryCode: "PT", arrival: "2024-09-12", lat: 41.1, lng: -8.6 }),
      ],
    }),
  ];
  const recap = buildYearRecap(input(history, "2026-08-07"), 2024);

  equal(
    "a country visited in an earlier year is not a first visit",
    recap.stats.newCountryCodes,
    ["PT"],
  );
  equal(
    "the strongest two insights win, first visits leading",
    recap.insights.map((insight) => insight.id),
    ["new-countries", "longest-trip"],
  );
  check(
    "at most two insight slides reach the sequence",
    recap.slides.filter((slide) => slide.kind === "insight").length <= 2,
  );
  // Italy and Portugal both have two stops here, so there is no "deepest"
  // country and the insight that would have claimed one stays out.
  check(
    "a tie is not a winner",
    !recap.insights.some((insight) => insight.id === "most-explored"),
  );
}

// The deepest country needs more than one stop and more than one country.
{
  const trips = [
    trip("One country, many stops", {
      start: "2023-05-01",
      end: "2023-05-20",
      destinations: [
        stop("Kyoto", { countryCode: "JP", arrival: "2023-05-01", lat: 35, lng: 135.7 }),
        stop("Osaka", { countryCode: "JP", arrival: "2023-05-08", lat: 34.7, lng: 135.5 }),
        stop("Tokyo", { countryCode: "JP", arrival: "2023-05-14", lat: 35.7, lng: 139.7 }),
      ],
    }),
  ];
  check(
    "most-explored is not offered when there is only one country",
    !buildYearRecap(input(trips, "2026-08-07"), 2023).insights.some(
      (insight) => insight.id === "most-explored",
    ),
  );
}

// --- 7. Trip slides collapse once there are too many ------------------------

{
  const many = Array.from({ length: 7 }, (_, index) =>
    trip(`Trip ${index + 1}`, {
      start: `2021-0${index + 1}-01`,
      end: `2021-0${index + 1}-06`,
      destinations: [
        stop(`City ${index + 1}`, {
          countryCode: "FR",
          arrival: `2021-0${index + 1}-01`,
          lat: 48 + index,
          lng: 2 + index,
        }),
      ],
    }),
  );
  const recap = buildYearRecap(input(many, "2026-08-07"), 2021);
  equal("seven trips share one combined slide",
    recap.slides.filter((slide) => slide.kind === "trip").length, 0);
  check(
    "the combined slide is present",
    recap.slides.some((slide) => slide.kind === "trips"),
  );

  const few = buildYearRecap(input(many.slice(0, 3), "2026-08-07"), 2021);
  equal(
    "three trips get a slide each",
    few.slides.filter((slide) => slide.kind === "trip").length,
    3,
  );
}

// --- 8. Moments are the year's best, deterministically ordered --------------

{
  const trips = [
    trip("Greece", {
      start: "2023-07-01",
      end: "2023-07-14",
      destinations: [
        stop("Athens", {
          countryCode: "GR",
          arrival: "2023-07-01",
          lat: 37.98,
          lng: 23.73,
          experiences: [
            experience("Acropolis", { rating: 10, visitedDate: "2023-07-02" }),
            experience("A tourist trap", { rating: 3, visitedDate: "2023-07-03" }),
            experience("Anafiotika", { rating: 10, visitedDate: "2023-07-04" }),
            experience("Plaka dinner", { rating: 9, visitedDate: "2023-07-05" }),
            experience("Unrated stroll"),
          ],
        }),
      ],
    }),
  ];
  const recap = buildYearRecap(input(trips, "2026-08-07"), 2023);
  equal(
    "top three by rating, ties broken by name",
    recap.moments.map((moment) => moment.name),
    ["Acropolis", "Anafiotika", "Plaka dinner"],
  );
  check(
    "an unrated experience is never a moment",
    recap.moments.every((moment) => moment.rating > 0),
  );
  // Rebuilding the same year must produce the same recap, or a shared card
  // would change between two people opening the same profile.
  equal(
    "the recap is stable across rebuilds",
    JSON.stringify(buildYearRecap(input(trips, "2026-08-07"), 2023).slides),
    JSON.stringify(recap.slides),
  );
}

// --- Report -----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(`\n${passed} passed, ${failures.length} failed.\n`);
  process.exit(1);
}

console.log(`Year in Travel: ${passed} checks passed.`);
