"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CopyCheckIcon,
  Loader2Icon,
  MapPinIcon,
  MapPinOffIcon,
  UploadCloudIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  computeFingerprint,
  isDuplicatePhoto,
  resizeImage,
  uploadPhotoBlob,
} from "@/lib/photos";
import { insertPhotoRecord, setCoverPhoto } from "@/lib/actions/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { cn } from "@/lib/utils";
import { extractExifFromBuffer, findNearestDestination } from "@/lib/utils/exif";
import type { PhotoOwnerType } from "@/lib/types";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
// Files over this size get a "Resized from X to Y" note in the review list so
// the user knows the app handled them. There is no hard rejection limit: every
// photo runs through the canvas resize before upload.
const RESIZE_NOTE_BYTES = 4 * 1024 * 1024;
// If a photo is somehow still this large after the resize, warn but allow it.
const LARGE_AFTER_RESIZE_BYTES = 10 * 1024 * 1024;
// How many files run each pipeline (staging or upload) concurrently.
const CONCURRENCY = 4;

// Sentinel values for the tag selects.
const UNTAGGED = "__untagged__";
const WHOLE_DESTINATION = "__whole__";

// A destination offered in the review tag dropdowns, with coordinates for
// EXIF GPS auto-matching and its experiences for the second-level dropdown.
export interface TagDestination {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  experiences: { id: string; name: string }[];
}

type StageStatus = "processing" | "ready" | "error";
type CommitStatus = "idle" | "uploading" | "done" | "error";

interface StagedPhoto {
  id: number;
  file: File;
  name: string;
  size: number;
  // Object URL of the original file, used for the review thumbnail.
  previewUrl: string;
  stage: StageStatus;
  stageError: string | null;
  // Resized output, held in memory until the user confirms the batch.
  blob: Blob | null;
  // Size of the resized output, for the "Resized from X to Y" review note.
  resizedSize: number | null;
  fingerprint: string | null;
  dateTaken: string | null;
  hasGps: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
  // Same content already uploaded to the resolved owner. Excluded by default,
  // but the user can override and include it anyway.
  duplicate: boolean;
  included: boolean;
  // The destination tag came from a GPS match rather than a manual pick.
  autoTagged: boolean;
  // Reverse-geocoded place name when GPS matched no trip destination.
  placeName: string | null;
  destId: string;
  expId: string;
  commit: CommitStatus;
  progress: number;
}

interface PhotoUploadProps {
  // The owner photos fall back to when no tag is chosen in review.
  ownerType: PhotoOwnerType;
  ownerId: string;
  userId: string;
  isDemo: boolean;
  // When provided, the review step offers per-photo destination/experience
  // tagging and GPS auto-matching against these destinations.
  tagDestinations?: TagDestination[];
  // Called once after the batch commits so the parent can refresh its data.
  onUploaded?: (photoId: string) => void;
  // When true, each uploaded photo is also set as the owner's cover.
  setCoverOnUpload?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Give the browser a chance to paint and handle input between files, so a
// large batch never locks the main thread.
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Run a worker over each item with a fixed concurrency limit. Unlike chunked
// Promise.all batches, a slow file never stalls the other lanes.
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await yieldToBrowser();
        await worker(item);
      }
    },
  );
  await Promise.all(lanes);
}

// Resolve GPS coordinates to a readable place name via the app's reverse
// geocoding proxy (Nominatim behind geocode_cache).
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const response = await fetch(`/api/geocode/lookup?lat=${lat}&lng=${lng}`);
    if (!response.ok) return null;
    const data = (await response.json()) as {
      name?: string | null;
      country?: string | null;
    };
    if (!data.name) return null;
    return data.country ? `${data.name}, ${data.country}` : data.name;
  } catch {
    return null;
  }
}

export function PhotoUpload({
  ownerType,
  ownerId,
  userId,
  isDemo,
  tagDestinations,
  onUploaded,
  setCoverOnUpload = false,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<StagedPhoto[]>([]);
  const [committing, setCommitting] = useState(false);

  const canTag = Boolean(tagDestinations && tagDestinations.length > 0);
  const destinations = tagDestinations ?? [];

  // Latest items, readable from async pipelines without stale closures.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Revoke all preview object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  function updateItem(id: number, patch: Partial<StagedPhoto>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  // The default destination tag: at the destination-level entry point the base
  // owner is itself one of the taggable destinations, so pre-select it.
  const defaultDestId =
    ownerType === "destination" &&
    destinations.some((destination) => destination.id === ownerId)
      ? ownerId
      : UNTAGGED;

  function resolveOwner(
    destId: string,
    expId: string,
  ): { type: PhotoOwnerType; id: string } {
    if (canTag && destId !== UNTAGGED) {
      if (expId !== WHOLE_DESTINATION) return { type: "experience", id: expId };
      return { type: "destination", id: destId };
    }
    return { type: ownerType, id: ownerId };
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    if (committing) return;

    const validFiles: File[] = [];
    for (const file of Array.from(fileList)) {
      if (!ACCEPTED.includes(file.type)) {
        toast.error(`${file.name} is not a supported image (jpg, png, webp).`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    const baseId = nextId.current;
    nextId.current += validFiles.length;

    const staged: StagedPhoto[] = validFiles.map((file, i) => ({
      id: baseId + i,
      file,
      name: file.name,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
      stage: "processing",
      stageError: null,
      blob: null,
      resizedSize: null,
      fingerprint: null,
      dateTaken: null,
      hasGps: false,
      gpsLat: null,
      gpsLng: null,
      duplicate: false,
      included: false,
      autoTagged: false,
      placeName: null,
      destId: defaultDestId,
      expId: WHOLE_DESTINATION,
      commit: "idle",
      progress: 0,
    }));
    // Append, so the user can add more files while reviewing a batch.
    setItems((prev) => [...prev, ...staged]);

    // Fingerprints already staged in this selection, so picking the same file
    // twice is caught without a round-trip.
    const batchFingerprints = new Set(
      itemsRef.current
        .map((item) => item.fingerprint)
        .filter((fp): fp is string => fp !== null),
    );

    async function stageFile(item: StagedPhoto): Promise<void> {
      try {
        // Read the file once: the buffer feeds both the EXIF parse and the
        // content fingerprint (crypto.subtle hashes off the main thread).
        const buffer = await item.file.arrayBuffer();
        const fingerprintPromise = computeFingerprint(buffer);
        const exif = await extractExifFromBuffer(buffer);
        const hasGps = exif.gpsLat !== null && exif.gpsLng !== null;

        let destId = item.destId;
        let autoTagged = false;
        let placeName: string | null = null;
        if (canTag && hasGps && exif.gpsLat !== null && exif.gpsLng !== null) {
          const nearest = findNearestDestination(
            exif.gpsLat,
            exif.gpsLng,
            destinations,
          );
          if (nearest) {
            destId = nearest.id;
            autoTagged = true;
          } else {
            placeName = await reverseGeocode(exif.gpsLat, exif.gpsLng);
          }
        }

        // Duplicate check against the owner the photo would commit to now.
        // Changing the tag in review re-runs this check for the new owner.
        const fingerprint = await fingerprintPromise;
        const owner = resolveOwner(destId, WHOLE_DESTINATION);
        const duplicate =
          batchFingerprints.has(fingerprint) ||
          (await isDuplicatePhoto(owner.type, owner.id, fingerprint));
        batchFingerprints.add(fingerprint);

        // The resize always runs, so oversized phone photos are shrunk rather
        // than rejected.
        const blob = await resizeImage(item.file);
        if (blob.size > LARGE_AFTER_RESIZE_BYTES) {
          toast.warning(
            `${item.name} is still ${formatFileSize(blob.size)} after resizing. It will upload, but may be slow.`,
          );
        }

        updateItem(item.id, {
          stage: "ready",
          blob,
          resizedSize: blob.size,
          fingerprint,
          dateTaken: exif.dateTaken,
          hasGps,
          gpsLat: exif.gpsLat,
          gpsLng: exif.gpsLng,
          destId,
          autoTagged,
          placeName,
          duplicate,
          included: !duplicate,
        });
      } catch {
        updateItem(item.id, {
          stage: "error",
          stageError: "Could not read this file.",
          included: false,
        });
      }
    }

    await runWithConcurrency(staged, CONCURRENCY, stageFile);
  }

  // Re-run the owner-scoped duplicate check after a tag change, then reset the
  // include flag to match (an override only holds until the tag changes again).
  async function recheckDuplicate(
    id: number,
    fingerprint: string | null,
    destId: string,
    expId: string,
  ) {
    if (!fingerprint) return;
    const owner = resolveOwner(destId, expId);
    const duplicate = await isDuplicatePhoto(owner.type, owner.id, fingerprint);
    setItems((prev) =>
      prev.map((item) =>
        item.id === id && item.stage === "ready"
          ? { ...item, duplicate, included: !duplicate }
          : item,
      ),
    );
  }

  function setItemDest(item: StagedPhoto, destId: string) {
    updateItem(item.id, { destId, expId: WHOLE_DESTINATION, autoTagged: false });
    void recheckDuplicate(item.id, item.fingerprint, destId, WHOLE_DESTINATION);
  }

  function setItemExp(item: StagedPhoto, expId: string) {
    updateItem(item.id, { expId });
    void recheckDuplicate(item.id, item.fingerprint, item.destId, expId);
  }

  // Only ready items take the bulk tag: rows still processing would have the
  // value overwritten when their staging pipeline finishes.
  function applyTagToAll(destId: string) {
    for (const item of itemsRef.current) {
      if (item.stage !== "ready") continue;
      updateItem(item.id, {
        destId,
        expId: WHOLE_DESTINATION,
        autoTagged: false,
      });
      void recheckDuplicate(item.id, item.fingerprint, destId, WHOLE_DESTINATION);
    }
  }

  function removeItem(item: StagedPhoto) {
    URL.revokeObjectURL(item.previewUrl);
    setItems((prev) => prev.filter((other) => other.id !== item.id));
  }

  function clearAll() {
    for (const item of itemsRef.current) {
      URL.revokeObjectURL(item.previewUrl);
    }
    setItems([]);
  }

  async function handleCommit() {
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    const batch = items.filter(
      (item) => item.included && item.stage === "ready" && item.blob !== null,
    );
    if (batch.length === 0) return;

    setCommitting(true);
    let lastPhotoId = "";
    let errorCount = 0;

    await runWithConcurrency(batch, CONCURRENCY, async (item) => {
      const blob = item.blob;
      if (!blob) return;
      try {
        updateItem(item.id, { commit: "uploading", progress: 15 });
        const owner = resolveOwner(item.destId, item.expId);
        const storagePath = await uploadPhotoBlob(
          blob,
          item.name,
          userId,
          owner.type,
          owner.id,
        );
        updateItem(item.id, { progress: 65 });

        const result = await insertPhotoRecord({
          ownerType: owner.type,
          ownerId: owner.id,
          source: "upload",
          storagePath,
          dateTaken: item.dateTaken ?? undefined,
          gpsLat: item.gpsLat,
          gpsLng: item.gpsLng,
          fingerprint: item.fingerprint,
        });
        if ("error" in result) {
          errorCount += 1;
          updateItem(item.id, { commit: "error", progress: 100 });
          toast.error(result.error);
          return;
        }

        if (setCoverOnUpload) {
          await setCoverPhoto(owner.type, owner.id, result.photoId);
        }
        lastPhotoId = result.photoId;
        updateItem(item.id, { commit: "done", progress: 100 });
      } catch {
        errorCount += 1;
        updateItem(item.id, { commit: "error", progress: 100 });
        toast.error(`Could not upload ${item.name}.`);
      }
    });

    setCommitting(false);
    if (lastPhotoId) {
      onUploaded?.(lastPhotoId);
    }
    if (errorCount === 0) {
      toast.success(
        `${batch.length} ${batch.length === 1 ? "photo" : "photos"} uploaded.`,
      );
      clearAll();
    } else {
      // Keep the failed rows visible for another attempt; drop the rest.
      setItems((prev) =>
        prev.filter((item) => {
          const keep = item.commit !== "done";
          if (!keep) URL.revokeObjectURL(item.previewUrl);
          return keep;
        }),
      );
    }
  }

  const processingCount = items.filter(
    (item) => item.stage === "processing",
  ).length;
  const includedCount = items.filter(
    (item) => item.included && item.stage === "ready",
  ).length;
  const excludedDuplicates = items.filter(
    (item) => item.duplicate && !item.included,
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={committing}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center text-sm transition-colors disabled:opacity-50",
          dragging
            ? "border-brand bg-brand/10 text-foreground"
            : "border-white/15 text-foreground/60 hover:border-white/30 hover:text-foreground/80",
        )}
      >
        <UploadCloudIcon className="size-6 text-brand" />
        <span>Drop photos here or click to browse</span>
        <span className="text-xs text-foreground/40">
          jpg, png or webp. Large photos are resized automatically. Nothing
          uploads until you confirm.
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {items.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl bg-white/[0.02] p-3 ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground/70">
              {processingCount > 0
                ? `Preparing ${processingCount} of ${items.length}...`
                : `Review ${items.length} ${items.length === 1 ? "photo" : "photos"} before uploading`}
            </p>
            {canTag && items.length > 1 ? (
              <TagAllSelect
                ownerType={ownerType}
                destinations={destinations}
                disabled={committing}
                onApply={applyTagToAll}
              />
            ) : null}
          </div>

          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <StagedPhotoRow
                key={item.id}
                item={item}
                canTag={canTag}
                ownerType={ownerType}
                destinations={destinations}
                committing={committing}
                onDestChange={(destId) => setItemDest(item, destId)}
                onExpChange={(expId) => setItemExp(item, expId)}
                onIncludeChange={(included) =>
                  updateItem(item.id, { included })
                }
                onRemove={() => removeItem(item)}
              />
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3">
            <p className="text-xs text-foreground/50">
              {excludedDuplicates > 0
                ? `${excludedDuplicates} ${excludedDuplicates === 1 ? "duplicate" : "duplicates"} excluded`
                : " "}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearAll}
                disabled={committing}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleCommit}
                disabled={
                  committing || processingCount > 0 || includedCount === 0
                }
                className="bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {committing ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  `Upload ${includedCount} ${includedCount === 1 ? "photo" : "photos"}`
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TagAllSelect({
  ownerType,
  destinations,
  disabled,
  onApply,
}: {
  ownerType: PhotoOwnerType;
  destinations: TagDestination[];
  disabled: boolean;
  onApply: (destId: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        setValue(next);
        onApply(next);
      }}
    >
      <SelectTrigger
        className="h-7 w-44 text-xs"
        aria-label="Tag all photos to"
      >
        <SelectValue placeholder="Tag all to..." />
      </SelectTrigger>
      <SelectContent>
        {ownerType === "trip" ? (
          <SelectItem value={UNTAGGED}>Untagged (trip level)</SelectItem>
        ) : null}
        {destinations.map((destination) => (
          <SelectItem key={destination.id} value={destination.id}>
            {destination.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StagedPhotoRow({
  item,
  canTag,
  ownerType,
  destinations,
  committing,
  onDestChange,
  onExpChange,
  onIncludeChange,
  onRemove,
}: {
  item: StagedPhoto;
  canTag: boolean;
  ownerType: PhotoOwnerType;
  destinations: TagDestination[];
  committing: boolean;
  onDestChange: (destId: string) => void;
  onExpChange: (expId: string) => void;
  onIncludeChange: (included: boolean) => void;
  onRemove: () => void;
}) {
  const destination =
    destinations.find((candidate) => candidate.id === item.destId) ?? null;
  const dimmed =
    item.stage === "error" || (item.stage === "ready" && !item.included);

  return (
    <li className="flex gap-3 rounded-lg bg-white/[0.02] p-2.5 ring-1 ring-foreground/10">
      <div
        className={cn(
          "relative size-16 shrink-0 overflow-hidden rounded-md bg-white/5",
          dimmed && "opacity-40",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.previewUrl}
          alt=""
          className="size-full object-cover"
        />
        {item.stage === "processing" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2Icon className="size-4 animate-spin text-brand" />
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/70">
            {item.name}
          </span>
          <span className="shrink-0 text-[0.65rem] text-foreground/40">
            {formatFileSize(item.size)}
          </span>
          {item.commit === "done" ? (
            <CheckCircle2Icon className="size-3.5 shrink-0 text-green-500" />
          ) : item.commit === "error" ? (
            <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
          ) : null}
          {!committing ? (
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              onClick={onRemove}
              className="-my-1 flex size-7 shrink-0 items-center justify-center rounded text-foreground/40 transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>

        {item.stage === "error" ? (
          <p className="text-[0.7rem] text-destructive">{item.stageError}</p>
        ) : null}

        {item.stage === "ready" &&
        item.size > RESIZE_NOTE_BYTES &&
        item.resizedSize !== null &&
        item.resizedSize < item.size ? (
          <p className="text-[0.7rem] text-foreground/40">
            Resized from {formatFileSize(item.size)} to{" "}
            {formatFileSize(item.resizedSize)}
          </p>
        ) : null}

        {item.duplicate ? (
          <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-amber-500">
            <span className="flex items-center gap-1">
              <CopyCheckIcon className="size-3" />
              Already uploaded
            </span>
            <label className="flex cursor-pointer items-center gap-1 text-foreground/60 hover:text-foreground/80">
              <input
                type="checkbox"
                checked={item.included}
                disabled={committing}
                onChange={(event) => onIncludeChange(event.target.checked)}
                className="size-3 accent-brand"
              />
              Include anyway
            </label>
          </div>
        ) : null}

        {item.stage === "ready" && canTag ? (
          <>
            {item.autoTagged && destination ? (
              <p className="flex items-center gap-1 text-[0.7rem] text-brand">
                <MapPinIcon className="size-3" />
                Auto-tagged from photo location
              </p>
            ) : null}
            {!item.autoTagged && item.hasGps && item.destId === UNTAGGED ? (
              <p className="flex items-center gap-1 text-[0.7rem] text-amber-500/90">
                <MapPinOffIcon className="size-3 shrink-0" />
                <span>
                  {item.placeName
                    ? `Taken near ${item.placeName}, which is not in your trip yet.`
                    : item.gpsLat !== null && item.gpsLng !== null
                      ? `Taken at ${item.gpsLat.toFixed(3)}, ${item.gpsLng.toFixed(3)}, which is not in your trip yet.`
                      : "Taken somewhere not in your trip yet."}{" "}
                  No matching destination, tag manually.
                </span>
              </p>
            ) : null}

            <div className="flex flex-col gap-1.5 sm:flex-row">
              <Select
                value={item.destId}
                disabled={committing}
                onValueChange={onDestChange}
              >
                <SelectTrigger
                  className="h-7 text-xs sm:w-48"
                  aria-label="Destination tag"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ownerType === "trip" ? (
                    <SelectItem value={UNTAGGED}>
                      Untagged (trip level)
                    </SelectItem>
                  ) : null}
                  {destinations.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {destination && destination.experiences.length > 0 ? (
                <Select
                  value={item.expId}
                  disabled={committing}
                  onValueChange={onExpChange}
                >
                  <SelectTrigger
                    className="h-7 text-xs sm:w-48"
                    aria-label="Experience tag"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WHOLE_DESTINATION}>
                      Whole destination
                    </SelectItem>
                    {destination.experiences.map((experience) => (
                      <SelectItem key={experience.id} value={experience.id}>
                        {experience.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </>
        ) : null}

        {item.commit !== "idle" && item.commit !== "done" ? (
          <div className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                item.commit === "error" ? "bg-destructive" : "bg-brand",
              )}
              style={{ width: `${item.progress}%` }}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}
