"use client";

import { Button } from "@/components/ui/button";

// Error boundary for authenticated routes. Renders inside the app layout, so the
// nav stays in place, and offers a retry instead of crashing.
export default function AppError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="text-sm text-foreground/60">
        We could not load this page. Please try again.
      </p>
      <Button
        onClick={reset}
        className="bg-brand text-brand-foreground hover:bg-brand/90"
      >
        Try again
      </Button>
    </div>
  );
}
