"use client";

// Street-level modes borrow a detailed basemap for as long as they run.
//
// The dark minimal style is the brand default and has no detail past country
// shapes: maxZoomForBasemap caps it at zoom 10, which is the exact zoom the
// attractions layer switches on at and well short of the 13 nearby flies to.
// Standing on a street corner looking at an empty dark sphere is not a design
// choice, it is the basemap being asked a question it cannot answer.
//
// So nearby and the attractions layer borrow the streets style on the way in
// and hand it back on the way out. Both get the same treatment for the same
// reason: neither has anything to show at the zoom the dark style stops at.
//
// Three rules keep the borrowing honest:
//
//   - It is a LOAN, not a preference. Nothing is written to sessionStorage by
//     this module; the restore puts back whatever the user had.
//   - A MANUAL CHANGE WINS. If the user picks a basemap while a mode is
//     running, the restore is abandoned: we only ever undo the switch we made,
//     never a choice somebody made on purpose.
//   - It is REFERENCE COUNTED. Nearby switches the attractions layer on, so
//     both modes hold the loan at once, and it is returned when the last one
//     lets go. A user who already had attractions on before entering nearby
//     keeps the detailed map when nearby exits, which is right: their layer is
//     still running.
//
// With no MapTiler key configured there is nothing to borrow, every call is a
// no-op, and the modes run on dark exactly as they did before.

import { useRef } from "react";

import { detailBasemapId } from "./basemaps";

/** Who is holding the loan. A string per mode, so the count cannot drift from
 * double enter or double exit calls. */
export type DetailBasemapOwner = "nearby" | "attractions";

export interface DetailBasemapHandle {
  /** Borrow the detailed style for this owner. Idempotent per owner. */
  request: (owner: DetailBasemapOwner) => void;
  /** Give it back. Restores the previous style when the last owner releases. */
  release: (owner: DetailBasemapOwner) => void;
}

export function useDetailBasemap({
  basemapRef,
  applyBasemap,
}: {
  /** The live basemap id, mirrored by the host so this reads it without a
   * re-render. */
  basemapRef: React.RefObject<string>;
  applyBasemap: (id: string) => void;
}): DetailBasemapHandle {
  const owners = useRef(new Set<DetailBasemapOwner>());
  /** The style to put back, or null when there is nothing to undo. */
  const restoreTo = useRef<string | null>(null);
  /** The style we actually switched to, so a manual change is detectable. */
  const applied = useRef<string | null>(null);

  function request(owner: DetailBasemapOwner) {
    const detail = detailBasemapId();
    if (!detail) return;
    const first = owners.current.size === 0;
    owners.current.add(owner);
    if (!first) return;
    const current = basemapRef.current;
    // Already on a detailed style (streets, satellite, terrain): leave it be.
    // Only the dark default is unable to answer the question.
    if (current !== "dark") {
      restoreTo.current = null;
      applied.current = null;
      return;
    }
    restoreTo.current = current;
    applied.current = detail;
    applyBasemap(detail);
  }

  function release(owner: DetailBasemapOwner) {
    if (!owners.current.delete(owner)) return;
    if (owners.current.size > 0) return;
    const target = restoreTo.current;
    const set = applied.current;
    restoreTo.current = null;
    applied.current = null;
    if (target === null || set === null) return;
    // The user changed the basemap while the mode was running. Their choice
    // stands; there is nothing of ours left to undo.
    if (basemapRef.current !== set) return;
    applyBasemap(target);
  }

  return { request, release };
}
