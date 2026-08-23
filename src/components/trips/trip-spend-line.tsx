import { formatUsd } from "@/lib/expenses";
import type { SharedTripExpenses } from "@/lib/share-data";

// What a trip cost, INSIDE the card's photo overlay.
//
// It used to sit below the card, which read as a stray caption rather than
// part of the trip, and made the grid ragged: a trip with a ledger was taller
// than the one beside it. Inside the overlay a trip with no spending simply
// has a shorter overlay and the card height never changes, so the grid aligns
// for free.
//
// LEGIBILITY COMES FROM THE EXISTING SCRIM, NOT A NEW COLOUR. The overlay
// already carries `bg-gradient-to-t from-black/85`, and the name, dates and
// stop count are plain `text-white` at varying opacity. This uses the same
// ramp (85 for the figure, 60 for the tail) so it is legible on exactly the
// photographs the dates are legible on. A colour that only worked on some
// images would be a new failure mode on a surface full of user photos.
//
// THE TAIL DROPS BY CARD WIDTH, NOT VIEWPORT WIDTH, which is why these are
// container queries. A card is ~327px at a 375px viewport in one column and
// ~288px at 640px in two, so it gets NARROWER as the screen gets wider and a
// viewport breakpoint would hide the tail at exactly the wrong sizes. The
// order it sheds in is the order the numbers are worth: the total always
// survives, the per-day figure goes next, and the leading group is first out.
// Nothing wraps to a second line, because a second line is the height
// variation this move exists to remove.

export function TripSpendLine({
  spend,
}: {
  /** Null when the surface did not ask for spending, or the trip has none. */
  spend: SharedTripExpenses | null;
}) {
  if (!spend || spend.txnCount === 0) return null;

  // "Uncategorized" is the absence of a finding rather than one, so it is
  // never named here, matching the trip page card.
  const lead = spend.groups.find(
    (group) => group.groupSlug !== "uncategorized" && group.totalUsd > 0,
  );

  return (
    <p className="mt-0.5 flex items-baseline gap-1.5 whitespace-nowrap text-xs text-white/60">
      <span className="tabular-nums text-white/85">
        {formatUsd(spend.totalUsd)}
      </span>
      {spend.usdPerDay !== null ? (
        <span className="hidden tabular-nums @[16rem]/card:inline">
          · {formatUsd(spend.usdPerDay)}/day
        </span>
      ) : null}
      {lead ? (
        <span className="hidden truncate @[22rem]/card:inline">
          · {lead.groupLabel}
        </span>
      ) : null}
    </p>
  );
}
