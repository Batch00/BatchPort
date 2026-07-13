// Skeleton mirroring the stats page: summary cards, two chart cards, then the
// wide country chart, so navigation shows structure while the views load.
export default function StatsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-8 p-6 sm:p-8">
      <div>
        <div className="mb-4 h-4 w-32 rounded bg-white/5" />
        <div className="h-7 w-40 rounded bg-white/5" />
        <div className="mt-2 h-4 w-52 rounded bg-white/5" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-white/5" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-80 rounded-2xl bg-white/5" />
        <div className="h-80 rounded-2xl bg-white/5" />
      </div>

      <div className="h-96 rounded-2xl bg-white/5" />
    </div>
  );
}
