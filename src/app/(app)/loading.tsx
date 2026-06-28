import { Loader2Icon } from "lucide-react";

// Fallback for authenticated routes (trips, destinations) while they fetch.
export default function AppLoading() {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-foreground/40" />
    </div>
  );
}
