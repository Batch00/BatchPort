import type {
  CategoryStat,
  CountryStat,
  TravelExtremes,
  YearStat,
} from "@/lib/stats-data";

// One-line insights for the detailed stats page, derived purely from the view
// rows the page already fetched. Every sentence states a fact present in the
// data; nothing here queries or invents.

function plural(count: number, singular: string, pluralWord?: string): string {
  return count === 1 ? singular : (pluralWord ?? `${singular}s`);
}

// The year with the most trips (later year wins a tie, since the rows arrive
// in ascending year order and >= keeps the last maximum).
export function biggestYear(yearly: YearStat[]): YearStat | null {
  let best: YearStat | null = null;
  for (const row of yearly) {
    if (row.trips > 0 && (!best || row.trips >= best.trips)) best = row;
  }
  return best;
}

export function yearlyInsight(yearly: YearStat[]): string | undefined {
  const best = biggestYear(yearly);
  if (!best) return undefined;
  return `Your biggest year was ${best.year} with ${best.trips} ${plural(best.trips, "trip")}`;
}

export function categoryInsight(
  categories: CategoryStat[],
): string | undefined {
  // Rows arrive sorted by experience_count descending.
  const top = categories[0];
  if (!top || top.experience_count === 0) return undefined;
  return `${top.label} leads with ${top.experience_count} ${plural(top.experience_count, "experience")}`;
}

export function countryInsight(countries: CountryStat[]): string | undefined {
  // Rows arrive sorted by destination count descending.
  const top = countries[0];
  if (!top) return undefined;
  return `${top.country_name} tops the list with ${top.destinations} ${plural(top.destinations, "destination")}`;
}

// "Spanning 78 degrees of latitude" when both extremes are known.
export function extremesInsight(
  extremes: TravelExtremes,
): string | undefined {
  const north = extremes.north.value;
  const south = extremes.south.value;
  if (north === null || south === null) return undefined;
  const span = Math.round(Math.abs(north - south));
  if (span === 0) return undefined;
  return `Your map spans ${span} ${plural(span, "degree")} of latitude`;
}

// --- Records row ------------------------------------------------------------

export interface TravelRecord {
  label: string;
  value: string;
  detail: string;
}

// A short list of records the fetched view rows already contain. Skips any
// record whose data is missing rather than padding with placeholders.
export function travelRecords(input: {
  yearly: YearStat[];
  categories: CategoryStat[];
  countries: CountryStat[];
}): TravelRecord[] {
  const records: TravelRecord[] = [];

  const year = biggestYear(input.yearly);
  if (year) {
    records.push({
      label: "Biggest year",
      value: String(year.year),
      detail: `${year.trips} ${plural(year.trips, "trip")}, ${year.countries} ${plural(year.countries, "country", "countries")}`,
    });
  }

  let newest: YearStat | null = null;
  for (const row of input.yearly) {
    if (row.new_countries > 0 && (!newest || row.new_countries >= newest.new_countries)) {
      newest = row;
    }
  }
  if (newest) {
    records.push({
      label: "Most new countries",
      value: String(newest.year),
      detail: `${newest.new_countries} first ${plural(newest.new_countries, "visit")}`,
    });
  }

  const country = input.countries[0];
  if (country) {
    records.push({
      label: "Most explored",
      value: country.country_name,
      detail: `${country.destinations} ${plural(country.destinations, "destination")} across ${country.trips} ${plural(country.trips, "trip")}`,
    });
  }

  let topRated: CategoryStat | null = null;
  for (const row of input.categories) {
    if (
      row.avg_rating_stars !== null &&
      (!topRated ||
        row.avg_rating_stars > (topRated.avg_rating_stars ?? 0))
    ) {
      topRated = row;
    }
  }
  if (topRated && topRated.avg_rating_stars !== null) {
    records.push({
      label: "Top rated",
      value: topRated.label,
      detail: `${topRated.avg_rating_stars.toFixed(1)} average rating`,
    });
  }

  return records;
}
