"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckIcon,
  ChurchIcon,
  CompassIcon,
  LandmarkIcon,
  PlusIcon,
  TicketIcon,
  TreesIcon,
  WavesIcon,
  type LucideIcon,
} from "lucide-react";

import { addPoiExperienceAction } from "@/lib/actions/experiences";
import { useDiscovery } from "@/components/discover/discovery-host";
import { SafeImage } from "@/components/photos/safe-image";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import type { DiscoverCityDetail, DiscoverPoi, PoiCategory } from "@/lib/discover";

// The "Ideas" strip on a planned trip's destination section: suggested
// highlights from the cached discovery city payload, each saving as a planned
// experience with one tap. Loads lazily (IntersectionObserver) so a trip with
// many destinations does not fire eager discovery fetches for sections the
// user never scrolls to.

const IDEA_ICONS: Record<PoiCategory, LucideIcon> = {
  museum: LandmarkIcon,
  attraction: TicketIcon,
  nature: TreesIcon,
  beach: WavesIcon,
  worship: ChurchIcon,
};

// Loose name identity for the "already saved" checkmark: trimmed, lowercased.
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function IdeaCard({
  poi,
  saved,
  saving,
  disabled,
  onAdd,
}: {
  poi: DiscoverPoi;
  saved: boolean;
  saving: boolean;
  disabled: boolean;
  onAdd: (poi: DiscoverPoi) => void;
}) {
  const Icon = IDEA_ICONS[poi.category];
  return (
    <div className="relative w-32 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
      <div className="relative h-16 w-full overflow-hidden bg-white/5">
        {poi.imageUrl ? (
          <SafeImage
            src={poi.imageUrl}
            alt={poi.name}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-foreground/25">
            <Icon className="size-5" />
          </div>
        )}
        <button
          type="button"
          aria-label={saved ? `${poi.name} already saved` : `Save ${poi.name}`}
          disabled={saved || saving || disabled}
          onClick={() => onAdd(poi)}
          className={cn(
            "absolute right-1 top-1 flex size-6 items-center justify-center rounded-full backdrop-blur transition-colors",
            saved
              ? "bg-brand/80 text-brand-foreground"
              : "bg-black/55 text-white hover:bg-brand hover:text-brand-foreground",
            (saving || disabled) && !saved && "opacity-50",
          )}
        >
          {saved ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <PlusIcon className="size-3.5" />
          )}
        </button>
      </div>
      <div className="px-2 py-1.5">
        <InfoTip
          tip={poi.name}
          label={`Full name: ${poi.name}`}
          className="block w-full truncate text-xs text-foreground/85"
        >
          {poi.name}
        </InfoTip>
        <p className="flex items-center gap-1 text-[10px] text-foreground/40">
          <Icon className="size-2.5" />
          {poi.category}
        </p>
      </div>
    </div>
  );
}

export function IdeasStrip({
  destinationId,
  destinationName,
  lat,
  lng,
  countryCode,
  countryName,
  existingNames,
  isDemo,
}: {
  destinationId: string;
  destinationName: string;
  lat: number | null;
  lng: number | null;
  countryCode: string | null;
  countryName: string | null;
  /** Names of the destination's current experiences, for the saved state. */
  existingNames: string[];
  isDemo: boolean;
}) {
  const router = useRouter();
  const discovery = useDiscovery();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState<DiscoverCityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState<string | null>(null);
  // Optimistic saved set on top of the server-known names.
  const [savedNames, setSavedNames] = useState<string[]>([]);

  // Fetch only once the strip scrolls near the viewport.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || lat === null || lng === null) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      name: destinationName,
      lat: String(lat),
      lng: String(lng),
    });
    if (countryCode) query.set("code", countryCode);
    fetch(`/api/discover/city?${query.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DiscoverCityDetail | null) => {
        setDetail(data);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [visible, destinationName, lat, lng, countryCode]);

  const existing = new Set([
    ...existingNames.map(nameKey),
    ...savedNames,
  ]);

  async function handleAdd(poi: DiscoverPoi) {
    setSavingName(poi.name);
    const result = await addPoiExperienceAction({
      destinationId,
      name: poi.name,
      categorySlug: poi.category,
      lat: poi.lat,
      lng: poi.lng,
      status: "planned",
    });
    setSavingName(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setSavedNames((names) => [...names, nameKey(poi.name)]);
    toast.success(`${poi.name} added to your plans.`);
    router.refresh();
  }

  function openMoreIdeas() {
    if (!countryCode) return;
    discovery.open({
      code: countryCode,
      name: countryName ?? countryCode,
      city: { name: destinationName, lat, lng },
    });
  }

  if (lat === null || lng === null) return null;

  const pois = detail?.pois ?? [];
  if (visible && !loading && pois.length === 0) return null;

  return (
    <div ref={containerRef}>
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-[11px] font-medium uppercase tracking-wide text-foreground/40">
          Ideas
        </h4>
        {countryCode ? (
          <button
            type="button"
            onClick={openMoreIdeas}
            className="inline-flex items-center gap-1 text-xs text-brand transition-colors hover:text-brand/80"
          >
            <CompassIcon className="size-3" />
            More ideas
          </button>
        ) : null}
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {!visible || loading ? (
          Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-[104px] w-32 shrink-0 animate-pulse rounded-lg border border-white/10 bg-white/5"
            />
          ))
        ) : (
          pois.map((poi) => (
            <IdeaCard
              key={`${poi.name}:${poi.lat}`}
              poi={poi}
              saved={existing.has(nameKey(poi.name))}
              saving={savingName === poi.name}
              disabled={isDemo || savingName !== null}
              onAdd={handleAdd}
            />
          ))
        )}
      </div>
    </div>
  );
}
