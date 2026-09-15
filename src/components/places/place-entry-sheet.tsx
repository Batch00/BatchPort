"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BriefcaseIcon,
  CalendarDaysIcon,
  CarIcon,
  HeartIcon,
  MapPinIcon,
  MusicIcon,
  PartyPopperIcon,
  TicketIcon,
  TreePalmIcon,
  TrophyIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { PlaceSearchInput } from "@/components/places/place-search-input";
import { PlaceTypeIcon } from "@/components/places/place-type-icon";
import { TransportModeIcon } from "@/components/transport-mode-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addPlaceVisitAction,
  createPlaceAction,
  updatePlaceVisitAction,
} from "@/lib/actions/places";
import { useConnectionGuard } from "@/lib/offline/use-offline";
import type { PlaceSearchResult } from "@/lib/place-search";
import { PLACE_TYPES } from "@/lib/place-types";
import { TRANSPORT_MODES, type TransportMode } from "@/lib/transport";
import type { Occasion, Place, PlaceType, PlaceVisit } from "@/lib/types";
import { cn } from "@/lib/utils";

// The log-a-place sheet. One screen, mobile first, because this is a PWA and a
// place gets logged standing outside the thing that was just logged.
//
// The sheet never shows that a place and a visit are two tables. Creating is
// one action writing both (atomically, through batchport.create_place_with_visit);
// adding a later visit to a place that already exists is the same sheet with
// the place half fixed, which is why `place` is a prop rather than a second
// component. Two forms for one set of fields is how they drift.
//
// Progressive disclosure is the whole layout: nothing below the search exists
// until something is picked, so the resting state is one field and a sentence.

/** The occasion slug that turns on the event fields. */
const GAME_SLUG = "game";

// occasions.icon holds a lucide export name. An explicit map rather than a
// dynamic lookup on the namespace, which would pull the entire icon library
// into the bundle to render eleven of them.
const OCCASION_ICONS: Record<string, LucideIcon> = {
  Ticket: TicketIcon,
  Music: MusicIcon,
  TreePalm: TreePalmIcon,
  CalendarDays: CalendarDaysIcon,
  Car: CarIcon,
  Heart: HeartIcon,
  Users: UsersIcon,
  Briefcase: BriefcaseIcon,
  Trophy: TrophyIcon,
  PartyPopper: PartyPopperIcon,
  MapPin: MapPinIcon,
};

function OccasionIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && OCCASION_ICONS[name]) || MapPinIcon;
  return <Icon className={className} />;
}

interface PlaceEntrySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  occasions: Occasion[];
  /**
   * Present for "add another visit": the place half is fixed and only the
   * visit fields are asked for. Absent for a new place.
   */
  place?: Place;
  /**
   * Present WITH `place` to edit an existing visit rather than add one. Three
   * modes in one component on purpose: they ask for the same fields, and a
   * second form for editing is how the two drift.
   */
  visit?: PlaceVisit;
  /** Tenants of the fixed place, when it is a tracked venue. */
  tenants?: string[];
  onSaved?: (placeId: string) => void;
}

export function PlaceEntrySheet({
  open,
  onOpenChange,
  occasions,
  place,
  visit: editingVisit,
  tenants,
  onSaved,
}: PlaceEntrySheetProps) {
  const editingExisting = Boolean(place);
  const editingOneVisit = Boolean(place && editingVisit);
  const guard = useConnectionGuard();

  const [picked, setPicked] = useState<PlaceSearchResult | null>(null);
  const [name, setName] = useState(place?.name ?? "");
  const [placeType, setPlaceType] = useState<PlaceType>(place?.place_type ?? "city");

  const [visitDate, setVisitDate] = useState(editingVisit?.visit_date ?? "");
  const [endDate, setEndDate] = useState(editingVisit?.end_date ?? "");
  const [occasionId, setOccasionId] = useState<string | null>(editingVisit?.occasion_id ?? null);
  const [eventOrg, setEventOrg] = useState(editingVisit?.event_org ?? "");
  const [eventDetail, setEventDetail] = useState(editingVisit?.event_detail ?? "");
  const [transportMode, setTransportMode] = useState<TransportMode | null>(
    editingVisit?.transport_mode ?? null,
  );
  const [notes, setNotes] = useState(editingVisit?.notes ?? "");
  const [busy, setBusy] = useState(false);

  // A catalog pick answers "what kind of thing is this" itself, so the type row
  // becomes a statement rather than a question.
  const typeLocked = Boolean(picked?.catalog_item_id);
  const availableTenants = editingExisting ? (tenants ?? []) : (picked?.tenants ?? []);
  const occasionSlug = occasions.find((o) => o.id === occasionId)?.slug ?? null;
  const isGame = occasionSlug === GAME_SLUG;

  // Tenant chips are for "which of the teams that play here did I come to see",
  // which is only a question when the venue is tracked AND we know its tenants
  // AND the visit was a game. Any other time the row would be noise, and
  // event_org stays whatever was typed.
  const showTenants = isGame && availableTenants.length > 0;

  const locationLine = useMemo(() => {
    const source = editingExisting
      ? [place?.locality_name, place?.admin_region, place?.country_code]
      : [picked?.locality_name, picked?.admin_region, picked?.country_code];
    return source.filter(Boolean).join(", ");
  }, [editingExisting, place, picked]);

  function reset() {
    setPicked(null);
    setName(place?.name ?? "");
    setPlaceType(place?.place_type ?? "city");
    setVisitDate(editingVisit?.visit_date ?? "");
    setEndDate(editingVisit?.end_date ?? "");
    setOccasionId(editingVisit?.occasion_id ?? null);
    setEventOrg(editingVisit?.event_org ?? "");
    setEventDetail(editingVisit?.event_detail ?? "");
    setTransportMode(editingVisit?.transport_mode ?? null);
    setNotes(editingVisit?.notes ?? "");
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handlePick(result: PlaceSearchResult) {
    setPicked(result);
    setName(result.name);
    setPlaceType(result.place_type);
    // A venue picked after a team was chosen would keep the old team.
    setEventOrg("");
  }

  async function handleSave() {
    if (guard("Logging a place")) return;
    if (!editingExisting && !picked) {
      toast.error("Search for a place first.");
      return;
    }
    if (!name.trim()) {
      toast.error("A name is required.");
      return;
    }
    if (!visitDate) {
      toast.error("When were you there?");
      return;
    }

    const visit = {
      visit_date: visitDate,
      end_date: endDate || null,
      occasion_id: occasionId,
      occasion_label: null,
      // Only game visits carry these, so they are cleared rather than sent
      // stale when the occasion is something else.
      event_org: isGame ? eventOrg.trim() || null : null,
      event_detail: isGame ? eventDetail.trim() || null : null,
      transport_mode: transportMode,
      trip_id: null,
      notes: notes.trim() || null,
    };

    setBusy(true);
    try {
      // The two paths are kept apart rather than merged into one ternary: they
      // return different shapes ({ visitId } and { placeId, visitId }), and a
      // union of the two narrows to the smaller one.
      let savedPlaceId: string;
      let addedToExisting = false;
      if (editingOneVisit) {
        const result = await updatePlaceVisitAction(editingVisit!.id, visit);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        savedPlaceId = place!.id;
      } else if (editingExisting) {
        const result = await addPlaceVisitAction(place!.id, visit);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        savedPlaceId = place!.id;
      } else {
        const result = await createPlaceAction(
          {
            name: name.trim(),
            place_type: placeType,
            lat: picked!.lat,
            lng: picked!.lng,
            country_code: picked!.country_code,
            admin_region: picked!.admin_region,
            locality_name: picked!.locality_name,
            catalog_item_id: picked!.catalog_item_id,
            notes: null,
          },
          visit,
        );
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        savedPlaceId = result.placeId;
        // The action folds a duplicate into the place that already exists, so
        // say which of the two things happened rather than claiming a new
        // place was logged when a visit was added to an old one.
        addedToExisting = result.addedToExisting;
      }

      toast.success(
        editingOneVisit
          ? "Visit updated."
          : editingExisting
            ? "Visit added."
            : addedToExisting
              ? `Added a visit to ${name.trim()}, which you already had.`
              : `${name.trim()} logged.`,
      );
      onSaved?.(savedPlaceId);
      handleOpenChange(false);
    } catch {
      toast.error("Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const showRest = editingExisting || picked !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingOneVisit ? "Edit visit" : editingExisting ? "Add another visit" : "Log a place"}
          </DialogTitle>
          <DialogDescription>
            {editingOneVisit
              ? `A visit to ${place?.name}.`
              : editingExisting
                ? `Another time you were at ${place?.name}.`
                : "Somewhere you stayed overnight or spent a real day. Not layovers or drive-throughs."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 1. Search, or the fixed place when adding a visit. */}
          {editingExisting ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <PlaceTypeIcon type={place!.place_type} className="mt-0.5 size-4 text-brand" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{place!.name}</p>
                {locationLine ? (
                  <p className="truncate text-xs text-muted-foreground">{locationLine}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="place-search">Where</Label>
              <PlaceSearchInput id="place-search" onPick={handlePick} />
            </div>
          )}

          {showRest ? (
            <>
              {/* Name stays editable even for a catalog pick: everything else
                  from the catalog is fixed, but what you call it is yours. */}
              {!editingExisting ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="place-name">Name</Label>
                  <Input
                    id="place-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                  {locationLine ? (
                    <p className="text-xs text-muted-foreground">{locationLine}</p>
                  ) : null}
                </div>
              ) : null}

              {/* 2. Place type: a statement for a catalog pick, a question otherwise. */}
              {!editingExisting ? (
                <div className="flex flex-col gap-1.5">
                  <Label>Type</Label>
                  {typeLocked ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-foreground">
                        <PlaceTypeIcon type={placeType} className="size-4 text-brand" />
                        {PLACE_TYPES.find((p) => p.type === placeType)?.label}
                      </span>
                      {picked?.catalogs.map((c) => (
                        <span key={c.slug} className="text-xs">
                          {c.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {PLACE_TYPES.map((option) => {
                        const active = option.type === placeType;
                        return (
                          <button
                            key={option.type}
                            type="button"
                            disabled={busy}
                            aria-pressed={active}
                            onClick={() => setPlaceType(option.type)}
                            className={cn(
                              "flex flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-[11px] transition-colors disabled:opacity-50",
                              active
                                ? "border-brand bg-brand/15 text-foreground"
                                : "border-white/10 bg-white/[0.03] text-foreground/60 hover:bg-white/[0.07] hover:text-foreground",
                            )}
                          >
                            <PlaceTypeIcon type={option.type} className="size-4" />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              {/* 3. When. An open range is a valid intermediate state. */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="place-dates">When</Label>
                <DateRangePicker
                  id="place-dates"
                  start={visitDate}
                  end={endDate}
                  disabled={busy}
                  placeholder="Pick a date"
                  ariaLabel="Visit date, and an end date if it spanned days"
                  onChange={(start, end) => {
                    setVisitDate(start);
                    setEndDate(end);
                  }}
                />
              </div>

              {/* 4. Occasion. */}
              <div className="flex flex-col gap-1.5">
                <Label>Occasion</Label>
                <div className="flex flex-wrap gap-2">
                  {occasions.map((occasion) => {
                    const active = occasion.id === occasionId;
                    return (
                      <button
                        key={occasion.id}
                        type="button"
                        disabled={busy}
                        aria-pressed={active}
                        onClick={() => setOccasionId(active ? null : occasion.id)}
                        style={active && occasion.color ? { borderColor: occasion.color } : undefined}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50",
                          active
                            ? "bg-white/[0.08] text-foreground"
                            : "border-white/10 bg-white/[0.03] text-foreground/60 hover:bg-white/[0.07] hover:text-foreground",
                        )}
                      >
                        <OccasionIcon
                          name={occasion.icon}
                          className="size-3.5"
                          // The seeded colour is the chip's whole identity, so
                          // it stays on the icon even when the chip is off.
                        />
                        {occasion.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 5 and 6. Game fields. */}
              {isGame ? (
                <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  {/* event_org is a TEXT FIELD that the tenant chips fill, not a
                      chips-only value. A venue's tenant list is who plays there
                      normally, which is the wrong question for a visiting team, a
                      neutral-site game, or a college game at a pro venue: Badgers
                      vs Notre Dame at Lambeau has no Packers chip to tap, and
                      event_org would have stayed null while the matchup went into
                      the details. The chips are a shortcut for the common case,
                      never the only way in. */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="place-event-org">Who played</Label>
                    <Input
                      id="place-event-org"
                      value={eventOrg}
                      placeholder="Team, school, or club"
                      disabled={busy}
                      onChange={(e) => setEventOrg(e.target.value)}
                    />
                    {showTenants ? (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {availableTenants.map((tenant) => {
                          // Active on an exact match, so a chip lights up whether
                          // it was tapped or the same name was typed, and stops
                          // looking selected the moment it is edited.
                          const active = tenant === eventOrg.trim();
                          return (
                            <button
                              key={tenant}
                              type="button"
                              disabled={busy}
                              aria-pressed={active}
                              onClick={() => setEventOrg(active ? "" : tenant)}
                              className={cn(
                                "rounded-full border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50",
                                active
                                  ? "border-brand bg-brand/15 text-foreground"
                                  : "border-white/10 bg-white/[0.03] text-foreground/60 hover:bg-white/[0.07] hover:text-foreground",
                              )}
                            >
                              {tenant}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {/* Always visible for a game, tenants or not: a venue with no
                      tenant list still hosted somebody. */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="place-event-detail">Details</Label>
                    <Input
                      id="place-event-detail"
                      value={eventDetail}
                      placeholder="Opponent, score, whatever"
                      disabled={busy}
                      onChange={(e) => setEventDetail(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              {/* 7. How you got there. */}
              <div className="flex flex-col gap-1.5">
                <Label>Getting there</Label>
                <div className="grid grid-cols-4 gap-2">
                  {TRANSPORT_MODES.map((info) => {
                    const active = info.mode === transportMode;
                    return (
                      <button
                        key={info.mode}
                        type="button"
                        disabled={busy}
                        aria-pressed={active}
                        onClick={() => setTransportMode(active ? null : info.mode)}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-[11px] transition-colors disabled:opacity-50",
                          active
                            ? "border-brand bg-brand/15 text-foreground"
                            : "border-white/10 bg-white/[0.03] text-foreground/60 hover:bg-white/[0.07] hover:text-foreground",
                        )}
                      >
                        <TransportModeIcon mode={info.mode} className="size-4" />
                        {info.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 8. Notes. */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="place-notes">Notes</Label>
                <Textarea
                  id="place-notes"
                  value={notes}
                  rows={3}
                  disabled={busy}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="button" className="flex-1" disabled={busy} onClick={handleSave}>
                  {busy ? "Saving" : editingOneVisit ? "Save" : editingExisting ? "Add visit" : "Log it"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
