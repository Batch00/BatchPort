"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, Loader2Icon, PrinterIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  downloadBlob,
  filenameSlug,
  resolvePrintSize,
} from "@/lib/poster/canvas";
import {
  defaultPosterSubtitle,
  defaultPosterTitle,
  drawPosterPreview,
  loadPosterAssets,
  posterInches,
  posterPreviewSize,
  pinsBehindGlobe,
  renderPoster,
  type PosterAssets,
  type PosterData,
  type PosterFormat,
  type PosterFraming,
  type PosterOptions,
} from "@/lib/poster/poster";
import { POSTER_THEMES, type PosterThemeId } from "@/lib/poster/theme";

// The poster export dialog.
//
// Two things shape it. The preview is drawn by the export's own code path at a
// screen size, so there is no second layout to keep in step and nothing can
// download differently from what was on screen. And the achieved resolution is
// stated rather than promised: browsers cap canvas area (Safari at 16.7
// megapixels, well under a 300 DPI poster), so the size line reports what this
// device actually managed after probing, which may be 240 DPI on a phone.

const FRAMINGS: { id: PosterFraming; label: string; note: string }[] = [
  {
    id: "flat",
    label: "World map",
    note: "Robinson projection, 16 x 12 in",
  },
  { id: "globe", label: "Globe", note: "Centred on your travels, 12 x 16 in" },
];

const FORMATS: { id: PosterFormat; label: string; note: string }[] = [
  { id: "png", label: "PNG", note: "Lossless. The one to keep." },
  { id: "pdf", label: "PDF", note: "Sized in inches, for a print shop." },
];

function OptionButton({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        active
          ? "border-brand/60 bg-brand/10 text-foreground"
          : "border-white/10 bg-white/[0.02] text-foreground/70 hover:bg-white/[0.05]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PosterExportDialog({
  data,
  open,
  onOpenChange,
}: {
  data: PosterData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [framing, setFraming] = useState<PosterFraming>("flat");
  const [theme, setTheme] = useState<PosterThemeId>("midnight");
  const [showStats, setShowStats] = useState(true);
  const [format, setFormat] = useState<PosterFormat>("png");
  const [title, setTitle] = useState(defaultPosterTitle);
  const [subtitle, setSubtitle] = useState(() => defaultPosterSubtitle(data));

  const [assets, setAssets] = useState<PosterAssets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [printSize, setPrintSize] = useState<{
    width: number;
    height: number;
    dpi: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenPins = useMemo(() => pinsBehindGlobe(data), [data]);

  const options: PosterOptions = {
    framing,
    theme,
    showStats,
    title,
    subtitle,
    format,
  };

  // Country outlines and the app's typeface, once per opening. The GeoJSON is
  // a precached service worker asset, so this is normally a cache read and the
  // poster works with no connection.
  useEffect(() => {
    if (!open || assets) return;
    let cancelled = false;
    loadPosterAssets()
      .then((loaded) => {
        if (!cancelled) setAssets(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("The country outlines could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, assets]);

  // Probing the canvas limit means allocating full-size bitmaps until one
  // works, so it runs once per framing rather than on every keystroke, and it
  // runs after a frame so the dialog paints before the probe blocks.
  useEffect(() => {
    if (!open) return;
    const [widthInches, heightInches] = posterInches(framing);
    const frame = requestAnimationFrame(() => {
      setPrintSize(resolvePrintSize(widthInches, heightInches));
    });
    return () => cancelAnimationFrame(frame);
  }, [open, framing]);

  // Live preview. Redrawn on the next frame after any option changes.
  useEffect(() => {
    if (!open || !assets) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const frame = requestAnimationFrame(() => {
      const size = posterPreviewSize(framing);
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      drawPosterPreview(
        context,
        size.width,
        size.height,
        data,
        options,
        assets.shapes,
        assets.stack,
      );
    });
    return () => cancelAnimationFrame(frame);
    // The options object is rebuilt every render, so depend on its parts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assets, data, framing, theme, showStats, title, subtitle]);

  const handleExport = useCallback(async () => {
    if (!assets) return;
    setBusy(true);
    setProgress("Preparing");
    try {
      const result = await renderPoster(data, options, assets, setProgress);
      const extension = result.format === "pdf" ? "pdf" : "png";
      downloadBlob(
        result.blob,
        `${filenameSlug(title || "travels")}-poster.${extension}`,
      );
      toast.success(
        `Poster saved at ${result.width} by ${result.height} (${result.dpi} DPI)`,
      );
    } catch {
      toast.error("The poster could not be generated.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, data, framing, theme, showStats, title, subtitle, format]);

  const [widthInches, heightInches] = posterInches(framing);

  return (
    <Dialog open={open} onOpenChange={busy ? () => undefined : onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export poster</DialogTitle>
          <DialogDescription>
            A print-resolution rendering of everywhere you have been.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-black/40 p-3 ring-1 ring-white/10">
            {loadError ? (
              <p className="py-12 text-center text-sm text-foreground/60">
                {loadError}
              </p>
            ) : assets ? (
              <canvas
                ref={canvasRef}
                aria-label="Poster preview"
                role="img"
                className="mx-auto block rounded-md"
                style={{
                  maxHeight: "min(46dvh, 420px)",
                  maxWidth: "100%",
                  width: "auto",
                  height: "auto",
                }}
              />
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-foreground/50">
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Loading the world
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground/70">
                Framing
              </p>
              <div className="flex gap-2">
                {FRAMINGS.map((item) => (
                  <OptionButton
                    key={item.id}
                    active={framing === item.id}
                    onClick={() => setFraming(item.id)}
                  >
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-xs text-foreground/50">
                      {item.note}
                    </span>
                  </OptionButton>
                ))}
              </div>
              {framing === "globe" && hiddenPins > 0 ? (
                <p className="mt-1.5 text-xs text-foreground/50">
                  A globe shows one hemisphere, so {hiddenPins} of your{" "}
                  {data.pins.length} stops fall on the far side. The world map
                  shows every one.
                </p>
              ) : null}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground/70">
                Theme
              </p>
              <div className="flex gap-2">
                {POSTER_THEMES.map((item) => (
                  <OptionButton
                    key={item.id}
                    active={theme === item.id}
                    onClick={() => setTheme(item.id)}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <span
                        aria-hidden
                        className="size-3.5 rounded-full ring-1 ring-white/20"
                        style={{ background: item.background }}
                      />
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-foreground/50">
                      {item.note}
                    </span>
                  </OptionButton>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="poster-title" className="text-xs">
                  Title
                </Label>
                <Input
                  id="poster-title"
                  value={title}
                  maxLength={40}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={defaultPosterTitle()}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="poster-subtitle" className="text-xs">
                  Subtitle
                </Label>
                <Input
                  id="poster-subtitle"
                  value={subtitle}
                  maxLength={48}
                  onChange={(event) => setSubtitle(event.target.value)}
                  placeholder="Optional"
                  className="mt-1"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground/80">
              <input
                type="checkbox"
                checked={showStats}
                onChange={(event) => setShowStats(event.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              Include the numbers (countries, continents, trips, distance)
            </label>

            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground/70">
                File
              </p>
              <div className="flex gap-2">
                {FORMATS.map((item) => (
                  <OptionButton
                    key={item.id}
                    active={format === item.id}
                    onClick={() => setFormat(item.id)}
                  >
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-xs text-foreground/50">
                      {item.note}
                    </span>
                  </OptionButton>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-foreground/50">
              {printSize
                ? `${widthInches} x ${heightInches} in at ${printSize.dpi} DPI (${printSize.width} x ${printSize.height} px)`
                : "Measuring what this device can render"}
            </p>
            <Button
              onClick={handleExport}
              disabled={!assets || busy}
              size="lg"
              className="bg-brand text-brand-foreground hover:bg-brand/90"
            >
              {busy ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  {progress ?? "Working"}
                </>
              ) : (
                <>
                  <DownloadIcon />
                  Download {format.toUpperCase()}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The entry point. Mounts the dialog only once it has been asked for, so a
 * stats page nobody exports from pays nothing beyond the props it already had. */
export function PosterExportButton({ data }: { data: PosterData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PrinterIcon />
        Export poster
      </Button>
      {open ? (
        <PosterExportDialog data={data} open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
