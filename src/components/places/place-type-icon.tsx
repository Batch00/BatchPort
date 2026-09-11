import {
  BuildingIcon,
  GraduationCapIcon,
  LandmarkIcon,
  MapPinIcon,
  TreesIcon,
  TrophyIcon,
  type LucideIcon,
} from "lucide-react";

import type { PlaceType } from "@/lib/types";

// Icons live beside the component that draws them rather than in the pure
// place-types module, the same split transport-leg.tsx uses for its modes: the
// vocabulary is data, the picture of it is presentation.
const PLACE_TYPE_ICONS: Record<PlaceType, LucideIcon> = {
  city: BuildingIcon,
  // "stadium" is every sports venue, arenas included, so a trophy rather than
  // a picture of a bowl-shaped stadium.
  stadium: TrophyIcon,
  park: TreesIcon,
  campus: GraduationCapIcon,
  landmark: LandmarkIcon,
  other: MapPinIcon,
};

export function PlaceTypeIcon({
  type,
  className,
}: {
  type: PlaceType;
  className?: string;
}) {
  const Icon = PLACE_TYPE_ICONS[type] ?? MapPinIcon;
  return <Icon className={className} />;
}
