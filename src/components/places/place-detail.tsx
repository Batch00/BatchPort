"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { PlaceEntrySheet } from "@/components/places/place-entry-sheet";
import { PlaceTypeIcon } from "@/components/places/place-type-icon";
import { TransportModeIcon } from "@/components/transport-mode-icon";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deletePlaceAction, deletePlaceVisitAction } from "@/lib/actions/places";
import { useConnectionGuard } from "@/lib/offline/use-offline";
import { placeTypeLabel } from "@/lib/place-types";
import { transportModeLabel } from "@/lib/transport";
import type { Occasion, PlaceCatalogRef, PlaceVisit, PlaceWithVisits } from "@/lib/types";

// One place, every visit, and the actions on both.
//
// "Add another visit" and "edit visit" are the SAME sheet the log flow uses,
// in its place-prop and visit-prop modes. A second form asking for the same
// seven fields is how the two drift.

function formatDate(iso: string | null): string {
  if (!iso) return "No date";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function visitRange(visit: PlaceVisit): string {
  const start = formatDate(visit.visit_date);
  if (!visit.end_date || visit.end_date === visit.visit_date) return start;
  return `${start} to ${formatDate(visit.end_date)}`;
}

interface PlaceDetailProps {
  place: PlaceWithVisits;
  occasions: Occasion[];
  tenants: string[];
  catalogs: PlaceCatalogRef[];
  /** The signed-in demo account: the place and its visits, and no add, edit,
   * or delete control. The actions refuse the demo account regardless; this
   * only stops offering buttons that cannot work. */
  readOnly?: boolean;
}

export function PlaceDetail({
  place,
  occasions,
  tenants,
  catalogs,
  readOnly = false,
}: PlaceDetailProps) {
  const router = useRouter();
  const guard = useConnectionGuard();

  const [adding, setAdding] = useState(false);
  const [editingVisit, setEditingVisit] = useState<PlaceVisit | null>(null);
  const [confirmDeletePlace, setConfirmDeletePlace] = useState(false);
  // Set when deleting a visit turns out to be deleting the LAST visit: the
  // action refuses by default and hands the decision back rather than silently
  // leaving a place nothing ever happened at.
  const [lastVisitChoice, setLastVisitChoice] = useState<PlaceVisit | null>(null);
  const [busy, setBusy] = useState(false);

  const occasionById = new Map(occasions.map((o) => [o.id, o]));
  const location = [place.locality_name, place.admin_region, place.country_code]
    .filter(Boolean)
    .join(", ");

  // keepPlace = true is the deliberate "leave a place with no visits" choice.
  //
  // Every exit closes the dialog, including the failure ones. The first version
  // only closed on success, so a refused or failed "Keep the place" left the
  // user looking at the same dialog whose primary button deletes the place.
  // That is not a state to leave anybody in next to a destructive default.
  async function removeVisit(visit: PlaceVisit, keepPlace: boolean) {
    if (guard("Deleting a visit")) {
      setLastVisitChoice(null);
      return;
    }
    setBusy(true);
    try {
      const result = await deletePlaceVisitAction(
        visit.id,
        keepPlace ? { keepPlace: true } : undefined,
      );
      if ("error" in result) {
        toast.error(result.error);
        setLastVisitChoice(null);
        return;
      }
      if ("needsChoice" in result) {
        // Only reachable on the first, unqualified attempt.
        setLastVisitChoice(visit);
        return;
      }
      toast.success(keepPlace ? `Visit deleted. ${place.name} kept.` : "Visit deleted.");
      setLastVisitChoice(null);
      router.refresh();
    } catch {
      toast.error("Could not delete that visit.");
      setLastVisitChoice(null);
    } finally {
      setBusy(false);
    }
  }

  async function removePlace() {
    if (guard("Deleting a place")) return;
    setBusy(true);
    try {
      const result = await deletePlaceAction(place.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${place.name} deleted.`);
      router.push("/places");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <Link
        href="/places"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Places
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <PlaceTypeIcon
            type={place.place_type}
            className={`mt-1 size-5 shrink-0 ${place.catalog_item_id ? "text-brand" : "text-muted-foreground"}`}
          />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{place.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[placeTypeLabel(place.place_type), location].filter(Boolean).join(" · ")}
            </p>
            {catalogs.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {catalogs.map((c) => (
                  <span
                    key={c.slug}
                    className="rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[10px] leading-none text-brand"
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {readOnly ? null : (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" />
            Add visit
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {place.visits.length === 0
            ? "Visits"
            : `${place.visits.length} visit${place.visits.length === 1 ? "" : "s"}`}
        </h2>

        {place.visits.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
            No visits logged. This place is kept without one.
          </p>
        ) : (
          place.visits.map((visit) => {
            const occasion = visit.occasion_id ? occasionById.get(visit.occasion_id) : null;
            const facts = [
              occasion?.label,
              visit.event_org,
              visit.event_detail,
            ].filter(Boolean);
            return (
              <div
                key={visit.id}
                className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{visitRange(visit)}</p>
                  {facts.length > 0 ? (
                    <p className="truncate text-xs text-muted-foreground">{facts.join(" · ")}</p>
                  ) : null}
                  {visit.transport_mode ? (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <TransportModeIcon mode={visit.transport_mode} className="size-3.5" />
                      {transportModeLabel(visit.transport_mode)}
                    </p>
                  ) : null}
                  {visit.notes ? (
                    <p className="mt-1 text-xs whitespace-pre-wrap text-foreground/70">{visit.notes}</p>
                  ) : null}
                </div>
                <div className={readOnly ? "hidden" : "flex shrink-0 gap-1"}>
                  <button
                    type="button"
                    aria-label="Edit visit"
                    disabled={busy}
                    onClick={() => setEditingVisit(visit)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground disabled:opacity-50"
                  >
                    <PencilIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete visit"
                    disabled={busy}
                    onClick={() => void removeVisit(visit, false)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {readOnly ? null : (
        <div className="flex justify-end border-t border-white/10 pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmDeletePlace(true)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2Icon className="size-4" />
            Delete place
          </Button>
        </div>
      )}

      {adding ? (
        <PlaceEntrySheet
          open={adding}
          onOpenChange={setAdding}
          occasions={occasions}
          place={place}
          tenants={tenants}
          onSaved={() => router.refresh()}
        />
      ) : null}

      {editingVisit ? (
        <PlaceEntrySheet
          open
          onOpenChange={(next) => {
            if (!next) setEditingVisit(null);
          }}
          occasions={occasions}
          place={place}
          visit={editingVisit}
          tenants={tenants}
          onSaved={() => router.refresh()}
        />
      ) : null}

      {/* Deleting the last visit is a question, not a cascade. */}
      <AlertDialog
        open={lastVisitChoice !== null}
        onOpenChange={(next) => {
          if (!next) setLastVisitChoice(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>That is the only visit</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {place.name} along with it, or keep the place and leave it with no visits
              logged?
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* The SAFE option is the AlertDialogAction, not the destructive one.
              Radix styles Action as the primary and focuses the dialog's
              controls for keyboard use, so making "delete the place" the
              primary put the irreversible choice under the default press,
              beside a secondary that did not even close the dialog. Deleting
              the place is still offered, as a plainly destructive button. */}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setLastVisitChoice(null);
                void removePlace();
              }}
              className="text-destructive hover:text-destructive"
            >
              Delete {place.name} too
            </Button>
            <AlertDialogAction
              disabled={busy}
              onClick={() => lastVisitChoice && void removeVisit(lastVisitChoice, true)}
            >
              Keep the place
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeletePlace} onOpenChange={setConfirmDeletePlace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {place.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {place.visits.length > 0
                ? `This also deletes ${place.visits.length} visit${place.visits.length === 1 ? "" : "s"}. It cannot be undone.`
                : "It cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void removePlace()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
