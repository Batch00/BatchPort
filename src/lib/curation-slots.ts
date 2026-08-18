// The curation panel's model: three slots, what is in each one, and what the
// app would put there if the traveller left it alone.
//
// Pure and client-safe, derived entirely from a StoryTrip, which is the same
// payload the story, the recap, and the share card are built from. That is the
// point: the panel is not a second opinion about what those surfaces show, it
// is a reading of the same functions, so what the picker previews and what the
// slide draws cannot disagree.
//
// THE AUTOMATIC FALLBACK IS PART OF THE MODEL, NOT AN ABSENCE
//
// Every slot resolves to something whether or not anything was elected into
// it, and the panel shows the automatic answer in the empty state. A slot that
// rendered as blank would be telling the user nothing happens when they leave
// it alone, which is the opposite of true and was the original sin of the
// version this replaces.

import {
  SLIDE_PHOTO_CAP,
  SLOT_CAPACITY,
  compareCurated,
  distributeStopPhotos,
  heroPhoto,
  stopPhotoCapacity,
} from "@/lib/curation";
import { formatDateRange } from "@/lib/format";
import {
  buildStorySlides,
  curatedStopPhotos,
  photosByStop,
  type StoryDestination,
  type StoryExperience,
  type StoryPhoto,
  type StoryTrip,
} from "@/lib/story";

export interface SlotPhoto {
  id: string;
  url: string;
  thumbUrl: string;
  dateTaken: string | null;
  /** Position within its slot (1 leads), or null when it holds none. */
  position: number | null;
}

export interface SlotExperience {
  id: string;
  name: string;
  /** Raw smallint 1-10, as everywhere else. */
  rating: number | null;
  destinationId: string | null;
  destinationName: string;
  categoryLabel: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  position: number | null;
}

export interface HeroSlot {
  /** The elected photo, or null when the slot is on automatic. */
  chosen: SlotPhoto | null;
  /** What the surfaces use when nothing is elected. Null when the trip has no
   * photograph at all, in which case the card draws its own gradient. */
  automatic: SlotPhoto | null;
  /** Where that automatic answer comes from, said out loud. */
  automaticReason: string;
  /** Every photo on the trip, newest placement order, as the picker's grid. */
  candidates: SlotPhoto[];
}

/**
 * One day slide of a stop, and the photographs that belong to it.
 *
 * The picker is built out of these rather than out of one flat grid, because
 * the picks are spread across the DAYS (see distributeStopPhotos) and a flat
 * grid said nothing about that. Grouped, the model is visible: the traveller
 * can take one from each day, or several from one, and read what each day will
 * then show straight off its own heading.
 *
 * The days are read off the real story slides rather than recomputed from the
 * stay, because a day nobody photographed or wrote about is not a slide and
 * would make every count in the panel one too many.
 */
export interface StopDaySlot {
  /** YYYY-MM-DD. */
  date: string;
  /** Its number within the trip, or null for a day before the trip's anchor. */
  dayNumber: number | null;
  /** The photos taken on this day at this stop: what the picker offers under
   * this heading, and what the slide falls back to when nothing is picked. */
  candidates: SlotPhoto[];
}

export interface StopPhotoSlot {
  destinationId: string;
  destinationName: string;
  /** This stay's own dates, e.g. "Sep 28 to Oct 1". Null when the stop carries
   * none. A slot is one destination ROW, so a trip that returns to the same
   * city shows two slots with the same name; the dates are what tells the
   * traveller which visit they are curating. */
  dateLabel: string | null;
  /**
   * How many photographs this slot holds, derived from the stop's own day
   * slides (see stopPhotoCapacity). Carried on the slot rather than recomputed
   * by the panel, so what the picker enforces and what the story honours are
   * one number.
   */
  capacity: number;
  /** The elected photos in slot order. Empty when the slot is on automatic. */
  chosen: SlotPhoto[];
  /** The photos the story would lead with anyway. */
  automatic: SlotPhoto[];
  /** Every photo of this stop. The write action needs the whole set to clear
   * the ranks it is replacing, so it stays alongside the grouping. */
  candidates: SlotPhoto[];
  /** This stop's day slides, chronological. */
  days: StopDaySlot[];
  /**
   * Photos of this stop with no day slide of their own: undated ones, and ones
   * dated outside the days this stay owns. The story lets them ride the stop's
   * first slide; picked here, they are dealt across the days like any other
   * undated pick, which is why the picker names them rather than hiding them.
   */
  spare: SlotPhoto[];
}

export interface HighlightsSlot {
  chosen: SlotExperience[];
  automatic: SlotExperience[];
  candidates: SlotExperience[];
}

export interface CurationSlots {
  hero: HeroSlot;
  stops: StopPhotoSlot[];
  highlights: HighlightsSlot;
  /** True when nothing anywhere has been elected, so the panel can open with
   * one honest line instead of three empty ones. */
  untouched: boolean;
}

/** The date part of a date or timestamp string. */
function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function toSlotPhoto(photo: StoryPhoto, position: number | null): SlotPhoto {
  return {
    id: photo.id,
    url: photo.url,
    thumbUrl: photo.thumbUrl,
    dateTaken: photo.dateTaken,
    position,
  };
}

/** The order a stop's photos reach a story slide in: by the day they were
 * taken, undated ones last in the order the gallery holds them. Exactly what
 * buildStorySlides does once curation is out of the way. */
function storyOrder(photos: StoryPhoto[]): StoryPhoto[] {
  const dated = photos.filter((photo) => dayOf(photo.dateTaken) !== null);
  const undated = photos.filter((photo) => dayOf(photo.dateTaken) === null);
  dated.sort((a, b) =>
    (dayOf(a.dateTaken) ?? "").localeCompare(dayOf(b.dateTaken) ?? ""),
  );
  return [...dated, ...undated];
}

function heroSlot(trip: StoryTrip): HeroSlot {
  const chosen = heroPhoto(trip.photos);
  const ordered = storyOrder(trip.photos);
  // Both consumers now fall back the same way (the trip cover, then the
  // earliest photograph), so the panel states one answer rather than two. It
  // used to read "the card reaches for the trip cover, the recap for your
  // earliest photo", which was a documented divergence: the recap picked the
  // earliest photograph of the whole YEAR and could not be shown here at all.
  const coverPhoto = trip.coverUrl
    ? (trip.photos.find((photo) => photo.url === trip.coverUrl) ?? null)
    : null;
  const automatic = coverPhoto ?? ordered[0] ?? null;
  return {
    chosen: chosen ? toSlotPhoto(chosen, 1) : null,
    automatic: automatic ? toSlotPhoto(automatic, null) : null,
    automaticReason: coverPhoto
      ? "The trip cover, which backs the share card and stands for this trip in the recap."
      : automatic
        ? "Your earliest photo of the trip."
        : "No photograph yet, so the card draws its own gradient.",
    candidates: ordered.map((photo) => toSlotPhoto(photo, null)),
  };
}

function stopSlots(trip: StoryTrip): StopPhotoSlot[] {
  const { byDestination } = photosByStop(trip);
  // The day slides themselves, which is the only honest source for "how many
  // days does this stop have". Building them costs one pass over rows already
  // in hand, and it is the same call the story makes.
  const dayList = new Map<string, { date: string; dayNumber: number | null }[]>();
  for (const slide of buildStorySlides(trip)) {
    if (slide.kind !== "day" || !slide.destination) continue;
    const list = dayList.get(slide.destination.id) ?? [];
    list.push({ date: slide.date, dayNumber: slide.dayNumber });
    dayList.set(slide.destination.id, list);
  }

  const slots: StopPhotoSlot[] = [];
  for (const destination of trip.destinations) {
    const photos = byDestination.get(destination.id) ?? [];
    if (photos.length === 0) continue;
    const ordered = storyOrder(photos);
    const dates = dayList.get(destination.id) ?? [];
    const dayIndex = new Set(dates.map((day) => day.date));
    // The same call the story makes, so the panel can never show a pick as
    // chosen that the slides have already dropped for want of a seat.
    const capacity = stopPhotoCapacity(dates.length);
    const chosen = curatedStopPhotos(photos, dates.length);

    // Group the candidates the way the slides do: a photo dated to one of this
    // stop's own day slides belongs to that day, and everything else is spare.
    const byDay = new Map<string, SlotPhoto[]>();
    const spare: SlotPhoto[] = [];
    for (const photo of ordered) {
      const date = dayOf(photo.dateTaken);
      if (date !== null && dayIndex.has(date)) {
        const list = byDay.get(date) ?? [];
        list.push(toSlotPhoto(photo, null));
        byDay.set(date, list);
        continue;
      }
      spare.push(toSlotPhoto(photo, null));
    }

    slots.push({
      destinationId: destination.id,
      destinationName: destination.name,
      dateLabel:
        destination.arrivalDate || destination.departureDate
          ? formatDateRange(destination.arrivalDate, destination.departureDate)
          : null,
      capacity,
      chosen: chosen.map((photo, index) => toSlotPhoto(photo, index + 1)),
      // The automatic answer is what the story leads with when nothing is
      // elected: the first photos in date order, up to the seats this stop has.
      automatic: ordered
        .slice(0, capacity)
        .map((photo) => toSlotPhoto(photo, null)),
      candidates: ordered.map((photo) => toSlotPhoto(photo, null)),
      days: dates.map((day) => ({
        date: day.date,
        dayNumber: day.dayNumber,
        candidates: byDay.get(day.date) ?? [],
      })),
      spare,
    });
  }
  return slots;
}

/**
 * What ONE day slide will show, given the current selection.
 *
 * This replaced a paragraph. The panel used to carry a sentence describing the
 * distribution ("3 across 3 days: 2 days show your picks and nothing else, the
 * other 1 fall back to their own photos, then the stop cover"), which is the
 * algorithm rather than the result, and nobody should have to parse a sentence
 * to learn what their picks did. The picker groups its candidates by day now,
 * so each day can simply state its own outcome above its own photographs.
 *
 * Still generated by the SAME function the story places photographs with
 * (distributeStopPhotos), so the panel cannot promise a spread the slides do
 * not make.
 */
export type StopDayOutcome =
  /** The day leads with the traveller's picks, and shows nothing else. */
  | { kind: "picks"; count: number }
  /** Untouched: the day falls back to its own photographs. */
  | { kind: "own"; count: number }
  /** Nothing left to show, so the slide carries the stop's cover. */
  | { kind: "cover" };

export interface StopSelectionPlan {
  /** One outcome per entry in `slot.days`, in the same order. */
  days: StopDayOutcome[];
  /** Picks that found a seat. */
  placed: number;
  /** Picks that did not, because their own day was already full. They stay in
   * the gallery, exactly like a pick past the cap. */
  unplaced: number;
}

export function planStopSelection(
  slot: StopPhotoSlot,
  chosen: SlotPhoto[],
): StopSelectionPlan {
  const dates = slot.days.map((day) => day.date);
  const plan = distributeStopPhotos(dates, chosen, SLIDE_PHOTO_CAP);
  const placedIds = new Set<string>();
  for (const ids of plan.values()) {
    for (const id of ids) placedIds.add(id);
  }
  // Undated leftovers ride the stop's FIRST slide, unless that slide is one the
  // traveller curated (adding to it would put back the fillers the pick just
  // removed). The panel counts them exactly as buildStorySlides does.
  const spareLeft = slot.spare.filter(
    (photo) => !placedIds.has(photo.id),
  ).length;

  const days = slot.days.map((day, index) => {
    const lead = plan.get(day.date)?.length ?? 0;
    if (lead > 0) return { kind: "picks", count: lead } as StopDayOutcome;
    const own =
      day.candidates.filter((photo) => !placedIds.has(photo.id)).length +
      (index === 0 ? spareLeft : 0);
    return (
      own > 0 ? { kind: "own", count: own } : { kind: "cover" }
    ) as StopDayOutcome;
  });

  return {
    days,
    placed: placedIds.size,
    unplaced: chosen.length - placedIds.size,
  };
}

/**
 * The one line left over once every day states its own outcome: what happened
 * to a pick that could not be placed. Empty the rest of the time, because the
 * day headings have already said everything else.
 */
export function summarizeStopSelection(
  slot: StopPhotoSlot,
  chosen: SlotPhoto[],
): string {
  if (chosen.length === 0) return "";
  if (slot.days.length === 0) {
    const shown = Math.min(chosen.length, SLIDE_PHOTO_CAP);
    return shown === chosen.length
      ? "This stop has one slide, so your picks show on it together."
      : `This stop has one slide, so it shows the first ${shown}.`;
  }
  const { unplaced } = planStopSelection(slot, chosen);
  if (unplaced === 0) return "";
  return unplaced === 1
    ? "One pick has nowhere to go: its own day is full."
    : `${unplaced} picks have nowhere to go: their own days are full.`;
}

function toSlotExperience(
  experience: StoryExperience,
  destination: StoryDestination | null,
  position: number | null,
): SlotExperience {
  return {
    id: experience.id,
    name: experience.name,
    rating: experience.rating,
    destinationId: destination?.id ?? null,
    destinationName: destination?.name ?? "",
    categoryLabel: experience.categoryLabel,
    categoryIcon: experience.categoryIcon,
    categoryColor: experience.categoryColor,
    position,
  };
}

function highlightsSlot(trip: StoryTrip): HighlightsSlot {
  const all: { experience: StoryExperience; destination: StoryDestination }[] =
    [];
  // Grouped by stop in visit order, best-rated first inside each stop. The
  // picker renders exactly this list with a heading per run, which is how
  // somebody remembers a trip; sorting the whole trip by rating would scatter
  // one stop's experiences across the list.
  for (const destination of trip.destinations) {
    const here = destination.experiences.map((experience) => ({
      experience,
      destination,
    }));
    here.sort((a, b) => byRatingThenName(a.experience, b.experience));
    all.push(...here);
  }

  const chosen = all
    .filter(({ experience }) => (experience.featuredRank ?? 0) > 0)
    .sort((a, b) => compareCurated(a.experience, b.experience))
    .slice(0, SLOT_CAPACITY.highlights);

  // The automatic answer is exactly what the card computes with nothing
  // elected: rated only, best first, ties on the name. Rated only because the
  // row prints a star beside each line, which is also why an unrated candidate
  // is offered but flagged in the picker rather than hidden.
  const automatic = all
    .filter(({ experience }) => experience.rating !== null)
    .sort((a, b) => byRatingThenName(a.experience, b.experience))
    .slice(0, SLOT_CAPACITY.highlights);

  return {
    chosen: chosen.map((entry, index) =>
      toSlotExperience(entry.experience, entry.destination, index + 1),
    ),
    automatic: automatic.map((entry) =>
      toSlotExperience(entry.experience, entry.destination, null),
    ),
    candidates: all.map((entry) =>
      toSlotExperience(entry.experience, entry.destination, null),
    ),
  };
}

/** The fallback order, with the curation half deliberately left out: this is
 * what the surfaces would show if nothing were elected. */
function byRatingThenName(a: StoryExperience, b: StoryExperience): number {
  return compareCurated(
    { rating: a.rating, name: a.name },
    { rating: b.rating, name: b.name },
  );
}

/** Every slot of one trip, with what is in it and what would be. */
export function buildCurationSlots(trip: StoryTrip): CurationSlots {
  const hero = heroSlot(trip);
  const stops = stopSlots(trip);
  const highlights = highlightsSlot(trip);
  return {
    hero,
    stops,
    highlights,
    untouched:
      hero.chosen === null &&
      highlights.chosen.length === 0 &&
      stops.every((stop) => stop.chosen.length === 0),
  };
}

// --- Previewing a selection before the server has confirmed it ---------------
//
// The panel saves every change immediately, but "saved" and "in the props" are
// not the same moment: a write is followed by router.refresh(), and until that
// round trip lands the StoryTrip on the page still describes the selection
// before the last tap. Previewing the story off that would show the traveller
// the composition they just changed away from, which is worse than not
// offering a preview at all.
//
// So the panel keeps the selection it is holding locally and this applies it to
// a StoryTrip, purely, for the preview to render. It mirrors what the three
// server actions write and nothing else: hero takes slot 'hero' at rank 1, a
// stop's picks take slot 'stop' ranked from 1 within that stop, highlights take
// featured_rank from 1 across the trip, and every row the selection covers but
// does not name is cleared. check-curation asserts the round trip, which is
// what stops this drifting from lib/actions/curation.ts.

/**
 * A sparse override. An absent key means "not touched, use what the trip
 * already says", which is what makes an untouched panel preview the real story
 * rather than a reconstruction of it.
 */
export interface CurationSelection {
  /** null clears the slot back to automatic. */
  heroId?: string | null;
  /** Keyed by destination id. */
  stopPhotoIds?: Record<string, string[]>;
  highlightIds?: string[];
}

export function hasCurationSelection(selection: CurationSelection): boolean {
  return (
    selection.heroId !== undefined ||
    selection.highlightIds !== undefined ||
    Object.keys(selection.stopPhotoIds ?? {}).length > 0
  );
}

export function applyCurationSelection(
  trip: StoryTrip,
  selection: CurationSelection,
): StoryTrip {
  if (!hasCurationSelection(selection)) return trip;

  // What each named photo becomes, and which photos are in scope to be cleared.
  const assigned = new Map<string, { slot: "hero" | "stop"; rank: number }>();
  const cleared = new Set<string>();

  if (selection.heroId !== undefined) {
    for (const photo of trip.photos) {
      if (photo.featuredSlot === "hero") cleared.add(photo.id);
    }
    if (selection.heroId) {
      assigned.set(selection.heroId, { slot: "hero", rank: 1 });
    }
  }

  if (selection.stopPhotoIds) {
    // The candidate set per stop is resolved the same way the panel offered it
    // and the action clears it: by placement, not by which row a photo hangs
    // off, so a revisit's two stays stay separate here too.
    const { byDestination } = photosByStop(trip);
    for (const [destinationId, ids] of Object.entries(selection.stopPhotoIds)) {
      for (const photo of byDestination.get(destinationId) ?? []) {
        // A hero elected out of this stop's photos keeps its slot: the two are
        // independent elections, exactly as setStopPhotosAction has it.
        if (photo.featuredSlot !== "hero") cleared.add(photo.id);
      }
      ids.forEach((id, index) => {
        assigned.set(id, { slot: "stop", rank: index + 1 });
      });
    }
  }

  const photos =
    assigned.size > 0 || cleared.size > 0
      ? trip.photos.map((photo) => {
          const next = assigned.get(photo.id);
          if (next) {
            return {
              ...photo,
              featuredSlot: next.slot,
              featuredRank: next.rank,
            };
          }
          if (!cleared.has(photo.id)) return photo;
          return { ...photo, featuredSlot: null, featuredRank: null };
        })
      : trip.photos;

  if (selection.highlightIds === undefined) {
    return { ...trip, photos };
  }

  const rankById = new Map(
    selection.highlightIds.map((id, index) => [id, index + 1] as const),
  );
  return {
    ...trip,
    photos,
    destinations: trip.destinations.map((destination) => ({
      ...destination,
      experiences: destination.experiences.map((experience) => ({
        ...experience,
        featuredRank: rankById.get(experience.id) ?? null,
      })),
    })),
  };
}

/** Whether a trip has anything to curate at all. Callers hide the entry point
 * rather than opening a panel of three empty slots. */
export function hasCurationSlots(trip: StoryTrip): boolean {
  return (
    trip.photos.length > 0 ||
    trip.destinations.some(
      (destination) => destination.experiences.length > 0,
    )
  );
}
