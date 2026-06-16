"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon, UploadCloudIcon } from "lucide-react";

import { uploadPhoto } from "@/lib/photos";
import { insertPhotoRecord, setCoverPhoto } from "@/lib/actions/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { PhotoOwnerType } from "@/lib/types";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

interface UploadItem {
  id: number;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
}

interface PhotoUploadProps {
  ownerType: PhotoOwnerType;
  ownerId: string;
  userId: string;
  isDemo: boolean;
  // Called after each successful upload so the parent can refresh its data.
  onUploaded?: (photoId: string) => void;
  // When true, each uploaded photo is also set as the owner's cover.
  setCoverOnUpload?: boolean;
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

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }

    const files = Array.from(fileList);
    for (const file of files) {
      if (!ACCEPTED.includes(file.type)) {
        toast.error(`${file.name} is not a supported image (jpg, png, webp).`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is larger than 10MB.`);
        continue;
      }

      const id = nextId.current++;
      setItems((prev) => [
        ...prev,
        { id, name: file.name, progress: 15, status: "uploading" },
      ]);
      const update = (patch: Partial<UploadItem>) =>
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        );

      try {
        const storagePath = await uploadPhoto(file, userId, ownerType, ownerId);
        update({ progress: 70 });

        const result = await insertPhotoRecord({
          ownerType,
          ownerId,
          source: "upload",
          storagePath,
        });
        if ("error" in result) {
          update({ status: "error", progress: 100 });
          toast.error(result.error);
          continue;
        }

        if (setCoverOnUpload) {
          await setCoverPhoto(ownerType, ownerId, result.photoId);
        }
        update({ status: "done", progress: 100 });
        onUploaded?.(result.photoId);
      } catch {
        update({ status: "error", progress: 100 });
        toast.error(`Could not upload ${file.name}.`);
      }
    }

    // Clear the finished list shortly after so the dropzone returns to rest.
    setTimeout(() => setItems([]), 1200);
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
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 text-xs">
              {item.status === "uploading" ? (
                <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-foreground/70">
                {item.name}
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    item.status === "error" ? "bg-destructive" : "bg-brand",
                  )}
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
