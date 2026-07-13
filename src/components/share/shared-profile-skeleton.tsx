// Skeleton mirroring SharedProfileView (globe, stat cards, trip cards), shared
// by the demo and public share loading states so navigation shows the page
// structure instead of a bare spinner.
export function SharedProfileSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-8 p-6 sm:p-8">
      <div className="h-[45vh] min-h-[300px] w-full rounded-2xl bg-white/5 sm:h-[60vh] sm:min-h-[380px]" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-white/5" />
        ))}
      </div>

      <section>
        <div className="mb-4 h-4 w-16 rounded bg-white/5" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-xl bg-white/5" />
          ))}
        </div>
      </section>
    </div>
  );
}
