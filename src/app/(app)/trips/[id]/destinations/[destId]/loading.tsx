// Skeleton for the destination detail page: banner, experiences, photo grid.
// Shown instantly on navigation while the server fetches the real content.
export default function DestinationDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl animate-pulse p-6 sm:p-8">
      <div className="mb-6 h-4 w-24 rounded bg-white/5" />
      <div className="mb-8 aspect-video rounded-2xl bg-white/5 sm:aspect-auto sm:h-56 lg:h-64" />
      <div className="mb-4 h-4 w-32 rounded bg-white/5" />
      <div className="mb-10 flex flex-col gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5"
          >
            <div className="size-10 shrink-0 rounded-lg bg-white/5" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-4 w-44 rounded bg-white/5" />
              <div className="h-3 w-24 rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
      <div className="mb-4 h-4 w-20 rounded bg-white/5" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-lg bg-white/5" />
        ))}
      </div>
    </div>
  );
}
