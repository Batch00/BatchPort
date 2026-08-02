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
import { deleteDestinationAction } from "@/lib/actions/destinations";
import { useConnectionGuard } from "@/lib/offline/use-offline";

export function DeleteDestinationButton({
  tripId,
  destinationId,
  destinationName,
}: {
  tripId: string;
  destinationId: string;
  destinationName: string;
}) {
  const [open, setOpen] = useState(false);
  const blockedOffline = useConnectionGuard();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (blockedOffline("Deleting a destination")) return;
    setDeleting(true);
    const result = await deleteDestinationAction(tripId, destinationId);
    // Success redirects back to the trip. Only errors return.
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
          <AlertDialogTitle>Delete this destination?</AlertDialogTitle>
          <AlertDialogDescription>
            {destinationName} and all of its experiences will be permanently
            deleted. This cannot be undone.
          </AlertDialogDescription>
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
