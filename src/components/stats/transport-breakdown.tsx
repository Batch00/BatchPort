import { TransportModeIcon } from "@/components/trips/transport-leg";
import { formatKm } from "@/lib/stats-format";
import {
  GROUND_ARC_COLOR,
  SEA_ARC_COLOR,
  arcFamily,
  transportModeLabel,
  type TransportBreakdown,
} from "@/lib/transport";
import { cn } from "@/lib/utils";

// "How you travelled": distance split by transport mode.
//
// This is a breakdown, never an adjustment. Every kilometre here is the same
// great-circle measure the globe draws and f_distance_traveled counts, which
// is fair for a flight and an understatement for a road. Scaling ground legs
// by a detour factor would produce a more satisfying number and a less true
// one, so the caption says what the measure is instead. A leg whose owner
// entered a real distance uses that figure.
//
// It renders only when at least one leg carries a mode, and unrecorded hops
// are named rather than silently folded in, so the split never implies the
// user travelled less than they did.

/** The dot colour matches the arc family the globe draws for that mode, so the
 * chart and the map say the same thing. */
function dotStyle(mode: TransportBreakdown["byMode"][number]["mode"]) {
  const family = arcFamily(mode);
  if (family === "ground") return { color: GROUND_ARC_COLOR };
  if (family === "sea") return { color: SEA_ARC_COLOR };
  return null;
}

/** Tonnes past a thousand kilograms, because "1,400 kg" reads as a spreadsheet
 * and "1.4 t" reads as a quantity. */
function formatCo2(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg).toLocaleString("en-US")} kg`;
}

export function TransportBreakdownCard({
  breakdown,
}: {
  breakdown: TransportBreakdown;
}) {
  const max = Math.max(...breakdown.byMode.map((entry) => entry.km), 1);

  return (
    <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <h2 className="text-sm font-medium text-foreground/80">How you travelled</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Straight-line distance between stops, split by the legs you recorded
      </p>

      <ul className="mt-4 flex flex-col gap-2.5">
        {breakdown.byMode.map((entry) => {
          const dot = dotStyle(entry.mode);
          return (
            <li key={entry.mode} className="flex items-center gap-3">
              <span
                aria-hidden
                style={dot ? { backgroundColor: dot.color } : undefined}
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  dot ? "" : "bg-brand",
                )}
              />
              <TransportModeIcon
                mode={entry.mode}
                className="size-4 shrink-0 text-foreground/45"
              />
              <span className="w-16 shrink-0 text-sm text-foreground/80">
                {transportModeLabel(entry.mode)}
              </span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
                <span
                  className="block h-full rounded-full bg-brand/60"
                  style={{ width: `${Math.max(2, (entry.km / max) * 100)}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right text-sm tabular-nums text-foreground/70">
                {formatKm(entry.km)}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-foreground/35">
        {breakdown.unrecordedKm > 0 ? (
          <>
            A further {formatKm(breakdown.unrecordedKm)} is on hops with no leg
            recorded yet.{" "}
          </>
        ) : null}
        {breakdown.estimatedCo2Kg !== null ? (
          <>
            Roughly {formatCo2(breakdown.estimatedCo2Kg)} CO2e, estimated from
            these distances and typical published per-passenger-kilometre
            factors.
          </>
        ) : null}
      </p>
    </section>
  );
}
