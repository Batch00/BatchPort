"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MapPinIcon,
  XIcon,
} from "lucide-react";

import { CategoryIcon } from "@/components/category-icon";
import { CountryFlag } from "@/components/country-flag";
import { RatingDisplay } from "@/components/rating-display";
import { VisitWeatherLine } from "@/components/weather/visit-weather";
import { journalDayLabel } from "@/lib/journal";
import { formatKm } from "@/lib/stats-format";
import {
  buildStorySlides,
  slideImageUrls,
  type StoryDaySlide,
  type StoryExperience,
  type StoryPhoto,
  type StorySlide,
  type StoryStopSlide,
  type StoryTrip,
} from "@/lib/story";
import { durationDays, formatDateRange, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

// The trip story: a full-screen, chronological reading of one trip, built from
// rows the host already has (see lib/story.ts for the composition rule). It is
// a photo story first: where a day has photos they fill the frame and the text
// sits over them; where it does not, the stop's cover carries the slide and
// the writing takes the foreground.
//
// Read-only by construction. Nothing in this tree mutates, which is why the
// demo and /share/[slug] surfaces can open the same component.
//
// Loading: only the slides within RENDER_WINDOW of the current one are
// mounted, and the next slide's lead image is warmed with a bare Image()
// preload. A fifty-photo trip therefore costs a handful of requests to open,
// not fifty.

const RENDER_WINDOW = 1;

/** Swipe distance, in px, that counts as a deliberate flick rather than a
 * wobble while tapping. Matches the lightbox. */
const SWIPE_THRESHOLD = 50;

function PhotoFrame({
  photo,
  priority,
  className,
}: {
  photo: StoryPhoto;
  priority: boolean;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.url}
      alt=""
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={cn("size-full object-cover", className)}
    />
  );
}

/** The photo layer behind a slide: one image full-bleed, or a tight grid for
 * two to four, with the rest counted in the corner. */
function PhotoBackdrop({ photos }: { photos: StoryPhoto[] }) {
  if (photos.length === 0) return null;
  const shown = photos.slice(0, 4);
  return (
    <div className="absolute inset-0">
      {shown.length === 1 ? (
        <PhotoFrame photo={shown[0]} priority />
      ) : (
        <div
          className={cn(
            "grid size-full gap-0.5",
            shown.length === 2 ? "grid-rows-2 sm:grid-cols-2 sm:grid-rows-1" : "grid-cols-2 grid-rows-2",
          )}
        >
          {shown.map((photo, index) => (
            <div
              key={photo.id}
              className={cn(
                "relative overflow-hidden",
                shown.length === 3 && index === 0 && "row-span-2",
              )}
            >
              <PhotoFrame photo={photo} priority={index < 2} />
            </div>
          ))}
        </div>
      )}
      {photos.length > shown.length ? (
        <span className="absolute right-4 top-4 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/80 backdrop-blur">
          +{photos.length - shown.length} more
        </span>
      ) : null}
    </div>
  );
}

function ExperienceList({ experiences }: { experiences: StoryExperience[] }) {
  if (experiences.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1.5">
      {experiences.map((experience) => (
        <li
          key={experience.id}
          className="flex items-center gap-2 text-sm text-white/85"
        >
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded bg-white/10"
            style={
              experience.categoryColor
                ? { color: experience.categoryColor }
                : undefined
            }
          >
            <CategoryIcon icon={experience.categoryIcon} className="size-3" />
          </span>
          <span className="min-w-0 flex-1 break-words">{experience.name}</span>
          {experience.rating !== null ? (
            <RatingDisplay
              rating={experience.rating}
              size={12}
              showNumber={false}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The scrim and text column shared by the day and stop slides. */
function SlideBody({
  children,
  dense,
}: {
  children: React.ReactNode;
  dense: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20",
          dense && "from-black/95 via-black/80 to-black/50",
        )}
      />
      <div className="relative flex size-full items-end justify-center overflow-y-auto p-6 pb-16 sm:p-10 sm:pb-20">
        <div className="w-full max-w-2xl">{children}</div>
      </div>
    </>
  );
}

function DaySlideView({ slide }: { slide: StoryDaySlide }) {
  const destination = slide.destination;
  // Weather belongs to the stay, so it rides the slide that opens a stop.
  const showWeather =
    slide.opensDestination &&
    destination !== null &&
    destination.latitude !== null &&
    destination.longitude !== null;
  const hasPhotos = slide.photos.length > 0;

  return (
    <div className="relative size-full bg-[#0a0a0a]">
      {hasPhotos ? (
        <PhotoBackdrop photos={slide.photos} />
      ) : destination?.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={destination.coverUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover opacity-40 blur-[2px]"
        />
      ) : null}

      <SlideBody dense={!hasPhotos}>
        <p className="text-xs uppercase tracking-[0.18em] text-white/50">
          {slide.dayNumber !== null ? `Day ${slide.dayNumber} · ` : ""}
          {journalDayLabel(slide.date)}
        </p>
        {destination ? (
          <h2 className="mt-1 flex flex-wrap items-center gap-x-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            <span className="min-w-0 break-words">{destination.name}</span>
            {destination.countryCode ? (
              <CountryFlag code={destination.countryCode} className="h-4" />
            ) : null}
          </h2>
        ) : null}

        {showWeather && destination ? (
          <VisitWeatherLine
            lat={destination.latitude}
            lng={destination.longitude}
            start={destination.arrivalDate}
            end={destination.departureDate}
            className="mt-2 text-white/50"
          />
        ) : null}

        {slide.journal ? (
          <p className="mt-3 max-w-prose whitespace-pre-line text-[15px] leading-relaxed text-white/90">
            {slide.journal}
          </p>
        ) : null}

        <ExperienceList experiences={slide.experiences} />
      </SlideBody>
    </div>
  );
}

function StopSlideView({ slide }: { slide: StoryStopSlide }) {
  const destination = slide.destination;
  const hasPhotos = slide.photos.length > 0;
  return (
    <div className="relative size-full bg-[#0a0a0a]">
      {hasPhotos ? (
        <PhotoBackdrop photos={slide.photos} />
      ) : destination.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={destination.coverUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <SlideBody dense={!hasPhotos && !destination.coverUrl}>
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-white/50">
          <MapPinIcon className="size-3.5" />
          {formatDateRange(destination.arrivalDate, destination.departureDate)}
        </p>
        <h2 className="mt-1 flex flex-wrap items-center gap-x-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          <span className="min-w-0 break-words">{destination.name}</span>
          {destination.countryCode ? (
            <CountryFlag code={destination.countryCode} className="h-4" />
          ) : null}
        </h2>
        <ExperienceList experiences={slide.experiences} />
      </SlideBody>
    </div>
  );
}

function SlideView({ slide }: { slide: StorySlide }) {
  if (slide.kind === "day") return <DaySlideView slide={slide} />;
  if (slide.kind === "stop") return <StopSlideView slide={slide} />;

  if (slide.kind === "opener") {
    const trip = slide.trip;
    const days = durationDays(trip.startDate, trip.endDate);
    return (
      <div className="relative size-full bg-[#0a0a0a]">
        {trip.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trip.coverUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : slide.photos.length > 0 ? (
          <PhotoBackdrop photos={slide.photos} />
        ) : null}
        {/* Two layers: a flat wash so the centred title reads over a bright
            photo at any exposure, and the gradient that keeps the frame
            grounded. Either one alone left the title fighting the image. */}
        <div className="absolute inset-0 bg-black/45" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/20" />
        <div className="relative flex size-full flex-col items-center justify-center overflow-y-auto p-6 text-center sm:p-10">
          <p className="text-xs uppercase tracking-[0.22em] text-white/70">
            {formatDateRange(trip.startDate, trip.endDate)}
            {days ? ` · ${formatDuration(days)}` : ""}
          </p>
          <h1 className="mt-3 max-w-3xl break-words text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            {trip.name}
          </h1>
          {slide.route ? (
            <p className="mt-3 max-w-xl text-sm text-white/70">{slide.route}</p>
          ) : null}
          {slide.countryCodes.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
              {slide.countryCodes.map((code) => (
                <CountryFlag key={code} code={code} className="h-4" />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const stats = slide.stats;
  const tiles: { label: string; value: string }[] = [];
  if (stats.days) tiles.push({ label: "Days", value: String(stats.days) });
  tiles.push({
    label: stats.destinations === 1 ? "Stop" : "Stops",
    value: String(stats.destinations),
  });
  if (stats.countries > 0) {
    tiles.push({
      label: stats.countries === 1 ? "Country" : "Countries",
      value: String(stats.countries),
    });
  }
  if (stats.experiences > 0) {
    tiles.push({ label: "Experiences", value: String(stats.experiences) });
  }
  if (stats.photos > 0) {
    tiles.push({ label: "Photos", value: String(stats.photos) });
  }
  if (stats.distanceKm !== null) {
    tiles.push({ label: "Travelled", value: formatKm(stats.distanceKm) });
  }

  return (
    <div className="relative flex size-full flex-col items-center justify-center overflow-y-auto bg-[#0a0a0a] p-6 text-center sm:p-10">
      <p className="text-xs uppercase tracking-[0.22em] text-white/40">
        That was
      </p>
      <h2 className="mt-2 max-w-3xl break-words text-3xl font-semibold tracking-tight text-white sm:text-5xl">
        {slide.trip.name}
      </h2>
      <dl className="mt-8 grid w-full max-w-lg grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-4"
          >
            <dd className="text-2xl font-semibold tabular-nums text-white">
              {tile.value}
            </dd>
            <dt className="mt-0.5 text-[11px] uppercase tracking-wide text-white/40">
              {tile.label}
            </dt>
          </div>
        ))}
      </dl>
      {stats.best ? (
        <div className="mt-8 max-w-md">
          <p className="text-[11px] uppercase tracking-wide text-white/40">
            Best of the trip
          </p>
          <p className="mt-1 break-words text-lg text-white">
            {stats.best.name}
          </p>
          <p className="mt-0.5 flex items-center justify-center gap-2 text-xs text-white/50">
            {stats.best.destinationName}
            <RatingDisplay rating={stats.best.rating} size={12} />
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function TripStory({
  trip,
  onClose,
}: {
  trip: StoryTrip;
  onClose: () => void;
}) {
  const slides = useMemo(() => buildStorySlides(trip), [trip]);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const last = slides.length - 1;
  const next = useCallback(
    () => setIndex((current) => Math.min(current + 1, last)),
    [last],
  );
  const prev = useCallback(
    () => setIndex((current) => Math.max(current - 1, 0)),
    [],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
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
  }, [next, prev, onClose]);

  // The story owns the viewport while it is open, so nothing behind it should
  // scroll under the finger.
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
    const url = slideImageUrls(upcoming)[0];
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
    // Vertical drags belong to the slide's own scroll (a long journal entry),
    // so only a mostly-horizontal flick advances the story.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) next();
    else prev();
  }

  // The overlay renders into document.body rather than in place. Its launch
  // points sit inside cards that create their own stacking context (the share
  // card is `isolate`, the trip banner clips its own children), and a fixed
  // z-50 element inside one of those cannot rise above the cards after it.
  // StoryLauncher only mounts this after a click, so document always exists;
  // the guard is there so rendering it directly cannot break a server render.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${trip.name} story`}
      className="fixed inset-0 z-50 bg-[#0a0a0a]"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {slides.map((slide, position) => (
        <div
          key={slide.key}
          aria-hidden={position !== index}
          className={cn(
            "absolute inset-0 transition-opacity duration-300",
            position === index
              ? "opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          {Math.abs(position - index) <= RENDER_WINDOW ? (
            <SlideView slide={slide} />
          ) : null}
        </div>
      ))}

      {/* Click zones. They sit under the chrome, so the close button and the
          arrows still take their own taps. */}
      <button
        type="button"
        aria-label="Previous"
        onClick={prev}
        disabled={index === 0}
        className="absolute inset-y-0 left-0 w-1/4 cursor-w-resize focus-visible:outline-none disabled:cursor-default"
      />
      <button
        type="button"
        aria-label="Next"
        onClick={next}
        disabled={index === last}
        className="absolute inset-y-0 right-0 w-1/4 cursor-e-resize focus-visible:outline-none disabled:cursor-default"
      />

      {/* Progress: one segment per slide, filled up to where you are. */}
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

      <button
        type="button"
        aria-label="Close story"
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
