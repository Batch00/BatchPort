"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  Loader2Icon,
  UploadCloudIcon,
  XCircleIcon,
} from "lucide-react";

import { uploadPhoto } from "@/lib/photos";
import { insertPhotoRecord, setCoverPhoto } from "@/lib/actions/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { PhotoOwnerType } from "@/lib/types";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
const BATCH_SIZE = 4;

type UploadStatus = "pending" | "uploading" | "done" | "error";

interface UploadItem {
  id: number;
  file: File;
  name: string;
  size: number;
  progress: number;
  status: UploadStatus;
}

interface PhotoUploadProps {
  ownerType: PhotoOwnerType;
  ownerId: string;
  userId: string;
  isDemo: boolean;
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

export function PhotoUpload({
  ownerType,
  ownerId,
  userId,
  isDemo,
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

    // Validate and stage all files immediately so sizes are shown before upload.
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

    const staged: UploadItem[] = validFiles.map((file, i) => ({
      id: baseId + i,
      file,
      name: file.name,
      size: file.size,
      progress: 0,
      status: "pending",
    }));
    setItems(staged);

    let lastPhotoId = "";

    // Upload in concurrent batches of BATCH_SIZE.
    for (let i = 0; i < staged.length; i += BATCH_SIZE) {
      const batch = staged.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (item) => {
          updateItem(item.id, { status: "uploading", progress: 15 });
          try {
            const storagePath = await uploadPhoto(
              item.file,
              userId,
              ownerType,
              ownerId,
            );
            updateItem(item.id, { progress: 70 });

            const result = await insertPhotoRecord({
              ownerType,
              ownerId,
              source: "upload",
              storagePath,
            });
            if ("error" in result) {
              updateItem(item.id, { status: "error", progress: 100 });
              toast.error(result.error);
              return;
            }

            if (setCoverOnUpload) {
              await setCoverPhoto(ownerType, ownerId, result.photoId);
            }
            lastPhotoId = result.photoId;
            updateItem(item.id, { status: "done", progress: 100 });
          } catch {
            updateItem(item.id, { status: "error", progress: 100 });
            toast.error(`Could not upload ${item.name}.`);
          }
        }),
      );
    }

    // Single refresh after all uploads complete.
    if (lastPhotoId) {
      onUploaded?.(lastPhotoId);
    }

    setTimeout(() => setItems([]), 1800);
  }

  const doneCount = items.filter((i) => i.status === "done").length;
  const totalCount = items.length;
  const hasActive = items.some(
    (i) => i.status === "uploading" || i.status === "pending",
  );

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
              {doneCount < totalCount
                ? `Uploading ${doneCount} of ${totalCount} ${totalCount === 1 ? "photo" : "photos"}...`
                : `Uploaded ${totalCount} ${totalCount === 1 ? "photo" : "photos"}`}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 text-xs">
                {item.status === "uploading" ? (
                  <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />
                ) : item.status === "pending" ? (
                  <Loader2Icon className="size-3.5 shrink-0 text-foreground/30" />
                ) : item.status === "done" ? (
                  <CheckCircle2Icon className="size-3.5 shrink-0 text-green-500" />
                ) : (
                  <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
                )}
                <span className="min-w-0 flex-1 truncate text-foreground/70">
                  {item.name}
                </span>
                <span className="shrink-0 text-foreground/40">
                  {formatFileSize(item.size)}
                </span>
                {item.status !== "pending" ? (
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
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
