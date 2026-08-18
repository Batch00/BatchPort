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
  stopPhotoCapacity,
  stopPhotoRank,
  stopPhotosFirst,
  type PhotoSlot,
} from "../src/lib/curation";
import {
  applyCurationSelection,
  buildCurationSlots,
  hasCurationSelection,
  hasCurationSlots,
  planStopSelection,
  summarizeStopSelection,
  type StopPhotoSlot,
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

  // The opener names EVERY stop. It used to be a string capped at four with
  // "and N more" after it, which hid most of a long trip on the one slide whose
  // job is to introduce it. The view fits the whole list instead.
  const names = ["Lisbon", "Porto", "Coimbra", "Braga", "Faro", "Evora"];
  const longTrip = trip("Portugal", {
    destinations: names.map((name) => stop(name)),
  });
  const openerSlide = buildStorySlides(longTrip).find(
    (slide) => slide.kind === "opener",
  );
  equal(
    "the story opener names every stop, however many there are",
    openerSlide && openerSlide.kind === "opener" ? openerSlide.places : [],
    names,
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
  // them, so it cannot describe a spread the slides do not make.
  const slot = buildCurationSlots(spreadTrip).stops[0];
  equal("the panel knows how many day slides the stop has", slot.days.length, 4);
  equal(
    "and states each day's outcome, not the algorithm",
    planStopSelection(slot, slot.chosen).days,
    [
      { kind: "picks", count: 1 },
      { kind: "picks", count: 1 },
      { kind: "picks", count: 1 },
      { kind: "picks", count: 1 },
    ],
  );
  equal(
    "including when there are more picks than days",
    planStopSelection(slot, [
      ...slot.chosen,
      { id: "x", url: "", thumbUrl: "", dateTaken: null, position: null },
    ]).days,
    [
      { kind: "picks", count: 2 },
      { kind: "picks", count: 1 },
      { kind: "picks", count: 1 },
      { kind: "picks", count: 1 },
    ],
  );
  // THE BEHAVIOUR THE PANEL NOW SHOWS PER DAY: a day with picks shows only
  // those, and a day without falls back to its own photographs. Both halves
  // asserted here and against real slides further down.
  equal(
    "and marks the days that will fall back to their own photos",
    planStopSelection(slot, slot.chosen.slice(0, 2)).days,
    [
      { kind: "picks", count: 1 },
      { kind: "picks", count: 1 },
      { kind: "own", count: 1 },
      { kind: "own", count: 1 },
    ],
  );
  // With nothing chosen every day is on its own photos, and the first one also
  // carries the undated ones, exactly as buildStorySlides places them.
  equal(
    "with nothing chosen every day falls back, the first taking the leftovers",
    planStopSelection(slot, []).days,
    [
      { kind: "own", count: 5 },
      { kind: "own", count: 1 },
      { kind: "own", count: 1 },
      { kind: "own", count: 1 },
    ],
  );
  // The one line left over: a pick that found no seat. Everything else is on
  // the day headings, so there is nothing else to say.
  equal(
    "and says nothing when every pick landed",
    summarizeStopSelection(slot, slot.chosen),
    "",
  );

  // The picker's grouping: every candidate sits under the day it was taken on,
  // and the ones with no day slide of their own are named rather than hidden.
  equal(
    "candidates are grouped by the day they were taken",
    slot.days.map((day) => day.candidates.map((photo) => photo.id)),
    [["own1"], ["own2"], ["own3"], ["own4"]],
  );
  equal(
    "and the undated ones are their own group",
    slot.spare.map((photo) => photo.id),
    ["p1", "p2", "p3", "p4"],
  );
  equal(
    "every candidate appears in exactly one group",
    slot.days.reduce((total, day) => total + day.candidates.length, 0) +
      slot.spare.length,
    slot.candidates.length,
  );
  equal(
    "and the days carry their trip day numbers for the headings",
    slot.days.map((day) => day.dayNumber),
    [1, 2, 3, 4],
  );
}

// --- A day the picker says will fall back, and what it falls back TO ---------
//
// The panel states an outcome per day; these are the two outcomes it can state
// besides "your picks", checked against the slides the reader actually meets.

{
  const DAYS = ["2024-07-01", "2024-07-02"];
  // Day one is photographed, day two is only written about, so day two is a
  // real slide with no photograph of its own: the stop cover case.
  const coverTrip = trip("Cover fallback", {
    start: DAYS[0],
    end: DAYS[1],
    destinations: [
      stop("CoverStop", { arrival: DAYS[0], departure: DAYS[1] }),
    ],
    photos: [
      photo("cf-1", { dateTaken: DAYS[0], destinationId: "CoverStop" }),
      photo("cf-2", { dateTaken: DAYS[0], destinationId: "CoverStop" }),
    ],
  });
  coverTrip.journal = { [DAYS[1]]: "Rained all day." };
  const coverSlot = buildCurationSlots(coverTrip).stops[0] as StopPhotoSlot;
  equal("both days are offered in the picker", coverSlot.days.length, 2);
  equal(
    "a day nobody photographed still appears, and says it falls back",
    planStopSelection(coverSlot, []).days,
    [
      { kind: "own", count: 2 },
      { kind: "cover" },
    ],
  );
  equal(
    "and it has no candidates of its own to offer",
    coverSlot.days[1].candidates.length,
    0,
  );

  // The slides agree: the curated day shows the pick alone, the other shows
  // nothing of its own, which is what puts the stop cover behind it.
  const curatedCover = trip("Cover fallback curated", {
    start: DAYS[0],
    end: DAYS[1],
    destinations: [stop("CoverStop2", { arrival: DAYS[0], departure: DAYS[1] })],
    photos: [
      photo("cc-1", { dateTaken: DAYS[0], destinationId: "CoverStop2" }),
      pick("cc-pick", 1, { dateTaken: DAYS[0], destinationId: "CoverStop2" }),
    ],
  });
  curatedCover.journal = { [DAYS[1]]: "Rained all day." };
  const coverDays = buildStorySlides(curatedCover).filter(
    (slide): slide is Extract<StorySlide, { kind: "day" }> =>
      slide.kind === "day",
  );
  equal(
    "the picked day shows the pick alone and the other shows no photo at all",
    coverDays.map((slide) => slide.photos.map((item) => item.id)),
    [["cc-pick"], []],
  );
  check(
    "so the empty day has a stop to draw its cover from",
    coverDays[1].destination?.id === "CoverStop2",
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

  // One backdrop and a three-line highlights row: the two slots whose capacity
  // is a fixed number, because the surface they name draws a fixed number.
  // Both have to stay inside the honoured ceiling for experience ranks, or the
  // panel would let somebody elect a rank nothing reads.
  equal("the fixed slot capacities are the surfaces' own numbers", SLOT_CAPACITY, {
    hero: 1,
    highlights: 3,
  });
  check(
    "no fixed slot can hold more than the model honours",
    Object.values(SLOT_CAPACITY).every(
      (capacity) => capacity <= MAX_FEATURED_HONORED,
    ),
  );
}

// --- A stop's capacity is its own slide capacity -----------------------------
//
// It used to be a flat 8, which was a guess: two full slides on a two day stop
// (so half the picks had nowhere to sit) and a quarter of the seats on a
// fortnight in one city. It is now derived from the seats that actually exist,
// and the two halves of that are asserted here: the derivation itself, and that
// nothing between the panel and the slide silently drops a pick inside it.

{
  equal(
    "an undated stop keeps one slide's worth as its floor",
    stopPhotoCapacity(0),
    SLIDE_PHOTO_CAP,
  );
  equal("a one day stop caps at four", stopPhotoCapacity(1), 4);
  equal("a three day stop caps at twelve", stopPhotoCapacity(3), 12);
  equal("a ten day stop caps at forty", stopPhotoCapacity(10), 40);

  /** A stop of `days` days, one ordinary photo per day so every day is a real
   * slide, plus `picks` undated picks ranked from one. */
  function stopOfDays(
    name: string,
    days: number,
    picks: number,
    options: { dated?: boolean } = {},
  ): { built: StoryTrip; stopId: string; dates: string[] } {
    const stopId = `${name}Stop`;
    const dates = Array.from(
      { length: days },
      (_, index) => `2024-09-${String(index + 1).padStart(2, "0")}`,
    );
    const own = dates.map((date) =>
      photo(`${name}-own-${date}`, { dateTaken: date, destinationId: stopId }),
    );
    const chosen = Array.from({ length: picks }, (_, index) =>
      pick(`${name}-pick${index + 1}`, index + 1, {
        destinationId: stopId,
        dateTaken: options.dated ? dates[index % Math.max(1, days)] : null,
      }),
    );
    return {
      built: trip(name, {
        start: dates[0] ?? null,
        end: dates[dates.length - 1] ?? null,
        destinations: [
          stop(stopId, {
            arrival: dates[0] ?? null,
            departure: dates[dates.length - 1] ?? null,
          }),
        ],
        photos: [...own, ...chosen],
      }),
      stopId,
      dates,
    };
  }

  const dayPhotoIds = (built: StoryTrip, stopId: string): string[][] =>
    buildStorySlides(built)
      .filter(
        (slide): slide is Extract<StorySlide, { kind: "day" }> =>
          slide.kind === "day" && slide.destination?.id === stopId,
      )
      .map((slide) => slide.photos.map((item) => item.id));

  // A ONE DAY STOP. Four seats, and a fifth pick is not honoured: the panel
  // refuses it, and if a stale one is already stored the slide still draws four.
  const one = stopOfDays("Oneday", 1, 5);
  const oneSlot = buildCurationSlots(one.built).stops[0];
  equal("a one day stop's slot says four", oneSlot.capacity, 4);
  equal(
    "and honours exactly four picks, not the fifth",
    oneSlot.chosen.map((item) => item.id),
    [
      "Oneday-pick1",
      "Oneday-pick2",
      "Oneday-pick3",
      "Oneday-pick4",
    ],
  );
  equal(
    "and its one slide draws those four",
    dayPhotoIds(one.built, one.stopId),
    [["Oneday-pick1", "Oneday-pick2", "Oneday-pick3", "Oneday-pick4"]],
  );

  // A MULTI-DAY STOP AT THE NEW MAXIMUM. Ten days, forty picks: every one is
  // honoured, every one is placed, and no day takes more than a slide draws.
  // Under the old flat cap of 8 this dropped 32 of them on the floor while the
  // picker went on offering them.
  const ten = stopOfDays("Tenday", 10, 40);
  const tenSlot = buildCurationSlots(ten.built).stops[0];
  equal("a ten day stop's slot says forty", tenSlot.capacity, 40);
  equal("the stop really produced ten day slides", tenSlot.days.length, 10);
  equal("and every one of the forty picks is honoured", tenSlot.chosen.length, 40);
  const tenPlan = planStopSelection(tenSlot, tenSlot.chosen);
  equal("every pick finds a seat", tenPlan.unplaced, 0);
  equal("and they are placed, not merely counted", tenPlan.placed, 40);
  const tenDrawn = dayPhotoIds(ten.built, ten.stopId);
  equal(
    "each of the ten days draws a full slide of picks",
    tenDrawn.map((ids) => ids.length),
    Array.from({ length: 10 }, () => SLIDE_PHOTO_CAP),
  );
  check(
    "and the slides draw the picks themselves, none of the day's own photos",
    tenDrawn.every((ids) => ids.every((photoId) => photoId.includes("-pick"))),
  );
  // A rank past the old ceiling of 8 is a rank the model now reads, which is
  // the specific silent drop this change removes.
  check(
    "a rank past the old flat ceiling still leads a slide",
    tenDrawn.flat().includes(`Tenday-pick${MAX_FEATURED_HONORED + 1}`),
  );

  // AN UNDATED STOP. No day slides, one stop slide, so the floor applies.
  const undatedStop = trip("Undated capacity", {
    destinations: [stop("UndatedCap")],
    photos: [
      photo("uc-own", { destinationId: "UndatedCap" }),
      ...Array.from({ length: 6 }, (_, index) =>
        pick(`uc-pick${index + 1}`, index + 1, { destinationId: "UndatedCap" }),
      ),
    ],
  });
  const undatedSlot = buildCurationSlots(undatedStop).stops[0];
  equal("an undated stop's slot says four", undatedSlot.capacity, 4);
  equal("it offers no day groups", undatedSlot.days.length, 0);
  equal(
    "and honours four picks",
    undatedSlot.chosen.map((item) => item.id),
    ["uc-pick1", "uc-pick2", "uc-pick3", "uc-pick4"],
  );
  const undatedSlide = buildStorySlides(undatedStop).find(
    (slide) => slide.kind === "stop",
  );
  equal(
    "and its single slide draws exactly those",
    undatedSlide && undatedSlide.kind === "stop"
      ? undatedSlide.photos.map((item) => item.id)
      : [],
    ["uc-pick1", "uc-pick2", "uc-pick3", "uc-pick4"],
  );

  // The uncurated path, at the new capacity: a ten day stop with nothing
  // elected still shows every day its own photographs and nothing else.
  const tenPlain = stopOfDays("Tenplain", 10, 0);
  equal(
    "a ten day stop with nothing elected is untouched",
    dayPhotoIds(tenPlain.built, tenPlain.stopId).map((ids) => ids.length),
    Array.from({ length: 10 }, () => 1),
  );
}

// --- Applying a selection the server has not confirmed yet -------------------
//
// The panel saves immediately, but "saved" and "back in the props" are two
// different moments, and the story preview has to show the composition the
// traveller is looking at rather than the one before their last tap. So the
// panel applies its live selection to the trip and previews that.
//
// The round trip is the check that matters: apply a selection, rebuild the
// slots, and get that selection back. It is what stops applyCurationSelection
// drifting from what the three server actions actually write.

{
  const stopId = "SelStop";
  const other = "SelStop2";
  const base = trip("Selection", {
    start: "2024-03-01",
    end: "2024-03-04",
    coverUrl: "https://example.test/s1.jpg",
    destinations: [
      stop(stopId, {
        arrival: "2024-03-01",
        departure: "2024-03-02",
        experiences: [
          experience("Market", { rating: 6 }),
          experience("Cathedral", { rating: 9 }),
          experience("Bridge", { rating: 8 }),
        ],
      }),
      stop(other, { arrival: "2024-03-03", departure: "2024-03-04" }),
    ],
    photos: [
      photo("s1", { dateTaken: "2024-03-01", destinationId: stopId }),
      photo("s2", { dateTaken: "2024-03-01", destinationId: stopId }),
      photo("s3", { dateTaken: "2024-03-02", destinationId: stopId }),
      photo("o1", { dateTaken: "2024-03-03", destinationId: other }),
    ],
  });

  // Nothing selected is nothing applied, and deliberately the SAME object: an
  // untouched panel previews the real story rather than a reconstruction of it.
  check("an empty selection is not a selection", !hasCurationSelection({}));
  check(
    "and applying it returns the trip untouched",
    applyCurationSelection(base, {}) === base,
  );

  const experienceIds = base.destinations[0].experiences.map((item) => item.id);
  const applied = applyCurationSelection(base, {
    heroId: "s3",
    stopPhotoIds: { [stopId]: ["s2", "s1"] },
    highlightIds: [experienceIds[0], experienceIds[2]],
  });
  const appliedSlots = buildCurationSlots(applied);

  equal("the hero comes back as chosen", appliedSlots.hero.chosen?.id, "s3");
  equal(
    "the stop's picks come back in the order they were put in",
    appliedSlots.stops
      .find((slot) => slot.destinationId === stopId)
      ?.chosen.map((item) => [item.id, item.position]),
    [
      ["s2", 1],
      ["s1", 2],
    ],
  );
  equal(
    "the highlights come back in the order they were put in",
    appliedSlots.highlights.chosen.map((item) => item.name),
    ["Market", "Bridge"],
  );

  // The other stop was not in the selection, so nothing of its was touched.
  equal(
    "a stop the selection did not name is left alone",
    appliedSlots.stops.find((slot) => slot.destinationId === other)?.chosen
      .length,
    0,
  );

  // And the surfaces read it, which is the whole point of previewing it.
  const previewDay = buildStorySlides(applied).find(
    (slide) => slide.kind === "day" && slide.destination?.id === stopId,
  );
  // Both picks are dated this day, so both lead it, in the order they were
  // put in rather than the order the gallery holds them (s1 before s2). That
  // ordering is the whole reason the preview has to read the live selection.
  equal(
    "the story slides draw the unsaved picks, in the chosen order",
    previewDay && previewDay.kind === "day"
      ? previewDay.photos.map((item) => item.id)
      : [],
    ["s2", "s1"],
  );
  equal(
    "and the share card is backed by the unsaved hero",
    shareCardFromStoryTrip(applied).coverUrl,
    "https://example.test/s3.jpg",
  );

  // Clearing back to automatic is the same call with nothing in it, exactly as
  // it is against the server.
  const cleared = buildCurationSlots(
    applyCurationSelection(applied, {
      heroId: null,
      stopPhotoIds: { [stopId]: [] },
      highlightIds: [],
    }),
  );
  check(
    "clearing every slot returns the trip to automatic",
    cleared.untouched &&
      cleared.hero.chosen === null &&
      cleared.highlights.chosen.length === 0,
  );

  // A hero elected out of a stop's own photographs survives that stop's slot
  // being rewritten, because the two are independent elections. This mirrors
  // setStopPhotosAction, which clears only `featured_slot` null or 'stop'.
  const heroThenStop = applyCurationSelection(
    applyCurationSelection(base, { heroId: "s1" }),
    { stopPhotoIds: { [stopId]: ["s2"] } },
  );
  const bothSlots = buildCurationSlots(heroThenStop);
  equal("the hero survives its stop's slot being set", bothSlots.hero.chosen?.id, "s1");
  equal(
    "and is not also counted as one of that stop's picks",
    bothSlots.stops
      .find((slot) => slot.destinationId === stopId)
      ?.chosen.map((item) => item.id),
    ["s2"],
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

  // Without curation the trip resolves its hero the automatic way (no cover on
  // this fixture, so its earliest dated photograph) and the top rating leads
  // the moments, exactly as before. The rest of that chain is asserted in
  // check-year-recap, which owns the year's own logic.
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
      "with nothing featured, the recap opens on the trip's automatic hero",
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
