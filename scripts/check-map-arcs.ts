// Deterministic checks for transport arc families on the drawn maps.
//
// The globe has drawn three arc families since transport legs shipped (air
// solid blue, ground violet dashed, sea cyan dotted) and so has the recap's
// animated map slide, but the two exported CARDS drew every hop the same. This
// asserts that the families now reach them, and, just as importantly, that a
// trip nobody annotated still draws the uniform blue route it always did.
//
// Everything here is pure: folding a StoryTrip into card data and a recap into
// year card data reads nothing and writes nothing, which is the same property
// that lets /demo and /share export a card at all.
//
// Run with: npm run check-map-arcs

import { familyArcDash, type MapLeg } from "../src/lib/poster/draw-map";
import { shareCardFromStoryTrip } from "../src/lib/poster/share-card";
import { yearCardFromRecap } from "../src/lib/poster/year-card";
import { buildPosterData } from "../src/lib/poster/poster-data";
import type { StatsData } from "../src/lib/stats-data";
import type { StoryDestination, StoryTrip } from "../src/lib/story";
import { arcFamily, type TransportMode } from "../src/lib/transport";
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

/** A located stop, optionally carrying the mode it was REACHED by. */
function stop(
  name: string,
  lat: number,
  lng: number,
  options: { mode?: TransportMode | null; arrival?: string | null } = {},
): StoryDestination {
  return {
    id: name,
    name,
    countryCode: "FR",
    arrivalDate: options.arrival ?? null,
    departureDate: options.arrival ?? null,
    latitude: lat,
    longitude: lng,
    coverUrl: null,
    coverThumbUrl: null,
    transportMode: options.mode ?? null,
    experiences: [],
  };
}

function trip(
  name: string,
  destinations: StoryDestination[],
  options: { start?: string | null; end?: string | null } = {},
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
    destinations,
    photos: [],
    journal: {},
  };
}

const families = (legs: MapLeg[]): (string | undefined)[] =>
  legs.map((leg) => leg.family);

// --- The mapping itself -----------------------------------------------------

{
  equal("a flight is air", arcFamily("flight"), "air");
  equal("a train is ground", arcFamily("train"), "ground");
  equal("a bus is ground", arcFamily("bus"), "ground");
  equal("a car is ground", arcFamily("car"), "ground");
  equal("a bike is ground", arcFamily("bike"), "ground");
  equal("a walk is ground", arcFamily("walk"), "ground");
  equal("a ferry is sea", arcFamily("ferry"), "sea");
  equal("other is ground", arcFamily("other"), "ground");
  // The one that keeps every existing map looking the way it looked.
  equal("an unrecorded hop is air", arcFamily(null), "air");

  // The dash patterns, which are what the eye actually reads. Air is solid,
  // and a solid line is an EMPTY dash array rather than a long one: a nonempty
  // pattern would put gaps in the one family that must not have them.
  equal("air draws solid", familyArcDash("air", 4), []);
  equal("ground draws dashed", familyArcDash("ground", 4), [10.4, 7.2]);
  // A zero-length dash with a round cap is a dot, which is how the globe draws
  // a ferry, so the card has to do the same thing rather than a short dash.
  equal("sea draws dotted", familyArcDash("sea", 4), [0, 8.8]);
  check(
    "the patterns scale with the line width",
    familyArcDash("ground", 8)[0] === familyArcDash("ground", 4)[0] * 2,
  );
}

// --- The trip share card ----------------------------------------------------

{
  // Paris, then a train to Lyon, a ferry to Ajaccio, and a flight back. The
  // mode sits on the ARRIVING stop, so Paris (the first stop, reached from
  // home) contributes no leg at all and Lyon's train styles the Paris to Lyon
  // arc.
  const card = shareCardFromStoryTrip(
    trip("France", [
      stop("Paris", 48.86, 2.35),
      stop("Lyon", 45.76, 4.84, { mode: "train" }),
      stop("Ajaccio", 41.93, 8.74, { mode: "ferry" }),
      stop("Nice", 43.7, 7.27, { mode: "flight" }),
    ]),
  );
  equal("the card draws one leg per hop", card.legs.length, 3);
  equal(
    "and styles each by how that hop was travelled",
    families(card.legs),
    ["ground", "sea", "air"],
  );

  // An unannotated trip: every arc air, which is the uniform blue route the
  // card drew before any of this existed.
  const plain = shareCardFromStoryTrip(
    trip("Unannotated", [
      stop("Porto", 41.15, -8.61),
      stop("Lisbon", 38.72, -9.14),
      stop("Faro", 37.02, -7.93),
    ]),
  );
  equal(
    "an unannotated trip is uniformly air",
    families(plain.legs),
    ["air", "air"],
  );

  // A partly annotated trip keeps the recorded hop styled and leaves the rest
  // alone, rather than guessing a mode for the hops nobody recorded.
  const partial = shareCardFromStoryTrip(
    trip("Half recorded", [
      stop("Oslo", 59.91, 10.75),
      stop("Bergen", 60.39, 5.32, { mode: "train" }),
      stop("Tromso", 69.65, 18.96),
    ]),
  );
  equal(
    "an unrecorded hop beside a recorded one stays air",
    families(partial.legs),
    ["ground", "air"],
  );

  // A stop with no coordinates cannot be drawn, and the leg must close over
  // the gap rather than the modes sliding onto the wrong arcs.
  const gappy = trip("Gappy", [
    stop("Madrid", 40.42, -3.7),
    stop("Nowhere", 0, 0, { mode: "bus" }),
    stop("Seville", 37.39, -5.98, { mode: "ferry" }),
  ]);
  gappy.destinations[1].latitude = null;
  gappy.destinations[1].longitude = null;
  const gappyCard = shareCardFromStoryTrip(gappy);
  equal(
    "an unlocatable stop drops out and the drawn hop keeps its own mode",
    families(gappyCard.legs),
    ["sea"],
  );
}

// --- The year card ----------------------------------------------------------

{
  const recap = buildYearRecap(
    {
      trips: [
        trip(
          "Rail year",
          [
            stop("Berlin", 52.52, 13.4, { arrival: "2024-05-01" }),
            stop("Prague", 50.08, 14.44, {
              mode: "train",
              arrival: "2024-05-04",
            }),
          ],
          { start: "2024-05-01", end: "2024-05-06" },
        ),
        trip(
          "Island hop",
          [
            stop("Athens", 37.98, 23.73, { arrival: "2024-08-01" }),
            stop("Naxos", 37.1, 25.38, {
              mode: "ferry",
              arrival: "2024-08-04",
            }),
          ],
          { start: "2024-08-01", end: "2024-08-06" },
        ),
      ],
      transportModes: {},
      today: "2025-02-01",
    },
    2024,
  );
  const card = yearCardFromRecap(recap);

  // Two trips of two stops each: two legs, and never a third one joining the
  // end of one trip to the start of the next.
  equal("the year card draws one leg per hop, per trip", card.legs.length, 2);
  equal(
    "each carrying its own hop's family",
    families(card.legs),
    ["ground", "sea"],
  );

  // The recap's own transportModes map is the other way a mode reaches the
  // year (it is what the launcher passes from the trip's transport rows), and
  // it has to land on the same arcs.
  const viaModes = buildYearRecap(
    {
      trips: [
        trip(
          "Modes by map",
          [
            stop("Lima", -12.05, -77.04, { arrival: "2024-09-01" }),
            stop("Cusco", -13.53, -71.97, { arrival: "2024-09-05" }),
          ],
          { start: "2024-09-01", end: "2024-09-08" },
        ),
      ],
      transportModes: { Cusco: "bus" },
      today: "2025-02-01",
    },
    2024,
  );
  equal(
    "a mode passed on the recap's own map lands on the arriving hop",
    families(yearCardFromRecap(viaModes).legs),
    ["ground"],
  );

  const plain = buildYearRecap(
    {
      trips: [
        trip(
          "Unannotated year",
          [
            stop("Tokyo", 35.68, 139.69, { arrival: "2023-04-01" }),
            stop("Kyoto", 35.01, 135.77, { arrival: "2023-04-05" }),
          ],
          { start: "2023-04-01", end: "2023-04-09" },
        ),
      ],
      today: "2025-02-01",
    },
    2023,
  );
  equal(
    "an unannotated year is uniformly air",
    families(yearCardFromRecap(plain).legs),
    ["air"],
  );
}

// --- The poster is deliberately left uniform --------------------------------
//
// Its one legend slot is spent on visited versus bucket fills, and a print
// with three unexplained line treatments on it is a puzzle rather than a
// poster. It passes no family, so every arc resolves to air and the file
// prints exactly as it did.

{
  const poster = buildPosterData(
    {
      destinations: [],
      visitedCountryCodes: ["IS", "NO"],
      plannedCountryCodes: [],
      bucketCountryCodes: [],
      bucketPlaces: [],
      arcs: [
        {
          sourcePosition: [-21.94, 64.15],
          targetPosition: [10.75, 59.91],
          tripName: "North",
          sourceCity: "Reykjavik",
          targetCity: "Oslo",
          planned: false,
          // Recorded on the map, and deliberately not carried onto the print.
          mode: "ferry",
        },
      ],
      stats: { countries: 2, trips: 1, destinations: 2 },
    },
    { summary: null, distanceKm: null } as unknown as StatsData,
  );
  check(
    "the poster passes no family, so its arcs stay uniform",
    poster.legs.length === 1 && poster.legs[0].family === undefined,
  );
}

// --- Report -----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nMap arcs: ${failures.length} check(s) failed.\n`);
  for (const failure of failures) console.error(`  x ${failure}`);
  console.error("");
  process.exit(1);
}
console.log(`Map arcs: ${passed} checks passed.`);
