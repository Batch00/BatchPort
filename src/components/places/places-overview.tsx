import { PlaceTypeIcon } from "@/components/places/place-type-icon";
import { formatDate } from "@/lib/format";
import { num, typeTiles, type PlaceCountsRow } from "@/lib/places-stats";
import type { PlaceType } from "@/lib/types";
import { cn } from "@/lib/utils";

// The section's opening card: how many places, across how many localities,
// and what kind. Sized for twelve places: the headline does the talking and
// the tiles are small, so a count of 1 reads as a fact rather than as a
// half-empty dashboard.
//
// "Localities" and "Cities" are different numbers on purpose and both appear:
// a city is a place logged AS a city (4), a locality is any town one of your
// places sits in (10). The headline carries the locality count in a sentence
// so it is never set beside the Cities tile as if the two disagreed.

// Static class strings so Tailwind generates them: one row of five or six on
// a wide screen, three per row on a phone (3 + 2 or 3 + 3).
const WIDE_COLUMNS: Record<number, string> = {
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
};

export function PlacesOverview({
  counts,
  firstPlaceDate,
}: {
  counts: PlaceCountsRow;
  firstPlaceDate: string | null;
}) {
  const tiles = typeTiles(counts);
  const total = num(counts.total_places);
  const localities = num(counts.localities);

  return (
    <div className="min-w-0 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
      <p className="text-sm text-foreground/60">
        <span className="text-3xl font-semibold tabular-nums text-foreground">{total}</span>{" "}
        {total === 1 ? "place" : "places"}
        {localities > 0 ? (
          <>
            {" "}across{" "}
            <span className="font-medium tabular-nums text-foreground">{localities}</span>{" "}
            {localities === 1 ? "locality" : "localities"}
          </>
        ) : null}
      </p>
      {firstPlaceDate ? (
        <p className="mt-1 text-xs text-foreground/45">
          Earliest visit {formatDate(firstPlaceDate)}
        </p>
      ) : null}

      <ul className={cn("mt-4 grid grid-cols-3 gap-2", WIDE_COLUMNS[tiles.length])}>
        {tiles.map((tile) => (
          <li
            key={tile.key}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5",
              tile.count === 0 && "opacity-45",
            )}
          >
            <PlaceTypeIcon
              type={tile.key as PlaceType}
              className={cn("size-4", tile.count > 0 ? "text-brand" : "text-foreground/50")}
            />
            <span className="text-xl font-semibold tabular-nums leading-none">{tile.count}</span>
            <span className="truncate text-xs text-foreground/55">{tile.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
