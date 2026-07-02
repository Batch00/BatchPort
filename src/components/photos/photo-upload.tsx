"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CircleIcon,
  CopyCheckIcon,
  Loader2Icon,
  MapPinIcon,
  UploadCloudIcon,
  XCircleIcon,
} from "lucide-react";

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
const MAX_BYTES = 10 * 1024 * 1024;
// How many files run the full pipeline (read, resize, upload) concurrently.
const CONCURRENCY = 4;

type UploadStatus =
  | "queued"
  | "reading"
  | "resizing"
  | "uploading"
  | "duplicate"
  | "done"
  | "error";

interface UploadItem {
  id: number;
  file: File;
  name: string;
  size: number;
  progress: number;
  status: UploadStatus;
  // EXIF-derived auto-tag (only applied when no bulk default is set)
  autoTagDestId: string | null;
  autoTagDestName: string | null;
}

export interface ExifDestination {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

interface PhotoUploadProps {
  ownerType: PhotoOwnerType;
  ownerId: string;
  userId: string;
  isDemo: boolean;
  // Optional bulk-tag override: pre-selects the owner for all photos in the batch.
  defaultOwnerType?: PhotoOwnerType;
  defaultOwnerId?: string;
  // Trip destinations provided for EXIF GPS auto-tagging.
  destinations?: ExifDestination[];
  // Called once after all uploads finish so the parent can refresh its data.
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

export function PhotoUpload({
  ownerType,
  ownerId,
  userId,
  isDemo,
  defaultOwnerType,
  defaultOwnerId,
  destinations,
  onUploaded,
  setCoverOnUpload = false,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);

  function updateItem(id: number, patch: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }

    const validFiles: File[] = [];
    for (const file of Array.from(fileList)) {
      if (!ACCEPTED.includes(file.type)) {
        toast.error(`${file.name} is not a supported image (jpg, png, webp).`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is larger than 10MB.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    const baseId = nextId.current;
    nextId.current += validFiles.length;

    // Every file appears in the list immediately; each one's status advances
    // independently as its pipeline (read, resize, upload) progresses.
    const staged: UploadItem[] = validFiles.map((file, i) => ({
      id: baseId + i,
      file,
      name: file.name,
      size: file.size,
      progress: 0,
      status: "queued",
      autoTagDestId: null,
      autoTagDestName: null,
    }));
    setItems(staged);

    const shouldAutoTag =
      !defaultOwnerType &&
      !defaultOwnerId &&
      destinations &&
      destinations.length > 0;

    // Fingerprints already claimed in this batch, keyed by owner, so selecting
    // the same file twice in one batch is caught without a round-trip.
    const batchFingerprints = new Set<string>();
    let lastPhotoId = "";
    let duplicateCount = 0;
    let errorCount = 0;

    async function processFile(item: UploadItem): Promise<void> {
      try {
        // Read the file once: the buffer feeds both the EXIF parse and the
        // content fingerprint (crypto.subtle hashes off the main thread).
        updateItem(item.id, { status: "reading", progress: 8 });
        const buffer = await item.file.arrayBuffer();
        const fingerprintPromise = computeFingerprint(buffer);
        const exif = extractExifFromBuffer(buffer);

        let autoTagDestId: string | null = null;
        let autoTagDestName: string | null = null;
        if (
          shouldAutoTag &&
          exif.gpsLat !== null &&
          exif.gpsLng !== null &&
          destinations
        ) {
          const nearest = findNearestDestination(
            exif.gpsLat,
            exif.gpsLng,
            destinations,
          );
          if (nearest) {
            autoTagDestId = nearest.id;
            autoTagDestName = nearest.name;
          }
        }
        updateItem(item.id, { autoTagDestId, autoTagDestName });

        // Resolve effective owner: bulk default > EXIF auto-tag > base owner.
        let effectiveOwnerType: PhotoOwnerType = ownerType;
        let effectiveOwnerId: string = ownerId;
        if (defaultOwnerType && defaultOwnerId) {
          effectiveOwnerType = defaultOwnerType;
          effectiveOwnerId = defaultOwnerId;
        } else if (autoTagDestId) {
          effectiveOwnerType = "destination";
          effectiveOwnerId = autoTagDestId;
        }

        // Duplicate check: same content already uploaded to the same owner,
        // either earlier in this batch or in a previous session.
        const fingerprint = await fingerprintPromise;
        const batchKey = `${effectiveOwnerType}:${effectiveOwnerId}:${fingerprint}`;
        if (
          batchFingerprints.has(batchKey) ||
          (await isDuplicatePhoto(
            effectiveOwnerType,
            effectiveOwnerId,
            fingerprint,
          ))
        ) {
          duplicateCount += 1;
          updateItem(item.id, { status: "duplicate", progress: 100 });
          return;
        }
        batchFingerprints.add(batchKey);

        updateItem(item.id, { status: "resizing", progress: 30 });
        const resized = await resizeImage(item.file);

        updateItem(item.id, { status: "uploading", progress: 55 });
        const storagePath = await uploadPhotoBlob(
          resized,
          item.file.name,
          userId,
          effectiveOwnerType,
          effectiveOwnerId,
        );
        updateItem(item.id, { progress: 80 });

        const result = await insertPhotoRecord({
          ownerType: effectiveOwnerType,
          ownerId: effectiveOwnerId,
          source: "upload",
          storagePath,
          dateTaken: exif.dateTaken ?? undefined,
          fingerprint,
        });
        if ("error" in result) {
          errorCount += 1;
          updateItem(item.id, { status: "error", progress: 100 });
          toast.error(result.error);
          return;
        }

        if (setCoverOnUpload) {
          await setCoverPhoto(
            effectiveOwnerType,
            effectiveOwnerId,
            result.photoId,
          );
        }
        lastPhotoId = result.photoId;
        updateItem(item.id, { status: "done", progress: 100 });
      } catch {
        errorCount += 1;
        updateItem(item.id, { status: "error", progress: 100 });
        toast.error(`Could not upload ${item.name}.`);
      }
    }

    await runWithConcurrency(staged, CONCURRENCY, processFile);

    if (lastPhotoId) {
      onUploaded?.(lastPhotoId);
    }
    if (duplicateCount > 0) {
      toast.info(
        `${duplicateCount} ${duplicateCount === 1 ? "photo was" : "photos were"} already uploaded and skipped.`,
      );
    }

    // Clear the list only when everything succeeded; keep it visible when
    // there are duplicates or errors so their per-file labels can be read.
    if (duplicateCount === 0 && errorCount === 0) {
      setTimeout(() => setItems([]), 1800);
    }
  }

  const settledCount = items.filter(
    (i) => i.status === "done" || i.status === "duplicate" || i.status === "error",
  ).length;
  const totalCount = items.length;
  const hasActive = items.some(
    (i) =>
      i.status === "queued" ||
      i.status === "reading" ||
      i.status === "resizing" ||
      i.status === "uploading",
  );

  function statusIcon(status: UploadStatus) {
    switch (status) {
      case "queued":
        return <CircleIcon className="size-3.5 shrink-0 text-foreground/25" />;
      case "reading":
      case "resizing":
      case "uploading":
        return (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />
        );
      case "duplicate":
        return <CopyCheckIcon className="size-3.5 shrink-0 text-amber-500" />;
      case "done":
        return <CheckCircle2Icon className="size-3.5 shrink-0 text-green-500" />;
      case "error":
        return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />;
    }
  }

  function statusLabel(status: UploadStatus): string | null {
    switch (status) {
      case "reading":
        return "Reading";
      case "resizing":
        return "Resizing";
      case "uploading":
        return "Uploading";
      case "duplicate":
        return "Already uploaded";
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
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
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center text-sm transition-colors",
          dragging
            ? "border-brand bg-brand/10 text-foreground"
            : "border-white/15 text-foreground/60 hover:border-white/30 hover:text-foreground/80",
        )}
      >
        <UploadCloudIcon className="size-6 text-brand" />
        <span>Drop photos here or click to browse</span>
        <span className="text-xs text-foreground/40">
          jpg, png or webp, up to 10MB each
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
        <div className="flex flex-col gap-2">
          {hasActive ? (
            <p className="text-xs text-foreground/60">
              {settledCount < totalCount
                ? `Processing ${settledCount} of ${totalCount} ${totalCount === 1 ? "photo" : "photos"}...`
                : `Processed ${totalCount} ${totalCount === 1 ? "photo" : "photos"}`}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const label = statusLabel(item.status);
              return (
                <li key={item.id} className="flex items-center gap-3 text-xs">
                  {statusIcon(item.status)}
                  <span className="min-w-0 flex-1 truncate text-foreground/70">
                    {item.name}
                  </span>
                  {item.autoTagDestName ? (
                    <span className="flex shrink-0 items-center gap-1 text-[0.65rem] text-brand">
                      <MapPinIcon className="size-3" />
                      {item.autoTagDestName}
                    </span>
                  ) : null}
                  {label ? (
                    <span
                      className={cn(
                        "shrink-0 text-[0.65rem]",
                        item.status === "duplicate"
                          ? "text-amber-500"
                          : "text-foreground/50",
                      )}
                    >
                      {label}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-foreground/40">
                    {formatFileSize(item.size)}
                  </span>
                  {item.status !== "queued" && item.status !== "duplicate" ? (
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          item.status === "error"
                            ? "bg-destructive"
                            : "bg-brand",
                        )}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
