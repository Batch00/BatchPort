import Link from "next/link";
import { TrophyIcon } from "lucide-react";

import { ChartCard } from "./chart-card";
import { RatingDisplay } from "@/components/rating-display";
import { CategoryIcon } from "@/components/category-icon";
import type {
  CategoryBest,
  RatedExperience,
  Superlatives,
} from "@/lib/superlatives";

// The ratings you have been quietly collecting, ranked. Every number here
// comes from the rated experiences already fetched for the stats page, so the
// section costs one query for the whole page and nothing at render time.

function experienceHref(experience: RatedExperience): string {
  return `/trips/${experience.tripId}/destinations/${experience.destinationId}`;
}

function ContextLine({ experience }: { experience: RatedExperience }) {
  return (
    <span className="block truncate text-xs text-foreground/45">
      {experience.destinationName} · {experience.tripName}
    </span>
  );
}

function TopRow({
  experience,
  rank,
}: {
  experience: RatedExperience;
  rank: number;
}) {
  return (
    <li>
      <Link
        href={experienceHref(experience)}
        className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
      >
        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-foreground/30">
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {experience.name}
          </span>
          <ContextLine experience={experience} />
        </span>
        <RatingDisplay
          rating={experience.rating}
          size={12}
          className="shrink-0"
        />
      </Link>
    </li>
  );
}

function CategoryBestRow({ best }: { best: CategoryBest }) {
  return (
    <li>
      <Link
        href={experienceHref(best.experience)}
        className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]"
          style={best.color ? { color: best.color } : undefined}
        >
          <CategoryIcon icon={best.icon} className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-foreground/40">
            {best.label}
          </span>
          <span className="block truncate text-sm text-foreground">
            {best.experience.name}
          </span>
          <ContextLine experience={best.experience} />
        </span>
        <RatingDisplay
          rating={best.experience.rating}
          size={12}
          className="shrink-0"
        />
      </Link>
    </li>
  );
}

export function SuperlativesSection({
  superlatives,
}: {
  superlatives: Superlatives;
}) {
  const { top, bestPerCategory, disappointments } = superlatives;
  if (top.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Top rated, all time"
          description={
            top.length === 1
              ? "The one you rated highest"
              : `Your ${top.length} highest rated experiences`
          }
        >
          <ol className="-mx-2 flex flex-col">
            {top.map((experience, index) => (
              <TopRow
                key={experience.id}
                experience={experience}
                rank={index + 1}
              />
            ))}
          </ol>
        </ChartCard>

        {bestPerCategory.length > 0 ? (
          <ChartCard
            title="Best in category"
            description="Your highest rated experience of each kind"
          >
            <ul className="-mx-2 flex flex-col">
              {bestPerCategory.map((best) => (
                <CategoryBestRow key={best.slug} best={best} />
              ))}
            </ul>
          </ChartCard>
        ) : null}
      </div>

      {disappointments.length > 0 ? (
        <ChartCard
          title="Did not quite land"
          description="Every trip has one. Filed under lessons learned."
        >
          <ul className="-mx-2 flex flex-col">
            {disappointments.map((experience) => (
              <li key={experience.id}>
                <Link
                  href={experienceHref(experience)}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {experience.name}
                    </span>
                    <ContextLine experience={experience} />
                  </span>
                  <RatingDisplay
                    rating={experience.rating}
                    size={12}
                    className="shrink-0"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </ChartCard>
      ) : null}
    </div>
  );
}

export function SuperlativesHeading() {
  return (
    <h2 className="flex items-center gap-2 text-sm font-medium text-foreground/80">
      <TrophyIcon className="size-4 text-brand/70" />
      Superlatives
    </h2>
  );
}
