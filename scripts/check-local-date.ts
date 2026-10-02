// Asserts that "today" is the viewer's calendar date and that date-only
// arithmetic does not depend on any zone. Pure: no database, no server.
//
//   npm run check-local-date
//
// The bug this guards: the server runs in UTC, so from 7 PM Central onward a
// bare new Date() answered with tomorrow (On this day showed the next day's
// memories, the countdown dropped a day early). Every "what day is it" now
// goes through lib/local-date.ts with an explicit zone, and every helper
// downstream of it takes `today` as an argument. See CLAUDE.md, "Today Is The
// Viewer's Date".

import {
  FALLBACK_TIME_ZONE,
  daysBetween,
  isValidTimeZone,
  todayInZone,
} from "../src/lib/local-date";
import { daysUntil } from "../src/lib/format";
import { planDayCount, planDayIso, todayPlanDay } from "../src/lib/day-plan";
import { anniversaryDates } from "../src/lib/on-this-day";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n     expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
}

// 8 PM Central Daylight Time on Oct 2 is 01:00 UTC on Oct 3.
const EVENING_CENTRAL = new Date("2026-10-03T01:00:00Z");

console.log("Which calendar day it is");
check("8 PM Central resolves to the Central date", todayInZone("America/Chicago", EVENING_CENTRAL), "2026-10-02");
check("the same instant in UTC is the next day (the old bug)", todayInZone("UTC", EVENING_CENTRAL), "2026-10-03");
check("a viewer in Los Angeles gets their own date", todayInZone("America/Los_Angeles", EVENING_CENTRAL), "2026-10-02");
check("a viewer in Tokyo gets their own date", todayInZone("Asia/Tokyo", EVENING_CENTRAL), "2026-10-03");
check("a viewer in Kolkata (half-hour offset) gets their own date", todayInZone("Asia/Kolkata", EVENING_CENTRAL), "2026-10-03");
check("Central just before local midnight", todayInZone("America/Chicago", new Date("2026-10-03T04:59:59Z")), "2026-10-02");
check("Central at local midnight", todayInZone("America/Chicago", new Date("2026-10-03T05:00:00Z")), "2026-10-03");
check("Central in winter (CST, UTC-6)", todayInZone("America/Chicago", new Date("2026-01-15T05:30:00Z")), "2026-01-14");
check("Auckland across new year", todayInZone("Pacific/Auckland", new Date("2026-12-31T11:30:00Z")), "2027-01-01");

console.log("\nZones from the cookie are untrusted input");
check("an IANA zone is valid", isValidTimeZone("Europe/Lisbon"), true);
check("garbage is not", isValidTimeZone("Not/AZone"), false);
check("empty is not", isValidTimeZone(""), false);
check("an invalid zone falls back rather than throwing", todayInZone("Not/AZone", EVENING_CENTRAL), todayInZone(FALLBACK_TIME_ZONE, EVENING_CENTRAL));

console.log("\nThe consumers, at 8 PM Central");
const centralToday = todayInZone("America/Chicago", EVENING_CENTRAL);
check("countdown to a trip a week out says 7, not 6", daysUntil("2026-10-09", centralToday), 7);
check("countdown to tomorrow says 1", daysUntil("2026-10-03", centralToday), 1);
check("countdown to today is null (not a countdown)", daysUntil("2026-10-02", centralToday), null);
check("countdown rejects a malformed date", daysUntil("2026-10", centralToday), null);
check("ongoing trip Today highlight is day 3 of Sep 30 to Oct 5", todayPlanDay("2026-09-30", "2026-10-05", centralToday), 3);
check("highlight is null outside the stay", todayPlanDay("2026-10-03", "2026-10-05", centralToday), null);
check("On this day looks up Oct 2, not Oct 3", anniversaryDates(centralToday).slice(0, 2), ["2025-10-02", "2024-10-02"]);
check("On this day skips Feb 29 in years without one", anniversaryDates("2028-02-29").slice(0, 2), ["2024-02-29", "2020-02-29"]);

console.log("\nDate-only arithmetic is identical in every process zone");
const zones = ["UTC", "America/Chicago", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Auckland", "Europe/London"];
const baseline: string[] = [];
for (const zone of zones) {
  process.env.TZ = zone;
  const results = [
    daysBetween("2026-10-31", "2026-11-02"), // across the US DST change
    daysBetween("2026-03-28", "2026-03-30"), // across the EU DST change
    daysUntil("2026-11-02", "2026-10-31"),
    planDayIso("2026-10-31", 3), // across the US DST change
    planDayIso("2026-03-28", 3),
    planDayCount("2026-10-30", "2026-11-03"),
    todayPlanDay("2026-10-31", "2026-11-03", "2026-11-02"),
  ].map(String);
  if (baseline.length === 0) baseline.push(...results);
  check(`process TZ=${zone}`, results, baseline);
}
check("the baseline itself", baseline, ["2", "2", "2", "2026-11-02", "2026-03-30", "5", "3"]);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
