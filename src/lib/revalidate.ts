import { revalidatePath } from "next/cache";

// Purge the client router cache for the whole app after a mutation.
//
// Every page in this app renders dynamically (force-dynamic at the root), so
// there is no server-side page cache to manage. What CAN go stale is the
// client-side router cache: a visited page (dashboard globe, trip detail,
// stats) is reused for up to 30 seconds on back/forward navigation, which is
// exactly the window where a delete or edit appears "not to have saved".
//
// Trips, destinations, experiences, photos, and bucket items all surface on
// several routes at once (dashboard cards and globe, trip and destination
// detail, edit-form cover pickers, stats views, bucket list, share pages), so
// mutations invalidate the root layout rather than maintaining a per-action
// route list that drifts out of date. When a server action calls this, Next
// also re-renders the current route in the same round trip, so the calling
// page updates without a separate refresh.
export function revalidateAppData(): void {
  revalidatePath("/", "layout");
}
