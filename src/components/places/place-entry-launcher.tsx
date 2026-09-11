"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { PlaceEntrySheet } from "@/components/places/place-entry-sheet";
import { Button } from "@/components/ui/button";
import type { Occasion, Place } from "@/lib/types";

// The button that opens the log sheet. Split from the sheet so a server
// component can hand it the occasions without the sheet itself having to be
// mounted (and its whole subtree built) on every render of a page whose sheet
// is shut.

interface PlaceEntryLauncherProps {
  occasions: Occasion[];
  /** Present for "add another visit" on a place detail surface. */
  place?: Place;
  tenants?: string[];
  label?: string;
  variant?: "default" | "outline" | "ghost";
  className?: string;
}

export function PlaceEntryLauncher({
  occasions,
  place,
  tenants,
  label,
  variant = "default",
  className,
}: PlaceEntryLauncherProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button
        type="button"
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" />
        {label ?? (place ? "Add another visit" : "Log a place")}
      </Button>
      {/* Mounted only once opened: Radix builds a dialog's entire subtree in
          one synchronous commit, and this one holds six chip rows. */}
      {open ? (
        <PlaceEntrySheet
          open={open}
          onOpenChange={setOpen}
          occasions={occasions}
          place={place}
          tenants={tenants}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
