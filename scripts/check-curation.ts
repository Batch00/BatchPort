// Deterministic checks for the curation model.
//
// lib/curation.ts is pure, and so is everything that consumes it: the story
// slides, the share card's highlights, the recap's moments and hero, and the
// per-trip bests on the trip page. So the whole model can be asserted against
// fixtures rather than by featuring things in a browser and squinting at four
// surfaces to see whether they agree.
//
// What is asserted here is the model, not the layout: rank order, the cap, the
// trip scope, and above all that an UNCURATED trip produces exactly what it
// produced before featuring existed.
//
// Run with: npm run check-curation

import {
  MAX_FEATURED_HONORED,
  SLIDE_PHOTO_CAP,
  SLOT_CAPACITY,
  compareCurated,
  compareFeatured,
  distributeStopPhotos,
  featuredFirst,
  heroPhoto,
  isFeatured,
  isHeroPhoto,
  nextFeaturedRank,
  photoSlot,
  photoSlotOf,
  stopPhotoRank,
  stopPhotosFirst,
  type PhotoSlot,
} from "../src/lib/curation";
import {
  buildCurationSlots,
  describeStopSelection,
  hasCurationSlots,
} from "../src/lib/curation-slots";
import {
  buildStorySlides,
  storyClosingStats,
  type StoryDestination,
  type StoryExperience,
  type StoryPhoto,
  type StorySlide,
  type StoryTrip,
} from "../src/lib/story";
import { shareCardFromStoryTrip } from "../src/lib/poster/share-card";
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

function experience(
  name: string,
  options: {
    rating?: number | null;
    visitedDate?: string | null;
    featuredRank?: number | null;
  } = {},
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
    featuredRank: options.featuredRank ?? null,
  };
}

function photo(
  name: string,
  options: {
    dateTaken?: string | null;
    destinationId?: string | null;
    experienceId?: string | null;
    featuredRank?: number | null;
    featuredSlot?: PhotoSlot | null;
  } = {},
): StoryPhoto {
  return {
    id: name,
    url: `https://example.test/${name}.jpg`,
    thumbUrl: `https://example.test/${name}.jpg_thumb`,
    dateTaken: options.dateTaken ?? null,
    attribution: null,
    featuredRank: options.featuredRank ?? null,
    featuredSlot: options.featuredSlot ?? null,
    destinationId: options.destinationId ?? null,
    experienceId: options.experienceId ?? null,
  };
}

/** A stop pick, at a given rank. The distribution checks below all curate, so
 * spelling this out once keeps them readable. */
function pick(
  name: string,
  rank: number,
  options: { dateTaken?: string | null; destinationId?: string | null } = {},
): StoryPhoto {
  return photo(name, {
    ...options,
    featuredSlot: "stop",
    featuredRank: rank,
  });
}

function stop(
  name: string,
  options: {
    arrival?: string | null;
    departure?: string | null;
    experiences?: StoryExperience[];
    lat?: number;
    lng?: number;
  } = {},
): StoryDestination {
  return {
    id: name,
    name,
    countryCode: "JP",
    arrivalDate: options.arrival ?? null,
    departureDate: options.departure ?? null,
    latitude: options.lat ?? null,
    longitude: options.lng ?? null,
    coverUrl: null,
    coverThumbUrl: null,
    experiences: options.experiences ?? [],
  };
}

function trip(
  name: string,
  options: {
    destinations?: StoryDestination[];
    photos?: StoryPhoto[];
    start?: string | null;
    end?: string | null;
    status?: string;
    coverUrl?: string | null;
  } = {},
): StoryTrip {
  return {
    id: id("trip"),
    name,
    status: options.status ?? "completed",
    startDate: options.start ?? null,
    endDate: options.end ?? null,
    notes: null,
    coverUrl: options.coverUrl ?? null,
    coverThumbUrl: null,
    destinations: options.destinations ?? [],
    photos: options.photos ?? [],
    journal: {},
  };
}

// --- The comparators --------------------------------------------------------

{
  check("not featured when the rank is null", !isFeatured({ featuredRank: null }));
  check("not featured when the rank is absent", !isFeatured({}));
  check("featured at rank 1", isFeatured({ featuredRank: 1 }));
  // A zero or a negative is not a rank. Normalizing rather than trusting the
  // column means a hand-edited row cannot make a surface behave strangely.
  check("rank 0 is not featured", !isFeatured({ featuredRank: 0 }));
  check("a negative rank is not featured", !isFeatured({ featuredRank: -1 }));

  equal(
    "featured sorts ahead of unfeatured",
    featuredFirst([
      { featuredRank: null, name: "a" },
      { featuredRank: 2, name: "b" },
      { featuredRank: 1, name: "c" },
      { featuredRank: null, name: "d" },
    ]).map((item) => item.name),
    ["c", "b", "a", "d"],
  );

  // Stability is what lets every caller layer this on top of its own order
  // instead of re-deriving one.
  equal(
    "unfeatured items keep their incoming order",
    featuredFirst([
      { featuredRank: null, name: "z" },
      { featuredRank: null, name: "a" },
      { featuredRank: null, name: "m" },
    ]).map((item) => item.name),
    ["z", "a", "m"],
  );

  check(
    "a rank past the cap is not honoured",
    compareFeatured(
      { featuredRank: MAX_FEATURED_HONORED + 1 },
      { featuredRank: null },
    ) === 0,
  );

  equal(
    "the curated comparator falls back to rating then name",
    [
      { featuredRank: null, rating: 8, name: "Beta" },
      { featuredRank: null, rating: 10, name: "Zeta" },
      { featuredRank: null, rating: 10, name: "Alpha" },
      { featuredRank: 1, rating: 4, name: "Chosen" },
    ]
      .sort(compareCurated)
      .map((item) => item.name),
    ["Chosen", "Alpha", "Zeta", "Beta"],
  );
}

// --- Photo slots ------------------------------------------------------------

{
  equal("no slot and no rank is uncurated", photoSlot({}), null);
  equal(
    "an explicit hero slot reads as hero",
    photoSlot({ featuredSlot: "hero", featuredRank: 1 }),
    "hero",
  );
  equal(
    "an explicit stop slot reads as stop",
    photoSlot({ featuredSlot: "stop", featuredRank: 2 }),
    "stop",
  );
  // The backwards compatibility rule, and the only one that matters: every
  // photo curated before slots existed carries a rank and no slot, and has to
  // keep leading its stop's story slides exactly as it did.
  equal(
    "a rank with no slot is a stop pick",
    photoSlot({ featuredRank: 3 }),
    "stop",
  );
  equal(
    "the raw normalizer agrees with the object one",
    photoSlotOf(null, 3),
    photoSlot({ featuredRank: 3 }),
  );
  equal("an unknown slot value is uncurated", photoSlotOf("banner", null), null);

  check("a hero is a hero", isHeroPhoto({ featuredSlot: "hero" }));
  check("a stop pick is not a hero", !isHeroPhoto({ featuredRank: 1 }));
  // A hero answers "open the recap with this", not "lead this stop with this".
  // Letting it do both is the ambiguity the slot column removed.
  equal(
    "a hero holds no stop rank",
    stopPhotoRank({ featuredSlot: "hero", featuredRank: 1 }),
    null,
  );
  equal(
    "a stop pick holds its rank",
    stopPhotoRank({ featuredSlot: "stop", featuredRank: 2 }),
    2,
  );

  equal(
    "stop picks sort first, in their own order",
    stopPhotosFirst([
      { featuredRank: null, featuredSlot: null, name: "a" },
      { featuredRank: 1, featuredSlot: "hero", name: "hero" },
      { featuredRank: 2, featuredSlot: "stop", name: "second" },
      { featuredRank: 1, featuredSlot: "stop", name: "first" },
    ]).map((item) => item.name),
    ["first", "second", "a", "hero"],
  );

  equal(
    "the hero of a set is the one elected into the slot",
    heroPhoto([
      { featuredRank: 1, featuredSlot: "stop", name: "stop" },
      { featuredRank: 1, featuredSlot: "hero", name: "hero" },
    ])?.name,
    "hero",
  );
  equal("no hero elected is null", heroPhoto([{ featuredRank: 1 }]), null);
}

// --- Rank assignment --------------------------------------------------------

{
  equal("the first featured item takes rank 1", nextFeaturedRank([]), 1);
  equal(
    "the next rank is one past the highest in use",
    nextFeaturedRank([1, null, 3, null]),
    4,
  );
  // Unfeaturing leaves a hole. Filling it would renumber rows the user never
  // touched; taking the next number after the highest never does.
  equal("a hole in the sequence is not reused", nextFeaturedRank([1, 3]), 4);
  equal(
    "the cap refuses rather than assigning an unhonoured rank",
    nextFeaturedRank(
      Array.from({ length: MAX_FEATURED_HONORED }, (_, index) => index + 1),
    ),
    null,
  );
}

// --- The story --------------------------------------------------------------

{
  const kyoto = stop("Kyoto", {
    arrival: "2024-05-06",
    departure: "2024-05-07",
    experiences: [
      experience("Nishiki Market", { rating: 8, visitedDate: "2024-05-06" }),
      experience("Fushimi Inari", {
        rating: 6,
        visitedDate: "2024-05-06",
        featuredRank: 1,
      }),
    ],
  });
  const curated = trip("Japan", {
    start: "2024-05-06",
    end: "2024-05-07",
    destinations: [kyoto],
    photos: [
      photo("crowd", { dateTaken: "2024-05-06", destinationId: "Kyoto" }),
      photo("gates", {
        dateTaken: "2024-05-06",
        destinationId: "Kyoto",
        featuredRank: 1,
      }),
    ],
  });

  const slides = buildStorySlides(curated);
  const day = slides.find((slide) => slide.kind === "day");
  check("the trip produced a day slide", day !== undefined);
  if (day && day.kind === "day") {
    // Elected: so the slide is that photograph. The one the camera happened
    // to take beside it is not a filler behind it (see "the COUNT a curated
    // stop shows" below).
    equal(
      "the featured photo is what its slide shows",
      day.photos.map((item) => item.id),
      ["gates"],
    );
    equal(
      "the featured experience leads its slide, over a better rating",
      day.experiences.map((item) => item.name),
      ["Fushimi Inari", "Nishiki Market"],
    );
  }

  equal(
    "best of the trip is the featured pick, not the top rating",
    storyClosingStats(curated).best?.name,
    "Fushimi Inari",
  );

  // The same trip with nothing featured must behave exactly as it did before
  // curation existed. This is the check that would catch a regression in the
  // zero-effort path, which is the one almost every trip is on.
  const plain = trip("Japan plain", {
    start: "2024-05-06",
    end: "2024-05-07",
    destinations: [
      stop("Kyoto2", {
        arrival: "2024-05-06",
        departure: "2024-05-07",
        experiences: [
          experience("Nishiki Market", { rating: 8, visitedDate: "2024-05-06" }),
          experience("Fushimi Inari", { rating: 6, visitedDate: "2024-05-06" }),
        ],
      }),
    ],
    photos: [
      photo("crowd2", { dateTaken: "2024-05-06", destinationId: "Kyoto2" }),
      photo("gates2", { dateTaken: "2024-05-06", destinationId: "Kyoto2" }),
    ],
  });
  const plainDay = buildStorySlides(plain).find((slide) => slide.kind === "day");
  if (plainDay && plainDay.kind === "day") {
    equal(
      "with nothing featured, photos keep the order they arrived in",
      plainDay.photos.map((item) => item.id),
      ["crowd2", "gates2"],
    );
    equal(
      "with nothing featured, experiences keep the order they arrived in",
      plainDay.experiences.map((item) => item.name),
      ["Nishiki Market", "Fushimi Inari"],
    );
  }
  equal(
    "with nothing featured, best of the trip is the top rating",
    storyClosingStats(plain).best?.name,
    "Nishiki Market",
  );
}

// --- Spreading a stop's picks across its days --------------------------------
//
// A story slide is a DAY and the picks are per DESTINATION, so this is the
// mapping between the two. It is asserted at both levels: the pure deal, and
// then end to end through buildStorySlides, because the second is what a
// reader actually sees.

{
  const days = ["2024-04-01", "2024-04-02", "2024-04-03", "2024-04-04"];
  const undated = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `u${index + 1}`,
      dateTaken: null,
    }));
  const spread = (
    dayList: string[],
    curated: { id: string; dateTaken: string | null }[],
  ) => {
    const plan = distributeStopPhotos(dayList, curated);
    return dayList.map((date) => plan.get(date) ?? []);
  };

  // Count equals days: one leads each.
  equal(
    "four picks over four days lead one each",
    spread(days, undated(4)),
    [["u1"], ["u2"], ["u3"], ["u4"]],
  );

  // Fewer than days: the front days lead, the rest are left to fall back.
  equal(
    "two picks over four days lead the first two",
    spread(days, undated(2)),
    [["u1"], ["u2"], [], []],
  );

  // More than days: evenly, front-loaded, never piled onto day one.
  equal(
    "five picks over four days go 2, 1, 1, 1",
    spread(days, undated(5)),
    [["u1", "u5"], ["u2"], ["u3"], ["u4"]],
  );
  equal(
    "eight picks over three days go 3, 3, 2",
    spread(days.slice(0, 3), undated(8)),
    [
      ["u1", "u4", "u7"],
      ["u2", "u5", "u8"],
      ["u3", "u6"],
    ],
  );

  // No day takes more than one slide draws.
  const capped = spread(days.slice(0, 1), undated(9));
  equal("no day takes more than the slide cap", capped[0].length, SLIDE_PHOTO_CAP);

  // A DATED pick leads the day it was actually taken on. Dealing it elsewhere
  // to even the spread would print it under another day's date.
  equal(
    "a dated pick leads its own day, whatever its rank",
    spread(days, [
      { id: "d4", dateTaken: "2024-04-04" },
      { id: "d1", dateTaken: "2024-04-01" },
    ]),
    [["d1"], [], [], ["d4"]],
  );
  equal(
    "undated picks fill around the dated ones",
    spread(days, [
      { id: "d3", dateTaken: "2024-04-03" },
      { id: "u1", dateTaken: null },
      { id: "u2", dateTaken: null },
    ]),
    [["u1"], ["u2"], ["d3"], []],
  );
  // A pick whose own day is full stays an ordinary photo of that day rather
  // than being moved somewhere it was not taken.
  const overflowing = spread(days, [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `f${index + 1}`,
      dateTaken: "2024-04-01",
    })),
  ]);
  equal(
    "a pick past its own day's cap is not moved to another day",
    overflowing,
    [["f1", "f2", "f3", "f4"], [], [], []],
  );

  equal("nothing curated plans nothing", distributeStopPhotos(days, []).size, 0);
  equal("no days plans nothing", distributeStopPhotos([], undated(3)).size, 0);
}

// End to end: the same rule as the reader meets it, on real slides.
{
  const stopId = "KyotoD";
  const dated = (day: string) => `2024-05-0${day}`;
  const spreadTrip = trip("Kyoto week", {
    start: dated("1"),
    end: dated("4"),
    destinations: [
      stop(stopId, {
        arrival: dated("1"),
        departure: dated("4"),
        experiences: [
          experience("A", { visitedDate: dated("1") }),
          experience("B", { visitedDate: dated("2") }),
          experience("C", { visitedDate: dated("3") }),
          experience("D", { visitedDate: dated("4") }),
        ],
      }),
    ],
    // Four undated picks, plus one ordinary dated photo per day so every day
    // is a slide of its own.
    photos: [
      photo("own1", { dateTaken: dated("1"), destinationId: stopId }),
      photo("own2", { dateTaken: dated("2"), destinationId: stopId }),
      photo("own3", { dateTaken: dated("3"), destinationId: stopId }),
      photo("own4", { dateTaken: dated("4"), destinationId: stopId }),
      pick("p1", 1, { destinationId: stopId }),
      pick("p2", 2, { destinationId: stopId }),
      pick("p3", 3, { destinationId: stopId }),
      pick("p4", 4, { destinationId: stopId }),
    ],
  });
  const spreadDays = buildStorySlides(spreadTrip).filter(
    (slide) => slide.kind === "day",
  );
  equal("the stop produced four day slides", spreadDays.length, 4);
  equal(
    "each day shows its pick and nothing else",
    spreadDays.map((slide) =>
      slide.kind === "day" ? slide.photos.map((item) => item.id) : [],
    ),
    [["p1"], ["p2"], ["p3"], ["p4"]],
  );

  // The gap this closes: before the spread, every undated pick rode the stop's
  // FIRST slide and the other three days had nothing curated at all.
  const first = spreadDays[0];
  check(
    "no pick is left piled on the opening slide",
    first.kind === "day" && first.photos.length === 1,
  );

  // And a pick placed on one day is not also drawn on another.
  const drawn = spreadDays.flatMap((slide) =>
    slide.kind === "day" ? slide.photos.map((item) => item.id) : [],
  );
  equal("no photo appears twice across the stop", drawn.length, new Set(drawn).size);

  // The uncurated path is untouched, which is the guarantee that matters most.
  const plainTrip = trip("Kyoto week plain", {
    start: dated("1"),
    end: dated("2"),
    destinations: [stop("KyotoDP", { arrival: dated("1"), departure: dated("2") })],
    photos: [
      photo("a", { dateTaken: dated("1"), destinationId: "KyotoDP" }),
      photo("b", { dateTaken: dated("1"), destinationId: "KyotoDP" }),
      photo("c", { destinationId: "KyotoDP" }),
    ],
  });
  const plainDays = buildStorySlides(plainTrip).filter(
    (slide) => slide.kind === "day",
  );
  equal(
    "with nothing curated the undated photo still rides the first slide",
    plainDays.map((slide) =>
      slide.kind === "day" ? slide.photos.map((item) => item.id) : [],
    ),
    [["a", "b", "c"]],
  );

  // What the panel promises is generated by the same function that places
  // them, so the sentence cannot describe a spread the slides do not make.
  const slot = buildCurationSlots(spreadTrip).stops[0];
  equal("the panel knows how many day slides the stop has", slot.dayDates.length, 4);
  equal(
    "and says what the current selection produces",
    describeStopSelection(slot, slot.chosen),
    "4 across 4 days: one each.",
  );
  equal(
    "including when there are more picks than days",
    describeStopSelection(slot, [
      ...slot.chosen,
      { id: "x", url: "", thumbUrl: "", dateTaken: null, position: null },
    ]),
    "5 across 4 days: 2, 1, 1, 1.",
  );
  equal(
    "and when some days are left to fall back",
    describeStopSelection(slot, slot.chosen.slice(0, 2)),
    "2 across 4 days: 2 days show your picks and nothing else, the other 2 fall back to their own photos, then the stop cover.",
  );
}

// --- The COUNT a curated stop shows -----------------------------------------
//
// The bug this pins down: the spread decided which photographs LEAD each day,
// and then every day was topped up with its own remaining photos to the slide
// cap. So curating one photograph of a day produced that one plus three the
// camera happened to take, and choosing fewer changed the lead and nothing
// else. Curation is an instruction to show exactly those.
//
// Asserted end to end on real slides, because the count is what a reader sees.

{
  const DAYS = ["2024-06-01", "2024-06-02", "2024-06-03"];

  /** A three day stop with three photos of its own on each day, plus `picks`
   * undated curated photos. Three per day is the point: any day that falls
   * back is visibly different from any day that does not. */
  function stopTrip(name: string, stopId: string, picks: number): StoryTrip {
    const own = DAYS.flatMap((date, dayIndex) =>
      [1, 2, 3].map((n) =>
        photo(`${stopId}-d${dayIndex + 1}-${n}`, {
          dateTaken: date,
          destinationId: stopId,
        }),
      ),
    );
    const chosen = Array.from({ length: picks }, (_, index) =>
      pick(`${stopId}-pick${index + 1}`, index + 1, { destinationId: stopId }),
    );
    return trip(name, {
      start: DAYS[0],
      end: DAYS[2],
      destinations: [
        stop(stopId, { arrival: DAYS[0], departure: DAYS[2] }),
      ],
      photos: [...own, ...chosen],
    });
  }

  const dayPhotos = (built: StoryTrip, stopId: string): string[][] =>
    buildStorySlides(built)
      .filter(
        (slide): slide is Extract<StorySlide, { kind: "day" }> =>
          slide.kind === "day" && slide.destination?.id === stopId,
      )
      .map((slide) => slide.photos.map((item) => item.id));

  const counts = (built: StoryTrip, stopId: string): number[] =>
    dayPhotos(built, stopId).map((ids) => ids.length);

  // One pick over three days: one day shows one photograph, not one plus
  // three fillers. The other two are untouched.
  equal(
    "one pick over three days gives that day exactly one photo",
    counts(stopTrip("One pick", "One", 1), "One"),
    [1, 3, 3],
  );
  equal(
    "and it is the elected photograph, with the day's own dropped",
    dayPhotos(stopTrip("One pick ids", "OneIds", 1), "OneIds")[0],
    ["OneIds-pick1"],
  );

  // One each: every day shows exactly its own pick.
  equal(
    "three picks over three days give one photo each",
    counts(stopTrip("Three picks", "Three", 3), "Three"),
    [1, 1, 1],
  );

  // More picks than days: the spread decides the counts (3, 3, 2) and each
  // day shows precisely what it was dealt, capped at what a slide draws.
  equal(
    "eight picks over three days go 3, 3, 2 and stop there",
    counts(stopTrip("Eight picks", "Eight", 8), "Eight"),
    [3, 3, 2],
  );

  // Nothing elected: exactly the story that existed before curation did.
  equal(
    "an uncurated stop still shows every photo of each day",
    counts(stopTrip("No picks", "None", 0), "None"),
    [3, 3, 3],
  );

  // A trip where one stop is curated and one is not. The rule is per stop, so
  // curating Lisbon cannot quietly thin out Porto.
  const mixed = trip("Mixed", {
    start: "2024-06-01",
    end: "2024-06-06",
    destinations: [
      stop("Lisbon", { arrival: "2024-06-01", departure: "2024-06-03" }),
      stop("Porto", { arrival: "2024-06-04", departure: "2024-06-06" }),
    ],
    photos: [
      ...DAYS.flatMap((date, dayIndex) =>
        [1, 2, 3].map((n) =>
          photo(`lis-d${dayIndex + 1}-${n}`, {
            dateTaken: date,
            destinationId: "Lisbon",
          }),
        ),
      ),
      ...["2024-06-04", "2024-06-05", "2024-06-06"].flatMap((date, dayIndex) =>
        [1, 2, 3].map((n) =>
          photo(`por-d${dayIndex + 1}-${n}`, {
            dateTaken: date,
            destinationId: "Porto",
          }),
        ),
      ),
      pick("lis-pick1", 1, { destinationId: "Lisbon" }),
      pick("lis-pick2", 2, { destinationId: "Lisbon" }),
    ],
  });
  equal(
    "the curated stop shows its two picks and falls back on the third day",
    counts(mixed, "Lisbon"),
    [1, 1, 3],
  );
  equal(
    "and the uncurated stop on the same trip is untouched",
    counts(mixed, "Porto"),
    [3, 3, 3],
  );

  // A dated pick still leads the day it was taken on, and that day shows it
  // alone rather than it plus the day's own photographs.
  const datedPickTrip = trip("Dated pick", {
    start: DAYS[0],
    end: DAYS[2],
    destinations: [stop("Dated", { arrival: DAYS[0], departure: DAYS[2] })],
    photos: [
      photo("dated-own1", { dateTaken: DAYS[1], destinationId: "Dated" }),
      photo("dated-own2", { dateTaken: DAYS[1], destinationId: "Dated" }),
      pick("dated-pick", 1, { dateTaken: DAYS[1], destinationId: "Dated" }),
    ],
  });
  equal(
    "a dated pick owns its own day alone",
    dayPhotos(datedPickTrip, "Dated"),
    [["dated-pick"]],
  );

  // A stop with no dated day is one slide, and the same rule holds on it.
  const undatedStop = trip("Undated stop", {
    destinations: [stop("Undated")],
    photos: [
      photo("u-own1", { destinationId: "Undated" }),
      photo("u-own2", { destinationId: "Undated" }),
      photo("u-own3", { destinationId: "Undated" }),
      pick("u-pick", 1, { destinationId: "Undated" }),
    ],
  });
  const stopSlide = buildStorySlides(undatedStop).find(
    (slide) => slide.kind === "stop",
  );
  equal(
    "a curated stop slide shows its picks and nothing else",
    stopSlide && stopSlide.kind === "stop"
      ? stopSlide.photos.map((item) => item.id)
      : [],
    ["u-pick"],
  );
}

// --- The share card ---------------------------------------------------------

{
  const card = shareCardFromStoryTrip(
    trip("Interrail", {
      start: "2019-07-27",
      end: "2019-08-14",
      destinations: [
        stop("Amsterdam", {
          experiences: [
            experience("Anne Frank House", { rating: 10 }),
            experience("Van Gogh Museum", { rating: 10 }),
            experience("Canal boat at dusk", { rating: 9, featuredRank: 1 }),
            experience("Vondelpark", { rating: 8 }),
          ],
        }),
      ],
    }),
  );
  equal(
    "the card leads on the featured pick, then the best-rated",
    card.highlights.map((item) => item.name),
    ["Canal boat at dusk", "Anne Frank House", "Van Gogh Museum"],
  );
  equal("the card still shows three highlights", card.highlights.length, 3);

  // An unrated featured item has no star to print, so the row does not offer
  // it. Featuring is about order, not a substitute for rating.
  const unrated = shareCardFromStoryTrip(
    trip("Unrated", {
      destinations: [
        stop("Somewhere", {
          experiences: [
            experience("A thought", { featuredRank: 1 }),
            experience("A meal", { rating: 7 }),
          ],
        }),
      ],
    }),
  );
  equal(
    "an unrated featured item stays out of the highlights row",
    unrated.highlights.map((item) => item.name),
    ["A meal"],
  );

  // The backdrop. A cover is chosen to crop into a banner and a card is a
  // portrait of the trip, so the hero slot overrides it when one is elected.
  const withHero = shareCardFromStoryTrip(
    trip("Hero card", {
      coverUrl: "https://example.test/cover.jpg",
      photos: [
        photo("cover"),
        photo("elected", { featuredSlot: "hero", featuredRank: 1 }),
      ],
    }),
  );
  equal(
    "the card's backdrop is the hero photo",
    withHero.coverUrl,
    "https://example.test/elected.jpg",
  );

  const noHero = shareCardFromStoryTrip(
    trip("Plain card", {
      coverUrl: "https://example.test/cover.jpg",
      photos: [photo("cover"), photo("other", { featuredRank: 1 })],
    }),
  );
  equal(
    "with no hero elected the card still uses the trip cover",
    noHero.coverUrl,
    "https://example.test/cover.jpg",
  );
}

// --- The slots the panel is built from --------------------------------------

{
  const paris = stop("Paris", {
    arrival: "2024-04-01",
    departure: "2024-04-04",
    experiences: [
      experience("Louvre", { rating: 9 }),
      experience("Pont Neuf at night", { rating: 7 }),
      experience("A very average sandwich", { rating: 3 }),
    ],
  });
  const rome = stop("Rome", {
    arrival: "2024-04-05",
    departure: "2024-04-07",
    experiences: [experience("Pantheon", { rating: 10 })],
  });
  const photos = [
    photo("p1", { dateTaken: "2024-04-01", destinationId: "Paris" }),
    photo("p2", { dateTaken: "2024-04-02", destinationId: "Paris" }),
    photo("p3", { dateTaken: "2024-04-03", destinationId: "Paris" }),
    photo("r1", { dateTaken: "2024-04-05", destinationId: "Rome" }),
  ];
  const plain = trip("Europe", {
    start: "2024-04-01",
    end: "2024-04-07",
    coverUrl: "https://example.test/p2.jpg",
    destinations: [paris, rome],
    photos,
  });

  const slots = buildCurationSlots(plain);
  check("an uncurated trip is untouched", slots.untouched);
  check("a trip with photos and experiences can be curated", hasCurationSlots(plain));

  // Every slot resolves to something with nothing elected. A slot that showed
  // nothing would be telling the user their inaction has no consequence, which
  // is the opposite of true.
  equal("the hero slot is empty", slots.hero.chosen, null);
  equal(
    "the hero slot previews the trip cover",
    slots.hero.automatic?.id,
    "p2",
  );
  check(
    "the hero slot says where its automatic answer comes from",
    slots.hero.automaticReason.length > 0,
  );
  equal(
    "the hero slot offers every photo on the trip",
    slots.hero.candidates.length,
    photos.length,
  );

  equal("one slot per stop that has photos", slots.stops.length, 2);
  equal(
    "a stop slot previews what the story would lead with",
    slots.stops[0].automatic.map((item) => item.id),
    ["p1", "p2", "p3"],
  );
  equal("a stop slot starts empty", slots.stops[0].chosen.length, 0);

  equal(
    "the highlights slot previews the best-rated three",
    slots.highlights.automatic.map((item) => item.name),
    ["Pantheon", "Louvre", "Pont Neuf at night"],
  );
  equal("the highlights slot starts empty", slots.highlights.chosen.length, 0);
  equal(
    "the highlights picker groups by stop, in visit order",
    slots.highlights.candidates.map((item) => item.destinationName),
    ["Paris", "Paris", "Paris", "Rome"],
  );
  equal(
    "and sorts best-rated first inside each stop",
    slots.highlights.candidates.map((item) => item.name),
    ["Louvre", "Pont Neuf at night", "A very average sandwich", "Pantheon"],
  );

  // The same trip, curated. Positions are what the panel renders as badges, so
  // they have to be 1..N and in the elected order rather than the raw column.
  const curatedParis = stop("Paris2", {
    arrival: "2024-04-01",
    departure: "2024-04-04",
    experiences: [
      experience("Louvre", { rating: 9 }),
      experience("Pont Neuf at night", { rating: 7, featuredRank: 1 }),
      experience("A very average sandwich", { rating: 3, featuredRank: 2 }),
    ],
  });
  const curated = trip("Europe curated", {
    start: "2024-04-01",
    end: "2024-04-07",
    destinations: [curatedParis],
    photos: [
      photo("c1", { dateTaken: "2024-04-01", destinationId: "Paris2" }),
      photo("c2", {
        dateTaken: "2024-04-02",
        destinationId: "Paris2",
        featuredSlot: "stop",
        featuredRank: 2,
      }),
      photo("c3", {
        dateTaken: "2024-04-03",
        destinationId: "Paris2",
        featuredSlot: "stop",
        featuredRank: 1,
      }),
      photo("c4", {
        dateTaken: "2024-04-04",
        destinationId: "Paris2",
        featuredSlot: "hero",
        featuredRank: 1,
      }),
    ],
  });
  const curatedSlots = buildCurationSlots(curated);
  check("a curated trip is not untouched", !curatedSlots.untouched);
  equal("the hero slot holds the elected photo", curatedSlots.hero.chosen?.id, "c4");
  equal(
    "a stop slot holds its picks in rank order, renumbered from one",
    curatedSlots.stops[0].chosen.map((item) => [item.id, item.position]),
    [
      ["c3", 1],
      ["c2", 2],
    ],
  );
  equal(
    "the highlights slot holds the elected order, not the rating order",
    curatedSlots.highlights.chosen.map((item) => item.name),
    ["Pont Neuf at night", "A very average sandwich"],
  );
  equal(
    "and positions them from one",
    curatedSlots.highlights.chosen.map((item) => item.position),
    [1, 2],
  );
  // The hero is not also a stop pick, so it never crowds out one of the four.
  check(
    "the hero photo holds no position in its stop's slot",
    curatedSlots.stops[0].chosen.every((item) => item.id !== "c4"),
  );

  // A trip with nothing in it has nothing to curate, so the entry point hides
  // rather than opening three empty slots.
  check(
    "an empty trip offers no curation",
    !hasCurationSlots(trip("Empty", { destinations: [stop("Nowhere")] })),
  );

  // One backdrop, a three-line highlights row, and for a stop two full slides'
  // worth: the picks are spread ACROSS its days, so the slide cap of four is
  // not the slot's cap. Every one of these has to stay inside the honoured
  // ceiling, or the panel would let somebody elect a rank nothing reads.
  equal("the slot capacities are the surfaces' own numbers", SLOT_CAPACITY, {
    hero: 1,
    stopPhotos: 8,
    highlights: 3,
  });
  check(
    "no slot can hold more than the model honours",
    Object.values(SLOT_CAPACITY).every(
      (capacity) => capacity <= MAX_FEATURED_HONORED,
    ),
  );
}

// --- The year recap ---------------------------------------------------------

{
  const kyoto = stop("KyotoY", {
    arrival: "2024-05-06",
    departure: "2024-05-08",
    lat: 35,
    lng: 135,
    experiences: [
      experience("Nishiki Market", { rating: 10, visitedDate: "2024-05-06" }),
      experience("Fushimi Inari", {
        rating: 7,
        visitedDate: "2024-05-06",
        featuredRank: 1,
      }),
    ],
  });
  const recap = buildYearRecap(
    {
      trips: [
        trip("Japan year", {
          start: "2024-05-06",
          end: "2024-05-08",
          destinations: [kyoto],
          photos: [
            photo("early", { dateTaken: "2024-05-06", destinationId: "KyotoY" }),
            // A stop pick, which must NOT open the year: it is an answer to a
            // different question (which photos lead this stop's slides).
            photo("stopPick", {
              dateTaken: "2024-05-07",
              destinationId: "KyotoY",
              featuredRank: 1,
              featuredSlot: "stop",
            }),
            photo("chosen", {
              dateTaken: "2024-05-08",
              destinationId: "KyotoY",
              featuredRank: 1,
              featuredSlot: "hero",
            }),
          ],
        }),
      ],
      today: "2025-01-15",
    },
    2024,
  );

  equal(
    "the recap's moments lead on the featured pick",
    recap.moments.map((moment) => moment.name),
    ["Fushimi Inari", "Nishiki Market"],
  );

  // A MOMENT NAMES ONE EXPERIENCE AND MUST SHOW A PHOTOGRAPH OF IT.
  //
  // This used to take the first photo at the experience's STOP, so on any stop
  // with more than one photograph the slide captioned the wrong picture with
  // the right name. The filter is on the experience now, and where there is no
  // photo of it the stop's cover is offered as the PLACE rather than passed
  // off as the thing.
  const gates = experience("Fushimi Inari", {
    rating: 9,
    visitedDate: "2024-05-06",
  });
  const market = experience("Nishiki Market", {
    rating: 8,
    visitedDate: "2024-05-06",
  });
  const kyotoM = stop("KyotoM", {
    arrival: "2024-05-06",
    departure: "2024-05-07",
    lat: 35,
    lng: 135,
    experiences: [gates, market],
  });
  kyotoM.coverUrl = "https://example.test/kyoto-cover.jpg";
  kyotoM.coverThumbUrl = "https://example.test/kyoto-cover.jpg_thumb";
  const momentRecap = buildYearRecap(
    {
      trips: [
        trip("Kyoto moments", {
          start: "2024-05-06",
          end: "2024-05-07",
          destinations: [kyotoM],
          photos: [
            // First in gallery order, and owned by the STOP: exactly the photo
            // the old code handed to every moment at this stop.
            photo("lunch", { dateTaken: "2024-05-06", destinationId: "KyotoM" }),
            photo("torii", {
              dateTaken: "2024-05-06",
              destinationId: "KyotoM",
              experienceId: gates.id,
            }),
          ],
        }),
      ],
      today: "2025-01-15",
    },
    2024,
  );
  const byName = new Map(
    momentRecap.moments.map((moment) => [moment.name, moment]),
  );
  equal(
    "a moment shows a photograph of its own experience",
    byName.get("Fushimi Inari")?.photoUrl,
    "https://example.test/torii.jpg",
  );
  equal(
    "and says so, so the slide can render it plainly",
    byName.get("Fushimi Inari")?.photoOf,
    "experience",
  );
  equal(
    "an experience with no photo of its own falls back to the place",
    byName.get("Nishiki Market")?.photoUrl,
    "https://example.test/kyoto-cover.jpg",
  );
  equal(
    "and is marked as the place, never as the thing",
    byName.get("Nishiki Market")?.photoOf,
    "place",
  );
  check(
    "the fallback is never another experience's photograph",
    byName.get("Nishiki Market")?.photoUrl !== "https://example.test/torii.jpg" &&
      byName.get("Nishiki Market")?.photoUrl !== "https://example.test/lunch.jpg",
  );
  const opener = recap.slides.find((slide) => slide.kind === "opener");
  if (opener && opener.kind === "opener") {
    equal(
      "the recap opens on the hero photo, not the earliest or the stop pick",
      opener.heroUrl,
      "https://example.test/chosen.jpg",
    );
    equal(
      "the opener carries a thumbnail for its placeholder",
      opener.heroThumbUrl,
      "https://example.test/chosen.jpg_thumb",
    );
    // The full image is the one the slide displays. A recap that opened on a
    // 400px thumbnail stretched across the viewport is the bug this pair fixes.
    check(
      "the opener's hero is the full image, not the thumbnail",
      opener.heroUrl !== null && !opener.heroUrl.endsWith("_thumb"),
    );
  }

  // Without curation the earliest dated photo opens the year and the top
  // rating leads the moments, exactly as before.
  const plain = buildYearRecap(
    {
      trips: [
        trip("Japan plain year", {
          start: "2024-05-06",
          end: "2024-05-08",
          destinations: [
            stop("KyotoP", {
              arrival: "2024-05-06",
              departure: "2024-05-08",
              lat: 35,
              lng: 135,
              experiences: [
                experience("Nishiki Market", {
                  rating: 10,
                  visitedDate: "2024-05-06",
                }),
                experience("Fushimi Inari", {
                  rating: 7,
                  visitedDate: "2024-05-06",
                }),
              ],
            }),
          ],
          photos: [
            photo("earlyP", { dateTaken: "2024-05-06", destinationId: "KyotoP" }),
            photo("lateP", { dateTaken: "2024-05-08", destinationId: "KyotoP" }),
          ],
        }),
      ],
      today: "2025-01-15",
    },
    2024,
  );
  equal(
    "with nothing featured, the moments lead on the top rating",
    plain.moments.map((moment) => moment.name),
    ["Nishiki Market", "Fushimi Inari"],
  );
  const plainOpener = plain.slides.find((slide) => slide.kind === "opener");
  if (plainOpener && plainOpener.kind === "opener") {
    equal(
      "with nothing featured, the recap opens on the earliest dated photo",
      plainOpener.heroUrl,
      "https://example.test/earlyP.jpg",
    );
  }
}

// --- Report -----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nCuration: ${failures.length} check(s) failed.\n`);
  for (const failure of failures) console.error(`  x ${failure}`);
  console.error("");
  process.exit(1);
}
console.log(`Curation: ${passed} checks passed.`);
