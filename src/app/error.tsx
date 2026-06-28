"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

// Catch-all error boundary for public routes (landing, demo, share). Keeps the
// dark shell and offers a retry plus a way home.
export default function RootError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#0a0a0a] p-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="max-w-sm text-sm text-foreground/60">
        We could not load this page. Please try again.
      </p>
      <div className="flex items-center gap-3">
        <Button
          onClick={reset}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          Try again
        </Button>
        <Link
          href="/"
          className="text-sm text-foreground/60 underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
