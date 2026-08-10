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
  stopPhotoRank,
  stopPhotosFirst,
} from "@/lib/curation";
import {
  buildStorySlides,
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

export interface StopPhotoSlot {
  destinationId: string;
  destinationName: string;
  /** The elected photos in slot order. Empty when the slot is on automatic. */
  chosen: SlotPhoto[];
  /** The photos the story would lead with anyway. */
  automatic: SlotPhoto[];
  candidates: SlotPhoto[];
  /**
   * The dates of this stop's day slides, chronological, exactly as
   * buildStorySlides produced them.
   *
   * This is what the picks are spread across, so the panel needs it to say
   * what a selection will actually produce rather than leaving the traveller
   * to guess. Read off the real slides rather than recomputed from the stay,
   * because a day nobody photographed or wrote about is not a slide and would
   * make every count in the panel one too many.
   */
  dayDates: string[];
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
  // The two consumers fall back differently and the panel says so rather than
  // picking one and hoping: the card reaches for the trip cover, the recap for
  // the earliest photograph of the year. The preview shows the cover, because
  // that is the one an exported image would actually print.
  const coverPhoto = trip.coverUrl
    ? (trip.photos.find((photo) => photo.url === trip.coverUrl) ?? null)
    : null;
  const automatic = coverPhoto ?? ordered[0] ?? null;
  return {
    chosen: chosen ? toSlotPhoto(chosen, 1) : null,
    automatic: automatic ? toSlotPhoto(automatic, null) : null,
    automaticReason: coverPhoto
      ? "The trip cover backs the share card, and your earliest photo opens the recap."
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
  const dayDates = new Map<string, string[]>();
  for (const slide of buildStorySlides(trip)) {
    if (slide.kind !== "day" || !slide.destination) continue;
    const list = dayDates.get(slide.destination.id) ?? [];
    list.push(slide.date);
    dayDates.set(slide.destination.id, list);
  }

  const slots: StopPhotoSlot[] = [];
  for (const destination of trip.destinations) {
    const photos = byDestination.get(destination.id) ?? [];
    if (photos.length === 0) continue;
    const chosen = stopPhotosFirst(photos)
      .filter((photo) => stopPhotoRank(photo) !== null)
      .slice(0, SLOT_CAPACITY.stopPhotos);
    const ordered = storyOrder(photos);
    const days = dayDates.get(destination.id) ?? [];
    // The automatic answer is what the story leads with when nothing is
    // elected: the first photos in date order, one slide's worth per day.
    const automaticCap = Math.max(
      SLIDE_PHOTO_CAP,
      Math.min(SLOT_CAPACITY.stopPhotos, days.length),
    );
    slots.push({
      destinationId: destination.id,
      destinationName: destination.name,
      chosen: chosen.map((photo, index) => toSlotPhoto(photo, index + 1)),
      automatic: ordered
        .slice(0, automaticCap)
        .map((photo) => toSlotPhoto(photo, null)),
      candidates: ordered.map((photo) => toSlotPhoto(photo, null)),
      dayDates: days,
    });
  }
  return slots;
}

/**
 * What a stop's current selection will produce, as one sentence.
 *
 * The panel renders this instead of a rule the traveller has to infer. It is
 * the SAME function the story places photographs with (distributeStopPhotos),
 * so the sentence cannot describe a spread the slides do not make.
 */
export function describeStopSelection(
  slot: StopPhotoSlot,
  chosen: SlotPhoto[],
): string {
  if (chosen.length === 0) return "";
  if (slot.dayDates.length === 0) {
    const shown = Math.min(chosen.length, SLIDE_PHOTO_CAP);
    return shown === chosen.length
      ? `This stop has one slide, so all ${chosen.length} show on it together.`
      : `This stop has one slide, so the first ${shown} of your ${chosen.length} show on it together.`;
  }
  const plan = distributeStopPhotos(slot.dayDates, chosen, SLIDE_PHOTO_CAP);
  const counts = slot.dayDates.map((date) => plan.get(date)?.length ?? 0);
  const placed = counts.reduce((total, count) => total + count, 0);
  const days = slot.dayDates.length;
  const dayWord = days === 1 ? "day" : "days";
  const head =
    placed === chosen.length
      ? `${chosen.length} across ${days} ${dayWord}`
      : `${placed} of ${chosen.length} across ${days} ${dayWord}`;
  const empty = counts.filter((count) => count === 0).length;
  if (empty > 0) {
    const led = days - empty;
    return `${head}: ${led} ${led === 1 ? "day shows" : "days show"} your picks and nothing else, the other ${empty} fall back to their own photos, then the stop cover.`;
  }
  const spread = counts.every((count) => count === counts[0])
    ? counts[0] === 1
      ? "one each"
      : `${counts[0]} each`
    : counts.join(", ");
  return `${head}: ${spread}.`;
}

/** The nudge under the sentence: how many picks would give this stop one
 * photograph a day. Empty when the selection already covers it, because a
 * traveller who has chosen enough does not need advice. */
export function suggestStopCount(
  slot: StopPhotoSlot,
  chosen: SlotPhoto[],
): string {
  const days = slot.dayDates.length;
  if (days <= 1 || chosen.length >= days) return "";
  const want = Math.min(days, SLOT_CAPACITY.stopPhotos, slot.candidates.length);
  if (want <= chosen.length) return "";
  return `${want} would cover every day here. There is no minimum; the rest fall back on their own.`;
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
