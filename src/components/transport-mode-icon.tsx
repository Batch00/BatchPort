import {
  BikeIcon,
  BusIcon,
  CarIcon,
  FootprintsIcon,
  PlaneIcon,
  RouteIcon,
  ShipIcon,
  TrainFrontIcon,
  type LucideIcon,
} from "lucide-react";

import type { TransportMode } from "@/lib/transport";

// The picture of a transport mode, on its own so more than one feature can
// draw one.
//
// It used to live in components/trips/transport-leg.tsx, and the places entry
// sheet imported it from there. That worked and was still wrong: it made a
// places surface depend on a trip feature, and it pulled transport-leg's whole
// module (its dialog, its two server actions, its offline guard) into the
// places bundle to render eight glyphs. Two features that share a vocabulary
// should share the vocabulary, not one of them.
//
// No "use client" directive: this renders no state and no handlers, so it is
// usable from a server component too. It inherits the boundary of whoever
// imports it.

const MODE_ICONS: Record<TransportMode, LucideIcon> = {
  flight: PlaneIcon,
  train: TrainFrontIcon,
  bus: BusIcon,
  car: CarIcon,
  ferry: ShipIcon,
  bike: BikeIcon,
  walk: FootprintsIcon,
  other: RouteIcon,
};

export function TransportModeIcon({
  mode,
  className,
}: {
  mode: TransportMode;
  className?: string;
}) {
  const Icon = MODE_ICONS[mode] ?? RouteIcon;
  return <Icon className={className} />;
}
