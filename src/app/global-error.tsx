"use client";

// global-error replaces the root layout when an unhandled error occurs, so it
// must define its own html/body. Route segment config is still processed even
// in client components, so force-dynamic prevents the static prerender pass
// that would otherwise hit a Next.js 16 Turbopack workStore invariant bug.
export const dynamic = "force-dynamic";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="flex min-h-full flex-col items-center justify-center gap-4 bg-[#0a0a0a] p-8 text-center antialiased">
        <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
