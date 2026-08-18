"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
} from "lucide-react";

import { CategoryIcon } from "@/components/category-icon";
import { CountryFlag } from "@/components/country-flag";
import { FitLine } from "@/components/fit-line";
import { PlacesLine } from "@/components/places-line";
import { SlideImage } from "@/components/photos/slide-image";
import { RatingDisplay } from "@/components/rating-display";
import { AnimatedNumber, CountUpGroup } from "@/components/stats/count-up";
import { ScoreStrip, ScoreValue } from "@/components/stats/scoreboard";
import { YearMapSlide } from "@/components/year/year-map-slide";
import { YearShareCardButton } from "@/components/year/year-share-card";
import {
  bucketHeroKey,
  cachedBucketHero,
  fetchBucketHero,
  hasCachedBucketHero,
  rememberBucketHero,
} from "@/lib/bucket-hero";
import { cn } from "@/lib/utils";
import {
  buildYearRecap,
  type YearBucket,
  type YearBucketItem,
  type YearClosingSlide,
  type YearInsightSlide,
  type YearMomentsSlide,
  type YearOpenerSlide,
  type YearRecap,
  type YearRecapInput,
  type YearScaleSlide,
  type YearScoreboardSlide,
  type YearSlide,
  type YearTripSlide,
  type YearTripsSlide,
} from "@/lib/year-recap";

// Year in Travel: a full-screen, paced reading of one year.
//
// The frame is the trip story's, deliberately: same portal, same swipe and key
// handling, same segmented progress bar, same "only mount what is near the
// current slide" rule. Someone who has read a trip story already knows how to
// drive this, and there was no reason to invent a second set of gestures.
//
// What is different is the pacing. Every slide holds one idea and animates its
// pieces in on a short stagger when it becomes the current one, so arriving at
// a slide feels like something happened rather than like a page turning. The
// stagger is CSS (see .recap-rise in globals.css) and is off under
// prefers-reduced-motion. Nothing advances on its own; the map slide is the
// single exception and it animates in place rather than moving the story on.
//
// Read-only by construction, which is what lets /demo and /share/[slug] open
// exactly the same component.

const RENDER_WINDOW = 1;
const SWIPE_THRESHOLD = 50;

/**
 * The padding every slide's content column keeps, so nothing lands under the
 * recap's own chrome.
 *
 * The chrome grows with the notch (the progress bar, then the year picker and
 * the close button one safe-area inset below it), and a flat `py-16` did not,
 * so on a phone with an inset the top of a slide sat under the year button.
 * The map slide computes its own header padding for the same reason, and this
 * is the same number spelled once for everything else.
 */
const SLIDE_PAD =
  "px-6 pt-[calc(3.75rem+env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-10 sm:pb-[calc(5rem+env(safe-area-inset-bottom))]";

/** One staggered element. Adding the class is what starts the animation, so
 * there is nothing to reset: a slide that is not current simply sits at rest,
 * out of sight behind the current one. */
function Rise({
  active,
  delay = 0,
  className,
  children,
}: {
  active: boolean;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(active && "recap-rise", className)}
      style={active ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

function FlagRow({
  codes,
  className,
}: {
  codes: string[];
  className?: string;
}) {
  if (codes.length === 0) return null;
  // `shrink-0` with `max-w-full` is the whole of why the flags read as a row.
  // A flag row is itself a wrapping flex box, so its MIN-content width is one
  // flag: as an ordinary flex item on a crowded line it was squeezed to that
  // and stacked its flags vertically in a two-character column, which is what
  // made the closing slide's upcoming trips look broken on a phone. Refusing to
  // shrink makes the parent wrap the whole row onto its own line instead, and
  // the max-width is what lets it wrap INSIDE itself once it is there rather
  // than running off the edge.
  return (
    <div
      className={cn("flex max-w-full shrink-0 flex-wrap items-center gap-1.5", className)}
    >
      {codes.map((code) => (
        <CountryFlag key={code} code={code} className="h-4" />
      ))}
    </div>
  );
}

/** The dark, centred ground most of the recap's slides sit on. */
function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        SLIDE_PAD,
        "flex size-full flex-col items-center justify-center overflow-y-auto bg-[#0a0a0a] text-center",
        className,
      )}
    >
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}

function OpenerView({
  slide,
  active,
}: {
  slide: YearOpenerSlide;
  active: boolean;
}) {
  return (
    <div className="relative size-full bg-[#0a0a0a]">
      {slide.heroUrl ? (
        <div className="absolute inset-0">
          <SlideImage
            src={slide.heroUrl}
            thumbSrc={slide.heroThumbUrl}
            priority
          />
        </div>
      ) : null}
      {/* A flat wash so the year reads over a bright photograph at any
          exposure, then the gradient that grounds the frame. Either alone
          left the numeral fighting the image. */}
      <div className="absolute inset-0 bg-black/50" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/25" />
      <div
        className={cn(
          SLIDE_PAD,
          "relative flex size-full flex-col items-center justify-center overflow-y-auto text-center",
        )}
      >
        <Rise active={active}>
          <p className="text-xs uppercase tracking-[0.24em] text-white/70">
            {slide.subtitle}
          </p>
        </Rise>
        <Rise active={active} delay={120}>
          <p className="mt-3 text-[22vw] font-semibold leading-[0.9] tracking-tight text-white sm:text-[13rem]">
            {slide.year}
          </p>
        </Rise>
        {slide.inProgress ? (
          <Rise active={active} delay={260}>
            <p className="mt-4 text-sm text-white/60">
              Still running, so this is the year so far.
            </p>
          </Rise>
        ) : null}
      </div>
    </div>
  );
}

function ScaleView({ slide, active }: { slide: YearScaleSlide; active: boolean }) {
  return (
    <Panel>
      <CountUpGroup active={active}>
        <Rise active={active}>
          <p className="text-xs uppercase tracking-[0.22em] text-white/40">
            You covered
          </p>
        </Rise>
        <Rise active={active} delay={100}>
          <ScoreValue
            value={slide.distanceKm}
            unit="km"
            animate
            className="mt-3 text-6xl font-semibold tracking-tight text-white sm:text-8xl"
          />
        </Rise>
        <Rise active={active} delay={240}>
          <p className="mt-3 text-base text-brand">{slide.comparison}</p>
        </Rise>
        <Rise active={active} delay={380}>
          <div className="mt-10 flex items-center justify-center gap-10">
            {slide.days > 0 ? (
              <div>
                <p className="text-3xl font-semibold tabular-nums text-white sm:text-4xl">
                  <AnimatedNumber value={slide.days} />
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-white/40">
                  Days away
                </p>
              </div>
            ) : null}
            {slide.countries > 0 ? (
              <div>
                <p className="text-3xl font-semibold tabular-nums text-white sm:text-4xl">
                  <AnimatedNumber value={slide.countries} />
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-white/40">
                  {slide.countries === 1 ? "Country" : "Countries"}
                </p>
              </div>
            ) : null}
          </div>
        </Rise>
        <Rise active={active} delay={500}>
          <FlagRow codes={slide.countryCodes} className="mt-8 justify-center" />
        </Rise>
      </CountUpGroup>
    </Panel>
  );
}

function TripView({ slide, active }: { slide: YearTripSlide; active: boolean }) {
  const trip = slide.trip;
  return (
    <div className="relative size-full bg-[#0a0a0a]">
      {trip.coverUrl ? (
        <div className="absolute inset-0">
          <SlideImage
            src={trip.coverUrl}
            thumbSrc={trip.coverThumbUrl}
            priority
          />
        </div>
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/30" />
      <div
        className={cn(
          SLIDE_PAD,
          "relative flex size-full items-end justify-center overflow-y-auto",
        )}
      >
        <div className="w-full max-w-2xl">
          <Rise active={active}>
            {/* One fact, so one line. It used to break after the comma in the
                end date and leave "2025" alone underneath, which reads as a
                second fact rather than the tail of this one. */}
            <FitLine className="text-xs uppercase tracking-[0.2em] text-white/50">
              Trip {slide.position} of {slide.total} · {trip.dateLabel}
            </FitLine>
          </Rise>
          <Rise active={active} delay={110}>
            <h2 className="mt-2 break-words text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              {trip.name}
            </h2>
          </Rise>
          {trip.places.length > 0 ? (
            <Rise active={active} delay={230}>
              <PlacesLine
                places={trip.places}
                className="mt-2 text-sm leading-relaxed text-white/70"
              />
            </Rise>
          ) : null}
          <Rise active={active} delay={330}>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/60">
              {trip.days > 0 ? (
                <span className="tabular-nums">
                  {trip.days} {trip.days === 1 ? "day" : "days"}
                </span>
              ) : null}
              {trip.stops > 0 ? (
                <span className="tabular-nums">
                  {trip.stops} {trip.stops === 1 ? "stop" : "stops"}
                </span>
              ) : null}
              {trip.experiences > 0 ? (
                <span className="tabular-nums">
                  {trip.experiences}{" "}
                  {trip.experiences === 1 ? "experience" : "experiences"}
                </span>
              ) : null}
              <FlagRow codes={trip.countryCodes} />
            </div>
          </Rise>
          {trip.best ? (
            <Rise active={active} delay={440}>
              <div className="mt-5 flex items-center gap-2 text-sm text-white/85">
                <span className="text-white/40">Best of it:</span>
                <span className="min-w-0 break-words">{trip.best.name}</span>
                <RatingDisplay
                  rating={trip.best.rating}
                  size={12}
                  showNumber={false}
                />
              </div>
            </Rise>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TripsView({ slide, active }: { slide: YearTripsSlide; active: boolean }) {
  return (
    <Panel className="max-w-none">
      <Rise active={active}>
        <p className="text-xs uppercase tracking-[0.22em] text-white/40">
          The year in trips
        </p>
      </Rise>
      <Rise active={active} delay={100}>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {slide.trips.length} of them
        </p>
      </Rise>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {slide.trips.map((trip, index) => (
          <Rise
            key={trip.id}
            active={active}
            delay={200 + index * 70}
            className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
          >
            {/* A grid tile is roughly thumbnail-sized, which is the one place
                in this file the thumbnail is the right source. */}
            <div className="relative aspect-[4/3] w-full bg-white/[0.04]">
              {trip.coverThumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={trip.coverThumbUrl}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : null}
            </div>
            <div className="p-2.5 text-left">
              {/* Two lines rather than an ellipsis: a tile is half a phone
                  wide, and "Iceland ring road in..." names nothing. */}
              <p className="line-clamp-2 break-words text-sm font-medium leading-snug text-white">
                {trip.name}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-white/45">
                {trip.dateLabel}
              </p>
            </div>
          </Rise>
        ))}
      </div>
    </Panel>
  );
}

function MomentsView({
  slide,
  active,
}: {
  slide: YearMomentsSlide;
  active: boolean;
}) {
  return (
    <Panel>
      <Rise active={active}>
        <p className="text-xs uppercase tracking-[0.22em] text-white/40">
          The best of it
        </p>
      </Rise>
      <Rise active={active} delay={100}>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          What you rated highest
        </p>
      </Rise>
      <div className="mt-8 flex flex-col gap-3">
        {slide.moments.map((moment, index) => (
          <Rise
            key={moment.id}
            active={active}
            delay={220 + index * 130}
            className="flex items-center gap-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left"
          >
            {/* A photo OF the experience is shown plainly. The stop's own
                picture is not: it is dimmed under the category mark so it
                reads as the place, which is what it is, rather than passing
                for a photograph of the thing this row names. */}
            <div className="relative isolate size-16 shrink-0 overflow-hidden rounded-lg bg-white/[0.05] sm:size-20">
              {moment.photoThumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={moment.photoThumbUrl}
                  alt=""
                  loading="lazy"
                  aria-hidden
                  className={cn(
                    "size-full object-cover",
                    moment.photoOf === "place" &&
                      "opacity-45 saturate-[0.6] blur-[1px]",
                  )}
                />
              ) : null}
              {moment.photoOf === "experience" ? null : (
                <span
                  className="absolute inset-0 flex items-center justify-center text-white/50"
                  style={
                    moment.categoryColor
                      ? { color: moment.categoryColor }
                      : undefined
                  }
                >
                  <CategoryIcon icon={moment.categoryIcon} className="size-5" />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-words text-base font-medium text-white">
                {moment.name}
              </p>
              {/* The place and the trip are the whole context for the name
                  above them, so they wrap rather than ellipsize: at 380px the
                  row has about 230px and one long city name ate all of it. */}
              <p className="mt-0.5 text-xs leading-snug text-white/45">
                {moment.destinationName} · {moment.tripName}
              </p>
              <RatingDisplay
                rating={moment.rating}
                size={12}
                className="mt-1.5 text-white/70"
              />
            </div>
          </Rise>
        ))}
      </div>
    </Panel>
  );
}

function InsightView({
  slide,
  active,
}: {
  slide: YearInsightSlide;
  active: boolean;
}) {
  const insight = slide.insight;
  return (
    <Panel>
      <Rise active={active}>
        <p className="text-xs uppercase tracking-[0.22em] text-brand/80">
          {insight.label}
        </p>
      </Rise>
      <Rise active={active} delay={140}>
        <p className="mt-4 break-words text-4xl font-semibold tracking-tight text-white sm:text-6xl">
          {insight.value}
        </p>
      </Rise>
      <Rise active={active} delay={300}>
        <FlagRow codes={insight.countryCodes} className="mt-6 justify-center" />
      </Rise>
      <Rise active={active} delay={400}>
        <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-white/60">
          {insight.caption}
        </p>
      </Rise>
    </Panel>
  );
}

/**
 * The year in numbers, and the last thing before the closing slide.
 *
 * It was eight identical tiles, which reads as a report footer at exactly the
 * moment a recap should land. Three things fix that and none of them is
 * decoration: the year's own photograph behind it, so the payoff looks like
 * the opener it answers; one or two numbers at real scale with a line of
 * framing, so there is something to actually read; and everything else demoted
 * into one quiet strip instead of nine boxes competing for the same attention.
 */
function ScoreboardView({
  slide,
  active,
}: {
  slide: YearScoreboardSlide;
  active: boolean;
}) {
  const wide = slide.leads.length > 1;
  return (
    <div className="relative size-full bg-[#0a0a0a]">
      {slide.heroUrl ? (
        <div className="absolute inset-0">
          <SlideImage src={slide.heroUrl} thumbSrc={slide.heroThumbUrl} />
        </div>
      ) : null}
      {/* The numbers are the subject, so the photograph is pushed a long way
          back: a flat wash for legibility at any exposure, then a gradient to
          ground the frame. The same pair the opener uses, darker. */}
      <div className="absolute inset-0 bg-black/72" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/45" />

      <div
        className={cn(
          SLIDE_PAD,
          "relative flex size-full flex-col items-center justify-center overflow-y-auto text-center",
        )}
      >
        <div className="w-full max-w-2xl">
          <CountUpGroup active={active}>
            <Rise active={active}>
              <p className="text-xs uppercase tracking-[0.22em] text-white/45">
                That was
              </p>
            </Rise>
            <Rise active={active} delay={90}>
              <p className="mt-1.5 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                {slide.label}
              </p>
            </Rise>

            {slide.leads.length > 0 ? (
              <div
                className={cn(
                  "mt-10 grid gap-8",
                  wide && "sm:grid-cols-2 sm:gap-6",
                )}
              >
                {slide.leads.map((lead, index) => (
                  <Rise key={lead.id} active={active} delay={200 + index * 150}>
                    <ScoreValue
                      value={lead.value}
                      unit={lead.unit}
                      animate
                      className={cn(
                        "font-semibold leading-[0.95] tracking-tight text-white",
                        wide ? "text-5xl sm:text-7xl" : "text-6xl sm:text-8xl",
                      )}
                    />
                    <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/45">
                      {lead.label}
                    </p>
                    {lead.caption ? (
                      <p className="mt-1.5 text-sm text-brand">{lead.caption}</p>
                    ) : null}
                  </Rise>
                ))}
              </div>
            ) : null}

            <Rise active={active} delay={480}>
              <FlagRow
                codes={slide.countryCodes}
                className="mt-8 justify-center"
              />
            </Rise>

            {/* One strip, hairline-divided, rather than a box per number. The
                supporting stats are read as a group or not at all. */}
            {slide.stats.length > 0 ? (
              <Rise active={active} delay={560}>
                <ScoreStrip tiles={slide.stats} animate className="mt-8" />
              </Rise>
            ) : null}

            {slide.closingLine ? (
              <Rise active={active} delay={660}>
                <p className="mx-auto mt-8 max-w-md text-[15px] leading-relaxed text-white/70">
                  {slide.closingLine}
                </p>
              </Rise>
            ) : null}
          </CountUpGroup>
        </div>
      </div>
    </div>
  );
}

/**
 * One bucket list place, with its photograph.
 *
 * The image is resolved client-side through the same lookup and the same
 * session cache the bucket cards use (lib/bucket-hero.ts), so a place cannot
 * show one picture on the bucket page and another here. A miss is a designed
 * state: the tile keeps the brand gradient and the name, which is the part
 * that matters.
 */
function BucketTile({
  item,
  done,
}: {
  item: YearBucketItem;
  done: boolean;
}) {
  const key = bucketHeroKey({
    type: item.type,
    countryCode: item.countryCode,
    placeName: item.placeName,
  });
  const [hero, setHero] = useState<string | null>(
    () => cachedBucketHero(key) ?? null,
  );

  useEffect(() => {
    if (hasCachedBucketHero(key)) return;
    let live = true;
    fetchBucketHero({
      type: item.type,
      countryCode: item.countryCode,
      placeName: item.placeName,
    })
      .then((url) => {
        rememberBucketHero(key, url);
        if (live) setHero(url);
      })
      .catch(() => {
        rememberBucketHero(key, null);
      });
    return () => {
      live = false;
    };
  }, [key, item.type, item.countryCode, item.placeName]);

  return (
    <div className="relative isolate aspect-[4/3] overflow-hidden rounded-xl bg-gradient-to-br from-brand/20 via-[#101623] to-[#0a0a0a] ring-1 ring-white/10">
      {hero ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hero}
          alt=""
          loading="lazy"
          className={cn(
            "absolute inset-0 size-full object-cover",
            done && "saturate-50",
          )}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
      {done ? (
        <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground">
          <CheckIcon className="size-3" />
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 p-2 text-left">
        {/* A place name is the whole point of a bucket tile, so it gets two
            lines rather than an ellipsis: three tiles across a 380px phone
            leave about 85px, and "Machu Picchu" did not fit on one.
            The flag is INLINE rather than a flex item, so only the first line
            pays for it and the second gets the tile's full width; as a flex
            item it narrowed both lines and split "Cappadocia" mid-word. */}
        <p className="line-clamp-2 text-xs font-medium leading-snug text-white">
          {item.countryCode ? (
            <CountryFlag
              code={item.countryCode}
              className="mr-1 inline-block h-3 align-[-1px]"
            />
          ) : null}
          {item.name}
        </p>
        {done && item.fulfilledTripName ? (
          <p className="mt-0.5 truncate text-[10px] text-white/55">
            {item.fulfilledTripName}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The bucket list on the closing slide.
 *
 * It used to be a bar and "0 of 7", which is a scoreboard for something that
 * is not a game: what a bucket list is about is the places on it. So the
 * places are the block and the bar is the footnote. What was ticked off this
 * year leads when there is any, because completing one is the better story and
 * this is a recap of the year that did it.
 */
function BucketBlock({
  bucket,
  active,
}: {
  bucket: YearBucket;
  active: boolean;
}) {
  const nothingLeft = bucket.upNext.length === 0 && bucket.fulfilled > 0;
  return (
    <div className="mt-6">
      {bucket.completed.length > 0 ? (
        <Rise active={active} delay={120}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-brand">
            Ticked off this year
          </p>
          <div
            className={cn(
              "mx-auto mt-2.5 grid gap-2",
              bucket.completed.length === 1
                ? "max-w-[13rem] grid-cols-1"
                : bucket.completed.length === 2
                  ? "max-w-sm grid-cols-2"
                  : "grid-cols-3",
            )}
          >
            {bucket.completed.map((item) => (
              <BucketTile key={item.id} item={item} done />
            ))}
          </div>
        </Rise>
      ) : null}

      {bucket.upNext.length > 0 ? (
        <Rise active={active} delay={bucket.completed.length > 0 ? 260 : 120}>
          <p
            className={cn(
              "text-[11px] uppercase tracking-[0.18em] text-white/40",
              bucket.completed.length > 0 && "mt-6",
            )}
          >
            Still on the list
          </p>
          <div
            className={cn(
              "mx-auto mt-2.5 grid gap-2",
              bucket.upNext.length === 1
                ? "max-w-[13rem] grid-cols-1"
                : bucket.upNext.length === 2
                  ? "max-w-sm grid-cols-2"
                  : "grid-cols-3",
            )}
          >
            {bucket.upNext.map((item) => (
              <BucketTile key={item.id} item={item} done={false} />
            ))}
          </div>
        </Rise>
      ) : null}

      <Rise active={active} delay={360}>
        <div className="mx-auto mt-4 max-w-sm">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-white/50">
              {nothingLeft ? "Bucket list, all done" : "Bucket list"}
            </span>
            <span className="tabular-nums text-white/80">
              {bucket.fulfilled} of {bucket.total}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-700"
              style={{ width: active ? `${bucket.pct}%` : "0%" }}
            />
          </div>
        </div>
      </Rise>
    </div>
  );
}

function ClosingView({
  slide,
  recap,
  active,
  years,
  onSelectYear,
}: {
  slide: YearClosingSlide;
  recap: YearRecap;
  active: boolean;
  years: number[];
  onSelectYear: (year: number) => void;
}) {
  const others = years.filter((year) => year !== slide.year);
  return (
    <Panel>
      <Rise active={active}>
        <p className="text-xs uppercase tracking-[0.22em] text-white/40">
          {slide.upcoming.length > 0 ? "What is next" : "That was your year"}
        </p>
      </Rise>

      {slide.bucket ? (
        <BucketBlock bucket={slide.bucket} active={active} />
      ) : null}

      {slide.upcoming.length > 0 ? (
        <div className="mt-6 flex flex-col gap-2">
          {slide.upcoming.map((trip, index) => (
            <Rise
              key={trip.id}
              active={active}
              delay={220 + index * 110}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left"
            >
              {/* Two rows, not three columns.
                  The flags used to sit in the middle of a single row, between
                  the dates and the countdown, inside their own flex container:
                  that container's min-content width is one flag, so a narrow
                  row squeezed it to two characters and stacked the flags
                  VERTICALLY, which reads as broken layout. The name and the
                  countdown are the row now, and the dates and the flags are one
                  wrapping line under it, where FlagRow's own shrink-0 keeps
                  them horizontal (see FlagRow). */}
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 break-words text-sm font-medium text-white">
                  {trip.name}
                </p>
                {trip.daysAway !== null ? (
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-brand/15 px-2.5 py-1 text-xs tabular-nums text-brand">
                    in {trip.daysAway} {trip.daysAway === 1 ? "day" : "days"}
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-white/45">
                <span>{trip.dateLabel}</span>
                <FlagRow codes={trip.countryCodes} />
              </div>
            </Rise>
          ))}
        </div>
      ) : null}

      <Rise active={active} delay={420}>
        <div className="mt-9 flex justify-center">
          <YearShareCardButton recap={recap} />
        </div>
      </Rise>

      {others.length > 0 ? (
        <Rise active={active} delay={520}>
          <div className="mt-9">
            <p className="text-[11px] uppercase tracking-wide text-white/35">
              Look back at another year
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {others.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => onSelectYear(year)}
                  className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm tabular-nums text-white/80 transition-colors hover:bg-white/[0.12]"
                >
                  {year}
                </button>
              ))}
            </div>
          </div>
        </Rise>
      ) : null}
    </Panel>
  );
}

function SlideView({
  slide,
  active,
  recap,
  years,
  onSelectYear,
}: {
  slide: YearSlide;
  active: boolean;
  recap: YearRecap;
  years: number[];
  onSelectYear: (year: number) => void;
}) {
  switch (slide.kind) {
    case "opener":
      return <OpenerView slide={slide} active={active} />;
    case "scale":
      return <ScaleView slide={slide} active={active} />;
    case "map":
      return <YearMapSlide slide={slide} active={active} />;
    case "trip":
      return <TripView slide={slide} active={active} />;
    case "trips":
      return <TripsView slide={slide} active={active} />;
    case "moments":
      return <MomentsView slide={slide} active={active} />;
    case "insight":
      return <InsightView slide={slide} active={active} />;
    case "scoreboard":
      return <ScoreboardView slide={slide} active={active} />;
    default:
      return (
        <ClosingView
          slide={slide}
          recap={recap}
          active={active}
          years={years}
          onSelectYear={onSelectYear}
        />
      );
  }
}

/** The lead image a slide would render, for warming the next one. Exactly the
 * url that slide requests, thumbnail or full, or the warm-up fetches a
 * different file from the one the slide then asks for. */
function leadImage(slide: YearSlide): string | null {
  if (slide.kind === "opener") return slide.heroUrl;
  if (slide.kind === "trip") return slide.trip.coverUrl;
  if (slide.kind === "trips") return slide.trips[0]?.coverThumbUrl ?? null;
  if (slide.kind === "moments") return slide.moments[0]?.photoThumbUrl ?? null;
  if (slide.kind === "scoreboard") return slide.heroUrl;
  return null;
}

export function YearRecapView({
  input,
  years,
  initialYear,
  onClose,
}: {
  input: YearRecapInput;
  years: number[];
  initialYear: number;
  onClose: () => void;
}) {
  const [year, setYear] = useState(initialYear);
  const [index, setIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const recap = useMemo(() => buildYearRecap(input, year), [input, year]);
  const slides = recap.slides;
  const last = slides.length - 1;

  const next = useCallback(
    () => setIndex((current) => Math.min(current + 1, last)),
    [last],
  );
  const prev = useCallback(
    () => setIndex((current) => Math.max(current - 1, 0)),
    [],
  );

  const selectYear = useCallback((value: number) => {
    setYear(value);
    setIndex(0);
    setPickerOpen(false);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // The closing slide can open the year card dialog over the recap. While
      // it is up it owns the keyboard: Escape closes the dialog and leaves the
      // recap where it was, and the arrows must not page slides behind it.
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        if (pickerOpen) setPickerOpen(false);
        else onClose();
      } else if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, prev, onClose, pickerOpen]);

  // The recap owns the viewport while it is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Warm the next slide's lead image so a forward tap lands on a painted
  // frame. Nothing further ahead is touched.
  useEffect(() => {
    const upcoming = slides[index + 1];
    if (!upcoming) return;
    const url = leadImage(upcoming);
    if (!url) return;
    const image = new Image();
    image.src = url;
  }, [index, slides]);

  function onTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
    touchStartY.current = event.changedTouches[0]?.clientY ?? null;
  }
  function onTouchEnd(event: React.TouchEvent) {
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (startX === null || startY === null) return;
    const dx = (event.changedTouches[0]?.clientX ?? 0) - startX;
    const dy = (event.changedTouches[0]?.clientY ?? 0) - startY;
    // Vertical drags belong to the slide's own scroll, so only a mostly
    // horizontal flick advances the recap.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) next();
    else prev();
  }

  // Rendered into document.body for the same reason the trip story is: the
  // launch points sit inside cards that create their own stacking context.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${recap.label} in travel`}
      className="fixed inset-0 z-50 bg-[#0a0a0a]"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {slides.map((slide, position) => (
        <div
          key={`${year}:${slide.key}`}
          aria-hidden={position !== index}
          className={cn(
            "absolute inset-0 transition-opacity duration-300",
            position === index
              ? "opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          {Math.abs(position - index) <= RENDER_WINDOW ? (
            <SlideView
              slide={slide}
              active={position === index}
              recap={recap}
              years={years}
              onSelectYear={selectYear}
            />
          ) : null}
        </div>
      ))}

      {/* Click zones, under the chrome so the buttons still take their taps. */}
      <button
        type="button"
        aria-label="Previous"
        onClick={prev}
        disabled={index === 0}
        className="absolute inset-y-0 left-0 w-1/5 cursor-w-resize focus-visible:outline-none disabled:cursor-default"
      />
      <button
        type="button"
        aria-label="Next"
        onClick={next}
        disabled={index === last}
        className="absolute inset-y-0 right-0 w-1/5 cursor-e-resize focus-visible:outline-none disabled:cursor-default"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {slides.map((slide, position) => (
          <span
            key={slide.key}
            className={cn(
              "h-0.5 flex-1 rounded-full transition-colors",
              position <= index ? "bg-white/80" : "bg-white/20",
            )}
          />
        ))}
      </div>

      {/* The year, and the way to another one. Top-left, opposite the close
          button, so a recap always says which year is on screen.

          The caret and the count are not decoration: with a bare label this
          read as a caption rather than a control, and the only signal that six
          other years were watchable was that somebody happened to press it. */}
      <div className="absolute left-3 top-[calc(1rem+env(safe-area-inset-top))] z-10">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-expanded={pickerOpen}
          aria-haspopup="menu"
          aria-label={
            years.length > 1
              ? `${recap.label}. Pick another year, ${years.length - 1} more`
              : recap.label
          }
          disabled={years.length <= 1}
          // Same height as the close button opposite it: they read as a pair,
          // and a 26px pill was the smallest tap target in the recap.
          className="flex h-9 items-center gap-1.5 rounded-full bg-black/50 px-3.5 text-xs font-medium tabular-nums text-white/85 backdrop-blur transition-colors hover:bg-black/70 disabled:cursor-default disabled:hover:bg-black/50"
        >
          {recap.label}
          {years.length > 1 ? (
            <>
              <span className="text-white/40">{years.length - 1} more</span>
              <ChevronDownIcon
                className={cn(
                  "size-3.5 text-white/60 transition-transform",
                  pickerOpen && "rotate-180",
                )}
              />
            </>
          ) : null}
        </button>
        {pickerOpen ? (
          <div
            role="menu"
            className="absolute left-0 top-full mt-2 max-h-[50dvh] w-32 overflow-y-auto rounded-xl border border-white/10 bg-black/85 p-1 backdrop-blur"
          >
            {years.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === year}
                onClick={() => selectYear(value)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm tabular-nums transition-colors",
                  value === year
                    ? "bg-brand/15 text-brand"
                    : "text-white/75 hover:bg-white/10",
                )}
              >
                {value}
                {value === year ? <CheckIcon className="size-3.5" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        aria-label="Close recap"
        onClick={onClose}
        className="absolute right-3 top-[calc(1rem+env(safe-area-inset-top))] z-10 flex size-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
      >
        <XIcon className="size-5" />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          aria-label="Previous slide"
          onClick={prev}
          disabled={index === 0}
          className="pointer-events-auto flex size-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 disabled:opacity-30"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] tabular-nums text-white/70 backdrop-blur">
          {index + 1} / {slides.length}
        </span>
        <button
          type="button"
          aria-label="Next slide"
          onClick={next}
          disabled={index === last}
          className="pointer-events-auto flex size-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 disabled:opacity-30"
        >
          <ChevronRightIcon className="size-5" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
