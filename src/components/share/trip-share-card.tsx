"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, Loader2Icon, Share2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  canShareFiles,
  downloadBlob,
  filenameSlug,
  shareImage,
} from "@/lib/poster/canvas";
import {
  drawShareCardPreview,
  loadShareCardAssets,
  renderShareCard,
  shareCardFromStoryTrip,
  shareCardRatio,
  SHARE_CARD_RATIOS,
  type ShareCardAssets,
  type ShareCardRatio,
} from "@/lib/poster/share-card";
import type { StoryTrip } from "@/lib/story";

// The per-trip share card.
//
// Everything it draws comes from the StoryTrip the surface already built, so
// the trip page, /demo, and /share/[slug] all get it with no extra query and
// no extra plumbing. It is generative and read-only, which is why the public
// surfaces offer it too.

// The preview renders at a quarter of the export's pixels: enough to judge the
// composition, fast enough to redraw as the ratio changes.
const PREVIEW_SCALE = 0.25;

export function TripShareCardDialog({
  trip,
  open,
  onOpenChange,
}: {
  trip: StoryTrip;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useMemo(() => shareCardFromStoryTrip(trip), [trip]);
  const [ratio, setRatio] = useState<ShareCardRatio>("story");
  const [assets, setAssets] = useState<ShareCardAssets | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const shareable = useMemo(() => canShareFiles(), []);

  useEffect(() => {
    if (!open || assets) return;
    let cancelled = false;
    loadShareCardAssets(data)
      .then((loaded) => {
        if (!cancelled) setAssets(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, assets, data]);

  useEffect(() => {
    if (!open || !assets) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const frame = requestAnimationFrame(() => {
      const size = shareCardRatio(ratio);
      const width = Math.round(size.width * PREVIEW_SCALE);
      const height = Math.round(size.height * PREVIEW_SCALE);
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      drawShareCardPreview(
        context,
        ratio,
        width,
        height,
        data,
        assets.cover,
        assets.shapes,
        assets.stack,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [open, assets, data, ratio]);

  const build = useCallback(async () => {
    if (!assets) throw new Error("not ready");
    return renderShareCard(data, ratio, assets);
  }, [assets, data, ratio]);

  const filename = `${filenameSlug(trip.name)}-${ratio}.png`;

  const handleDownload = useCallback(async () => {
    setBusy("download");
    try {
      const result = await build();
      downloadBlob(result.blob, filename);
      toast.success("Share card saved");
    } catch {
      toast.error("The share card could not be generated.");
    } finally {
      setBusy(null);
    }
  }, [build, filename]);

  const handleShare = useCallback(async () => {
    setBusy("share");
    try {
      const result = await build();
      const shared = await shareImage(result.blob, filename, trip.name);
      // A dismissed share sheet is a normal outcome, so falling back to a
      // download would be wrong: it would save a file nobody asked for.
      if (!shared) toast.message("Sharing was cancelled.");
    } catch {
      toast.error("The share card could not be generated.");
    } finally {
      setBusy(null);
    }
  }, [build, filename, trip.name]);

  return (
    <Dialog open={open} onOpenChange={busy ? () => undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this trip</DialogTitle>
          <DialogDescription>
            An image of {trip.name}, sized for posting.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-black/40 p-3 ring-1 ring-white/10">
            {loadError ? (
              <p className="py-12 text-center text-sm text-foreground/60">
                The card could not be prepared.
              </p>
            ) : assets ? (
              <canvas
                ref={canvasRef}
                aria-label="Share card preview"
                role="img"
                className="mx-auto block rounded-md"
                style={{
                  maxHeight: "min(44dvh, 400px)",
                  maxWidth: "100%",
                  width: "auto",
                  height: "auto",
                }}
              />
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-foreground/50">
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Composing
              </div>
            )}
          </div>

          {assets?.coverFailed ? (
            <p className="text-xs text-foreground/50">
              The cover photo could not be read, so the card uses its own
              backdrop instead.
            </p>
          ) : null}

          <div className="flex gap-2">
            {SHARE_CARD_RATIOS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRatio(item.id)}
                aria-pressed={ratio === item.id}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  ratio === item.id
                    ? "border-brand/60 bg-brand/10 text-foreground"
                    : "border-white/10 bg-white/[0.02] text-foreground/70 hover:bg-white/[0.05]",
                )}
              >
                <span className="block font-medium">{item.label}</span>
                <span className="block text-xs text-foreground/50">
                  {item.note}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              size="lg"
              onClick={handleDownload}
              disabled={!assets || busy !== null}
            >
              {busy === "download" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <DownloadIcon />
              )}
              Download
            </Button>
            {shareable ? (
              <Button
                size="lg"
                onClick={handleShare}
                disabled={!assets || busy !== null}
                className="bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {busy === "share" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <Share2Icon />
                )}
                Share
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The affordance. Mirrors StoryLauncher: the dialog is only mounted after a
 * click, so a trip nobody shares costs nothing. */
export function TripShareCardButton({
  trip,
  className,
  label = "Share",
}: {
  trip: StoryTrip;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-black/40 px-3 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-black/60",
          className,
        )}
      >
        <Share2Icon className="size-4" />
        {label}
      </button>
      {open ? (
        <TripShareCardDialog trip={trip} open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
