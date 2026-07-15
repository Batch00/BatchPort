// Skeleton for the trip detail page, mirroring its banner + destination list
// layout so navigation shows structure immediately instead of a blank pause.
export default function TripDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl animate-pulse p-6 sm:p-8">
      <div className="mb-6 h-4 w-24 rounded bg-white/5" />
      <div className="mb-8 aspect-video rounded-2xl bg-white/5 sm:aspect-auto sm:h-56 lg:h-64" />
      <div className="mb-4 flex items-center justify-between">
        <div className="h-4 w-28 rounded bg-white/5" />
        <div className="h-8 w-36 rounded-md bg-white/5" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5"
          >
            <div className="h-16 w-24 shrink-0 rounded-lg bg-white/5" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-4 w-40 rounded bg-white/5" />
              <div className="h-3 w-28 rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
