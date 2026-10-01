import Link from "next/link";
import { InfoIcon } from "lucide-react";

import { InfoTip } from "@/components/ui/info-tip";
import { formatDate } from "@/lib/format";
import type { CatalogSplit, StartedCatalog } from "@/lib/places-stats";

// Progress through the venue and park catalogs, shown to the user as
// "Checklists" (nothing in the app names them "catalogs" on screen, and the
// labels themselves, "MLB Ballparks", "US National Parks", read as lists).
//
// Decided: rings only for catalogs with at least one visit; the rest go in a
// compact line, so the empty case is never a wall of zero rings.
//
// Designed for where the data is, which is 1 of 63, 1 of 30, 2 of 136. A
// ring at 1.6% is a dot, and that is drawn honestly rather than inflated: the
// round cap makes the smallest arc visible without lying about its length.
// What makes a small number feel like progress is NAMING it, so every ring
// lists the places that filled it, each linking to its place page. Never
// truncated (the place-list rule): a catalog with thirty ticked names lists
// thirty.
//
// The denominator is the number of BUILDINGS, which is not always the obvious
// number (the NFL is 32 clubs in 30 stadiums), so every catalog carries its
// denominator note behind an info tip rather than letting somebody check 1/30
// against 32 in their head.

export function CatalogProgress({ split }: { split: CatalogSplit }) {
  const { started, notStarted } = split;
  if (started.length === 0 && notStarted.length === 0) return null;

  return (
    <div className="min-w-0 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-foreground/80">Checklists</h3>
        <p className="mt-0.5 text-xs text-foreground/45">
          {started.length > 0
            ? `${started.length} of ${started.length + notStarted.length} started`
            : "Log a ballpark, a stadium, or a national park to start one"}
        </p>
      </div>

      {started.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {started.map((catalog) => (
            <li key={catalog.id} className="min-w-0">
              <CatalogRing catalog={catalog} />
            </li>
          ))}
        </ul>
      ) : null}

      {notStarted.length > 0 ? (
        <div className={started.length > 0 ? "mt-4 border-t border-white/5 pt-3" : undefined}>
          <p className="mb-1.5 text-xs text-foreground/45">Not started</p>
          <ul className="flex flex-wrap gap-1.5">
            {notStarted.map((catalog) => (
              <li
                key={catalog.id}
                className="flex items-center gap-1.5 rounded-md bg-white/[0.03] py-1 pl-2.5 pr-1.5 text-xs text-foreground/60 ring-1 ring-white/10"
              >
                <span>{catalog.label}</span>
                <span className="tabular-nums text-foreground/35">0/{catalog.total}</span>
                {catalog.note ? <NoteTip label={catalog.label} note={catalog.note} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const RADIUS = 26;
const STROKE = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function CatalogRing({ catalog }: { catalog: StartedCatalog }) {
  const arc = catalog.fraction * CIRCUMFERENCE;
  return (
    <div className="flex h-full min-w-0 gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
      <svg
        viewBox="0 0 64 64"
        className="size-16 shrink-0 -rotate-90"
        role="img"
        aria-label={`${catalog.visited} of ${catalog.total}`}
      >
        <circle cx="32" cy="32" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} />
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${CIRCUMFERENCE}`}
        />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-medium leading-snug text-foreground/85">{catalog.label}</p>
          {catalog.note ? <NoteTip label={catalog.label} note={catalog.note} /> : null}
        </div>
        <p className="text-xs text-foreground/50">
          <span className="text-base font-semibold tabular-nums text-foreground">
            {catalog.visited}
          </span>{" "}
          of {catalog.total}
        </p>
        <ul className="mt-1.5 space-y-0.5">
          {catalog.items.map((item) => (
            <li key={`${item.name}-${item.place_id ?? ""}`} className="text-xs leading-snug">
              {item.place_id ? (
                <Link
                  href={`/places/${item.place_id}`}
                  className="text-foreground/75 underline-offset-4 hover:text-foreground hover:underline"
                >
                  {item.name}
                </Link>
              ) : (
                <span className="text-foreground/75">{item.name}</span>
              )}
              {item.first_visit_date ? (
                <span className="text-foreground/40"> {formatDate(item.first_visit_date)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NoteTip({ label, note }: { label: string; note: string }) {
  return (
    <InfoTip
      tip={note}
      label={`How ${label} is counted`}
      className="shrink-0 rounded-sm p-0.5 text-foreground/35 hover:text-foreground/70"
      contentClassName="max-w-72"
    >
      <InfoIcon className="size-3.5" />
    </InfoTip>
  );
}
