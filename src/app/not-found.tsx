// force-dynamic is required to work around a Next.js 16 Turbopack bug where
// metadata resolution calls workAsyncStorage.getStore() during the static
// prerender pass for /_not-found, finding no work context and throwing an
// InvariantError. Forcing dynamic skips that static attempt entirely.
export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#0a0a0a] p-8 text-center">
      <h1 className="text-4xl font-bold text-foreground">404</h1>
      <p className="text-foreground/60">This page could not be found.</p>
    </div>
  );
}
