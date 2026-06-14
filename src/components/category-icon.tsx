import {
  UtensilsIcon,
  TicketIcon,
  LandmarkIcon,
  TreesIcon,
  MountainIcon,
  WavesIcon,
  CompassIcon,
  MartiniIcon,
  ShoppingBagIcon,
  BedIcon,
  TrainFrontIcon,
  MapPinIcon,
  type LucideIcon,
} from "lucide-react";

// Maps the category.icon slug stored in the database (lucide kebab-case names)
// to the matching lucide React component. Unknown slugs fall back to a pin.
const ICON_MAP: Record<string, LucideIcon> = {
  utensils: UtensilsIcon,
  ticket: TicketIcon,
  landmark: LandmarkIcon,
  trees: TreesIcon,
  mountain: MountainIcon,
  waves: WavesIcon,
  compass: CompassIcon,
  martini: MartiniIcon,
  "shopping-bag": ShoppingBagIcon,
  bed: BedIcon,
  "train-front": TrainFrontIcon,
  "map-pin": MapPinIcon,
};

export function CategoryIcon({
  icon,
  className,
}: {
  icon?: string | null;
  className?: string;
}) {
  const Icon = (icon && ICON_MAP[icon]) || MapPinIcon;
  return <Icon className={className} />;
}
