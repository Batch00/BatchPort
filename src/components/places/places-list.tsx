"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { RepeatIcon } from "lucide-react";

import { PlaceTypeIcon } from "@/components/places/place-type-icon";
import {
  buildPlaceList,
  DEFAULT_PLACE_FILTERS,
  DEFAULT_PLACE_SORT,
  PLACE_SORT_LABELS,
  rowDate,
  shortLocalityLabel,
  type PlaceFilters,
  type PlaceSort,
} from "@/lib/place-groups";
import { PLACE_TYPES } from "@/lib/place-types";
import type { Occasion, PlaceListRow, PlaceType } from "@/lib/types";
import { cn } from "@/lib/utils";

// The /places list. Filtering and sorting are client state over rows the server
// already fetched: the whole list is one v_places read and a few hundred rows at
// the outside, so re-querying on every filter change would be a round trip to
// answer a question the page can already answer.
//
// ONE COMPONENT DRAWS BOTH SHAPES. A locality with two or more places gets a
// header and indented rows; a lone locality and a place with no locality are
// bare rows in the same sequence. See lib/place-groups.ts for why that is not
// two lists.

// The chosen sort, remembered for the tab session like the globe's basemap
// and places-pins choices. Read through useSyncExternalStore rather than a
// lazy useState initializer, because this list is server-rendered and its
// order IS the markup: the server and the first client paint both use the
// default, and the stored choice applies right after hydration instead of
// producing a mismatch.
const SORT_STORAGE_KEY = "batchport:places-sort";
const SORT_EVENT = "batchport:places-sort";

function isPlaceSort(value: string | null): value is PlaceSort {
  return value === "recent" || value === "first-visit" || value === "name";
}

function readStoredSort(): PlaceSort {
  try {
    const value = sessionStorage.getItem(SORT_STORAGE_KEY);
    return isPlaceSort(value) ? value : DEFAULT_PLACE_SORT;
  } catch {
    return DEFAULT_PLACE_SORT;
  }
}

function subscribeSort(onChange: () => void): () => void {
  window.addEventListener(SORT_EVENT, onChange);
  return () => window.removeEventListener(SORT_EVENT, onChange);
}

function storeSort(sort: PlaceSort) {
  try {
    sessionStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch {
    // Storage unavailable: the choice holds for this render only.
  }
  window.dispatchEvent(new Event(SORT_EVENT));
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// A BARE ROW CARRIES ITS OWN LOCALITY; a group member does not.
//
// Without this, a bare row sitting under a group read as a member of it: the
// only thing distinguishing "American Family Field, Milwaukee" from the two
// places under a "GREEN BAY, WISCONSIN, 2 places" header was a small indent,
// so the eye counted three rows under a header that said two.
//
// The fix is to make the row self-describing rather than to give every lone
// locality a header. Twenty places would mean roughly eleven headers reading
// "1 place", and a park with no locality could not have one at all, so the
// header route makes the common case worse and still does not cover it.
function PlaceRow({
  place,
  inGroup,
  sort,
  occasionLabels,
}: {
  place: PlaceListRow;
  inGroup: boolean;
  sort: PlaceSort;
  occasionLabels: Map<string, string>;
}) {
  // The date follows the sort: the latest visit to date under Most recent,
  // the first visit otherwise, and "Upcoming" for a place that has not
  // happened yet under every sort (see rowDate).
  const { date, upcoming } = rowDate(place, sort);
  const shown = formatDate(date);
  const dateText = upcoming ? `Upcoming ${shown ?? ""}`.trim() : (shown ?? "No date");
  // The occasion belongs to the visit whose date is shown.
  const occasion =
    sort === "recent" && !upcoming
      ? place.latest_visit_to_date_occasion_id
        ? (occasionLabels.get(place.latest_visit_to_date_occasion_id) ?? null)
        : null
      : place.first_occasion_label;
  // Empty for a park or a venue with no city, which correctly adds nothing.
  const locality = inGroup ? "" : shortLocalityLabel(place);
  return (
    <Link
      href={`/places/${place.id}`}
      className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.07]"
    >
      <PlaceTypeIcon
        type={place.place_type}
        className={cn("size-4 shrink-0", place.catalog_item_id ? "text-brand" : "text-muted-foreground")}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{place.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {/* A place with no visits says so. Blank dates read as a broken row,
              and this state is reachable: deleting the last visit of a place is
              a choice the detail view offers rather than a cascade. */}
          {place.visit_count === 0 ? (
            [locality, "No visits logged"].filter(Boolean).join(" · ")
          ) : (
            [locality, dateText, occasion].filter(Boolean).join(" · ")
          )}
        </span>
      </span>
      {/* Visits TO DATE, so a booked game is not counted as a return trip and
          an upcoming-only place (zero to date) shows no badge at all. */}
      {place.visit_count_to_date > 1 ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-muted-foreground"
          title={`${place.visit_count_to_date} visits so far`}
        >
          <RepeatIcon className="size-3" />
          {place.visit_count_to_date}
        </span>
      ) : null}
    </Link>
  );
}

interface PlacesListProps {
  places: PlaceListRow[];
  occasions: Occasion[];
}

export function PlacesList({ places, occasions }: PlacesListProps) {
  const [filters, setFilters] = useState<PlaceFilters>(DEFAULT_PLACE_FILTERS);
  const sort = useSyncExternalStore(subscribeSort, readStoredSort, () => DEFAULT_PLACE_SORT);
  const occasionLabels = useMemo(
    () => new Map(occasions.map((o) => [o.id, o.label])),
    [occasions],
  );

  const entries = useMemo(() => buildPlaceList(places, filters, sort), [places, filters, sort]);

  // Only offer a filter value that some row actually has, so the controls can
  // never lead to an empty list.
  const usedTypes = useMemo(() => {
    const seen = new Set(places.map((p) => p.place_type));
    return PLACE_TYPES.filter((t) => seen.has(t.type));
  }, [places]);
  const usedOccasions = useMemo(() => {
    const seen = new Set(places.map((p) => p.first_occasion_slug).filter(Boolean));
    return occasions.filter((o) => seen.has(o.slug));
  }, [places, occasions]);

  const filtering = filters.placeType !== "all" || filters.occasion !== "all";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={!filtering} onClick={() => setFilters(DEFAULT_PLACE_FILTERS)}>
          All
        </Chip>
        {usedTypes.map((t) => (
          <Chip
            key={t.type}
            active={filters.placeType === t.type}
            onClick={() =>
              setFilters((f) => ({
                ...f,
                placeType: f.placeType === t.type ? "all" : (t.type as PlaceType),
              }))
            }
          >
            <PlaceTypeIcon type={t.type} className="size-3.5" />
            {t.label}
          </Chip>
        ))}
        {usedOccasions.map((o) => (
          <Chip
            key={o.id}
            active={filters.occasion === o.slug}
            onClick={() =>
              setFilters((f) => ({ ...f, occasion: f.occasion === o.slug ? "all" : o.slug }))
            }
          >
            {o.label}
          </Chip>
        ))}

        {/* A native select: three options, and on a phone the platform's own
            picker. text-base below md so iOS does not zoom on focus. */}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => {
              if (isPlaceSort(e.target.value)) storeSort(e.target.value);
            }}
            className="h-8 cursor-pointer rounded-md border border-white/10 bg-white/[0.03] px-2 text-base text-foreground/80 transition-colors hover:bg-white/[0.07] md:text-xs"
          >
            {(Object.keys(PLACE_SORT_LABELS) as PlaceSort[]).map((key) => (
              <option key={key} value={key}>
                {PLACE_SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
          {places.length === 0
            ? "Nowhere logged yet. Somewhere you stayed overnight or spent a real day."
            : "Nothing matches those filters."}
        </p>
      ) : (
        // gap-5 between entries, not gap-2. A group and the bare row after it
        // were separated by the same distance as two rows INSIDE the group,
        // which is what let the eye read the next row as a third member.
        <div className="flex flex-col gap-5">
          {entries.map((entry) =>
            entry.kind === "group" ? (
              // The rail is the second half of the fix. A group's rows are
              // visibly bracketed as belonging to their header, so where the
              // bracket stops is where the group stops. An indent alone was too
              // subtle to carry that meaning.
              <section
                key={entry.key}
                aria-label={entry.label}
                className="flex flex-col gap-2 border-l-2 border-brand/30 pl-3"
              >
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {entry.label}
                  <span className="ml-2 normal-case opacity-60">{entry.places.length} places</span>
                </h2>
                {entry.places.map((place) => (
                  <PlaceRow
                    key={place.id}
                    place={place}
                    inGroup
                    sort={sort}
                    occasionLabels={occasionLabels}
                  />
                ))}
              </section>
            ) : (
              <PlaceRow
                key={entry.key}
                place={entry.place}
                inGroup={false}
                sort={sort}
                occasionLabels={occasionLabels}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-brand bg-brand/15 text-foreground"
          : "border-white/10 bg-white/[0.03] text-foreground/60 hover:bg-white/[0.07] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
