import { Badge } from "@/components/ui/badge";
import { statusLabel } from "@/lib/format";
import type { TripStatus } from "@/lib/types";

const VARIANT: Record<TripStatus, "brand" | "secondary" | "muted"> = {
  ongoing: "brand",
  completed: "secondary",
  planned: "muted",
};

export function StatusBadge({ status }: { status: TripStatus }) {
  return <Badge variant={VARIANT[status] ?? "secondary"}>{statusLabel(status)}</Badge>;
}
