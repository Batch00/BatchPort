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
  compareCurated,
  compareFeatured,
  featuredFirst,
  isFeatured,
  nextFeaturedRank,
} from "../src/lib/curation";
import {
  buildStorySlides,
  storyClosingStats,
  type StoryDestination,
  type StoryExperience,
  type StoryPhoto,
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
    featuredRank?: number | null;
  } = {},
): StoryPhoto {
  return {
    id: name,
    url: `https://example.test/${name}.jpg`,
    thumbUrl: `https://example.test/${name}.jpg_thumb`,
    dateTaken: options.dateTaken ?? null,
    attribution: null,
    featuredRank: options.featuredRank ?? null,
    destinationId: options.destinationId ?? null,
  };
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
    equal(
      "the featured photo leads its slide",
      day.photos.map((item) => item.id),
      ["gates", "crowd"],
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
            photo("chosen", {
              dateTaken: "2024-05-08",
              destinationId: "KyotoY",
              featuredRank: 1,
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
  const opener = recap.slides.find((slide) => slide.kind === "opener");
  if (opener && opener.kind === "opener") {
    equal(
      "the recap opens on the featured photo, not the earliest one",
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
