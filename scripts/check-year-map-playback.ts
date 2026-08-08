// Deterministic checks for the recap map slide's playback clock.
//
// The map slide is the one thing in the app that animates on its own, and the
// bug it shipped with was a pacing bug: changing the speed appeared to stop the
// year after roughly one trip. The cause was not arithmetic (the clock was
// already accumulated) but lifetime: the clock lived inside the animation
// effect, and that effect is rebuilt whenever the canvas is, so every rebuild
// silently restarted the year from zero. The header above the canvas loses a
// line the moment the first trip ends, which resized the canvas, which rebuilt
// the effect, which is why it always died at the same place.
//
// So the clock is now a pure function (advancePlayback) driven from a ref that
// outlives the effect, and both halves are asserted here: that every speed
// reaches the end of a real multi-trip timeline, that changing speed mid-flight
// rescales what is LEFT rather than jumping or truncating, that skip lands on
// the end, and that a rebuild mid-playback resumes rather than restarting.
//
// Pure functions against a fixture. No browser, no database, no dev server.
//
// Run with: npm run check-year-map-playback

import {
  advancePlayback,
  buildReplayTimeline,
  replayStateAt,
  type ReplayInputStop,
  type ReplayTimeline,
} from "../src/lib/replay";

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

function close(name: string, actual: number, expected: number, tolerance: number): void {
  const ok = Math.abs(actual - expected) <= tolerance;
  check(
    name,
    ok,
    ok ? undefined : `expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
}

// --- Fixture: a real multi-trip year ----------------------------------------

function stop(
  tripId: string,
  tripName: string,
  name: string,
  countryCode: string,
  arrivalDate: string,
  lat: number,
  lng: number,
  orderIndex: number,
): ReplayInputStop {
  return {
    tripId,
    tripName,
    tripStartDate: null,
    tripEndDate: null,
    orderIndex,
    name,
    countryCode,
    lat,
    lng,
    arrivalDate,
    planned: false,
  };
}

// Four trips across one year, twelve stops, eight legs: enough that "stopped
// after roughly one trip" is unmistakably different from "played to the end".
const stops: ReplayInputStop[] = [
  stop("t1", "Japan", "Tokyo", "JP", "2024-03-02", 35.68, 139.69, 0),
  stop("t1", "Japan", "Kyoto", "JP", "2024-03-08", 35.01, 135.77, 1),
  stop("t1", "Japan", "Osaka", "JP", "2024-03-13", 34.69, 135.5, 2),
  stop("t2", "Iberia", "Lisbon", "PT", "2024-06-04", 38.72, -9.14, 0),
  stop("t2", "Iberia", "Seville", "ES", "2024-06-09", 37.39, -5.98, 1),
  stop("t2", "Iberia", "Madrid", "ES", "2024-06-14", 40.42, -3.7, 2),
  stop("t3", "Norway", "Oslo", "NO", "2024-08-01", 59.91, 10.75, 0),
  stop("t3", "Norway", "Bergen", "NO", "2024-08-05", 60.39, 5.32, 1),
  stop("t4", "Chile", "Santiago", "CL", "2024-11-10", -33.45, -70.67, 0),
  stop("t4", "Chile", "Valparaiso", "CL", "2024-11-14", -33.05, -71.62, 1),
  stop("t4", "Chile", "Puerto Natales", "CL", "2024-11-19", -51.73, -72.51, 2),
  stop("t4", "Chile", "Punta Arenas", "CL", "2024-11-25", -53.16, -70.91, 3),
];

const timeline = buildReplayTimeline(stops);
if (!timeline) {
  console.error("Playback: the fixture produced no timeline.");
  process.exit(1);
}
const line: ReplayTimeline = timeline;

check("the fixture builds a multi-trip timeline", line.trips.length === 4);
check("the fixture has legs to draw", line.legs.length === 8);
check("the timeline has a positive duration", line.duration > 0);

// --- A frame loop, exactly as the component drives it -----------------------

const FRAME = 1 / 60;
// Enough frames for a 90 second timeline at 1x with plenty of headroom, so a
// run that fails to finish fails on the assertion rather than on the budget.
const MAX_FRAMES = 60 * 200;

interface RunOptions {
  speed: number;
  /** Wall-clock second at which the speed changes, and what it changes to. */
  changeAt?: { seconds: number; speed: number };
  /** Wall-clock second at which skip is pressed. */
  skipAt?: number;
  /** Wall-clock second at which the animation effect is torn down and rebuilt
   * (a resize, the outlines arriving). The clock survives it; `previous` does
   * not, so the rebuilt loop's first frame carries no elapsed time. */
  rebuildAt?: number;
}

interface RunResult {
  /** Real seconds the playback took. */
  wall: number;
  clock: number;
  ended: boolean;
  frames: number;
  /** The distinct trip names the readout passed through, in order. */
  tripsSeen: string[];
}

function run(options: RunOptions): RunResult {
  let clock = 0;
  let speed = options.speed;
  let skipping = false;
  let wall = 0;
  let frames = 0;
  let ended = false;
  let rebuilt = false;
  // The rebuilt loop starts with `previous = 0`, so its very first frame
  // advances nothing. Modelled, because a rebuild that reset the clock instead
  // is exactly the bug this file exists to catch.
  let pendingFirstFrame = false;
  const tripsSeen: string[] = [];

  while (frames < MAX_FRAMES) {
    frames += 1;
    wall += FRAME;
    if (options.changeAt && wall >= options.changeAt.seconds) {
      speed = options.changeAt.speed;
    }
    if (options.skipAt !== undefined && wall >= options.skipAt) skipping = true;
    if (options.rebuildAt !== undefined && !rebuilt && wall >= options.rebuildAt) {
      rebuilt = true;
      pendingFirstFrame = true;
    }

    const dt = pendingFirstFrame ? 0 : FRAME;
    pendingFirstFrame = false;
    const step = advancePlayback(
      clock,
      dt,
      speed,
      line.duration,
      skipping ? "skip" : "play",
    );
    clock = step.clock;
    ended = step.ended;

    const state = replayStateAt(line, clock);
    if (state.tripName && tripsSeen[tripsSeen.length - 1] !== state.tripName) {
      tripsSeen.push(state.tripName);
    }
    if (ended) break;
  }

  return { wall, clock, ended, frames, tripsSeen };
}

// --- Every speed completes the year -----------------------------------------

const baseline = run({ speed: 1 });
check("1x reaches the end of the year", baseline.ended);
equal("1x ends exactly on the duration", baseline.clock, line.duration);
equal(
  "1x passes through every trip in order",
  baseline.tripsSeen,
  ["Japan", "Iberia", "Norway", "Chile"],
);
close("1x takes about the timeline's own length", baseline.wall, line.duration, 0.2);

for (const speed of [2, 4]) {
  const result = run({ speed });
  check(`${speed}x reaches the end of the year`, result.ended);
  equal(`${speed}x ends exactly on the duration`, result.clock, line.duration);
  // The whole reported symptom: a faster speed used to stop after roughly one
  // trip. Every trip has to appear, in order, at every speed.
  equal(
    `${speed}x still passes through every trip`,
    result.tripsSeen,
    ["Japan", "Iberia", "Norway", "Chile"],
  );
  close(
    `${speed}x takes a ${speed}th of the time`,
    result.wall,
    line.duration / speed,
    0.2,
  );
}

// --- Changing speed mid-flight rescales what is left ------------------------

{
  // Half the year at 1x, then 4x for the rest. If the clock were derived from
  // a start stamp and a rate this would jump forward; if the effect restarted
  // it would truncate. Accumulating means the remaining half takes a quarter
  // as long and nothing is skipped.
  const changeAt = line.duration / 2;
  const result = run({ speed: 1, changeAt: { seconds: changeAt, speed: 4 } });
  check("a mid-flight speed change still finishes the year", result.ended);
  equal("a mid-flight speed change ends on the duration", result.clock, line.duration);
  equal(
    "a mid-flight speed change loses no trips",
    result.tripsSeen,
    ["Japan", "Iberia", "Norway", "Chile"],
  );
  close(
    "speeding up rescales only the remaining time",
    result.wall,
    changeAt + (line.duration - changeAt) / 4,
    0.25,
  );
}

{
  // And the other way: slowing down stretches what is left rather than
  // rewinding to where 1x would have been by now.
  const changeAt = line.duration / 8;
  const result = run({ speed: 4, changeAt: { seconds: changeAt, speed: 1 } });
  check("slowing down mid-flight still finishes", result.ended);
  close(
    "slowing down stretches only the remaining time",
    result.wall,
    changeAt + (line.duration - changeAt * 4) / 1,
    0.25,
  );
}

// --- Skip -------------------------------------------------------------------

{
  const result = run({ speed: 1, skipAt: 2 });
  check("skip ends the playback", result.ended);
  equal("skip lands on the finished year", result.clock, line.duration);
  close("skip takes effect on the next frame", result.wall, 2, 0.05);
  const state = replayStateAt(line, result.clock);
  equal("the skipped-to state has every leg drawn", state.completedLegs.length, 8);
  equal("the skipped-to state has every pin", state.visiblePinCount, stops.length);
}

// --- A rebuild mid-playback resumes -----------------------------------------

{
  // The regression, modelled directly: the canvas is rebuilt a second in. With
  // the clock inside the effect this restarted the year; with it outside, the
  // run is unchanged apart from the one frame the rebuild costs.
  const result = run({ speed: 1, rebuildAt: 1 });
  check("a rebuild mid-playback still finishes the year", result.ended);
  equal(
    "a rebuild mid-playback loses no trips",
    result.tripsSeen,
    ["Japan", "Iberia", "Norway", "Chile"],
  );
  close(
    "a rebuild costs one frame, not the whole year",
    result.wall,
    baseline.wall + FRAME,
    0.05,
  );
}

{
  // The exact moment it used to die. The readout's trip name goes null during
  // the gap between two trips, the header loses a line, the canvas resizes,
  // and the animation effect is rebuilt. At 4x that arrives four times sooner,
  // which is why the speed control looked like the culprit.
  const firstGap = line.segments.find((segment) => segment.kind === "gap");
  check("the fixture has a gap between trips", firstGap !== undefined);
  if (firstGap) {
    const result = run({ speed: 4, rebuildAt: firstGap.start / 4 });
    check("a rebuild at the first gap still finishes the year", result.ended);
    equal(
      "a rebuild at the first gap loses no trips",
      result.tripsSeen,
      ["Japan", "Iberia", "Norway", "Chile"],
    );
  }
}

// --- The clock itself -------------------------------------------------------

{
  equal(
    "a zero-length timeline is immediately ended",
    advancePlayback(0, FRAME, 1, 0),
    { clock: 0, ended: true },
  );
  equal(
    "the clock never runs past the duration",
    advancePlayback(9.9, 5, 4, 10).clock,
    10,
  );
  // A backgrounded tab produces one enormous frame on the way back. Letting it
  // through would finish the year while nobody was watching it.
  check(
    "an enormous frame is clamped rather than jumping the year",
    advancePlayback(0, 30, 1, 60).clock < 1,
  );
  equal(
    "a non-finite frame time advances nothing",
    advancePlayback(3, Number.NaN, 2, 10).clock,
    3,
  );
}

// --- Report -----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nPlayback: ${failures.length} check(s) failed.\n`);
  for (const failure of failures) console.error(`  x ${failure}`);
  console.error("");
  process.exit(1);
}
console.log(`Playback: ${passed} checks passed.`);
