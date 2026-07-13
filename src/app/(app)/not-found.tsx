import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Not-found boundary for authenticated routes (missing or unowned trips and
// destinations). Renders inside the app layout, so the nav stays in place.
export default function AppNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-foreground/60">
        This page does not exist or you do not have access to it.
      </p>
      <Link
        href="/dashboard"
        className={cn(
          buttonVariants(),
          "bg-brand text-brand-foreground hover:bg-brand/90",
        )}
      >
        Back to dashboard
      </Link>
    </div>
  );
}
