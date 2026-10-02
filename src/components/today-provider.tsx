"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  TZ_COOKIE,
  browserTimeZone,
  localToday,
  todayInZone,
} from "@/lib/local-date";

// The viewer's today for client components (see lib/local-date.ts).
//
// Seeded with the server's answer, so the server render and the hydrating
// render agree byte for byte: a component that computed `new Date()` during
// render got UTC on the server and local time in the browser, which is both
// a wrong first paint and a hydration mismatch. After mount it switches to
// the device's own date, which is what keeps three cases right: the first
// visit (no cookie yet, so the server guessed), a precached page (/offline is
// cached HTML whose date is whenever it was cached), and a tab left open past
// midnight (re-checked whenever the page becomes visible again).
//
// It also keeps the cookie current, so a zone change while traveling reaches
// the server on the next request, and refreshes once when the server's
// answer turns out to have been a different day.

const TodayContext = createContext<string | null>(null);

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function TodayProvider({
  serverToday,
  serverZone,
  children,
}: {
  serverToday: string;
  serverZone: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [today, setToday] = useState(serverToday);

  useEffect(() => {
    const zone = browserTimeZone();
    if (zone !== serverZone) {
      document.cookie = `${TZ_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
      // Server-rendered "today" (On this day, the recap's year) was computed
      // for the wrong day only if the two zones disagree about the date.
      if (todayInZone(zone) !== todayInZone(serverZone)) router.refresh();
    }

    const sync = () => setToday(localToday());
    sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [serverZone, router]);

  return (
    <TodayContext.Provider value={today}>{children}</TodayContext.Provider>
  );
}

/** The viewer's calendar date, YYYY-MM-DD. Safe during render. */
export function useToday(): string {
  const today = useContext(TodayContext);
  // No provider only outside the app shell; the device date is the best
  // answer there and nothing server-rendered depends on it.
  return today ?? localToday();
}
