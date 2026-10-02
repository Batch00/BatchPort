import { cache } from "react";
import { cookies } from "next/headers";

import {
  FALLBACK_TIME_ZONE,
  TZ_COOKIE,
  isValidTimeZone,
  todayInZone,
} from "@/lib/local-date";

// Server half of lib/local-date.ts: the viewer's zone from the cookie the
// browser sets, and the viewer's today. Server code never asks `new Date()`
// what day it is; it asks this. cache() so one request reads the cookie once.

export const viewerTimeZone = cache(async (): Promise<string> => {
  try {
    const zone = (await cookies()).get(TZ_COOKIE)?.value;
    return isValidTimeZone(zone) ? zone : FALLBACK_TIME_ZONE;
  } catch {
    // Outside a request scope (a script, a cache scope): no viewer to ask.
    return FALLBACK_TIME_ZONE;
  }
});

/** The viewer's calendar date, YYYY-MM-DD. */
export async function viewerToday(): Promise<string> {
  return todayInZone(await viewerTimeZone());
}
