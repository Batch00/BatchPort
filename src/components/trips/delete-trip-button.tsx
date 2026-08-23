"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon, Trash2Icon } from "lucide-react";

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteTripAction } from "@/lib/actions/trips";
import { useConnectionGuard } from "@/lib/offline/use-offline";

export function DeleteTripButton({
  tripId,
  tripName,
  expenseCount = null,
}: {
  tripId: string;
  tripName: string;
  /** Hand-entered transactions this delete would cascade away. Null means the
   * expenses table could not be read (the migration has not run, or the query
   * failed), in which case the dialog says nothing about spending rather than
   * reassuring somebody there is none. */
  expenseCount?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const blockedOffline = useConnectionGuard();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (blockedOffline("Deleting a trip")) return;
    setDeleting(true);
    const result = await deleteTripAction(tripId);
    // A successful delete redirects to /dashboard. Only errors return.
    if (result && "error" in result) {
      toast.error(result.error);
      setDeleting(false);
      setOpen(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="lg">
          <Trash2Icon />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this trip?</AlertDialogTitle>
          <AlertDialogDescription>
            {tripName} and all of its destinations and experiences will be
            permanently deleted. This cannot be undone.
          </AlertDialogDescription>
          {/* Named separately and last, because it is the part that cannot be
              reconstructed. A stop can be re-added from memory; a ledger of
              hand-entered transactions cannot. */}
          {expenseCount !== null && expenseCount > 0 ? (
            <AlertDialogDescription className="font-medium text-destructive">
              This includes {expenseCount} logged{" "}
              {expenseCount === 1 ? "expense" : "expenses"}, which cannot be
              recovered.
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault();
              handleDelete();
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deleting ? <Loader2Icon className="size-4 animate-spin" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
