import { Loader2Icon } from "lucide-react";

// Shown while the dashboard and its nested pages (stats, bucket list, settings)
// fetch their data, so navigation never lands on a blank screen.
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-foreground/40" />
    </div>
  );
}
