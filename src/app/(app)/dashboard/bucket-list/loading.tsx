// Skeleton mirroring the bucket list board: heading, progress bar, item cards.
export default function BucketListLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl animate-pulse p-6 sm:p-8">
      <div className="mb-6 h-4 w-36 rounded bg-white/5" />
      <div className="mb-2 h-7 w-40 rounded bg-white/5" />
      <div className="mb-3 h-4 w-56 rounded bg-white/5" />
      <div className="mb-8 h-2 w-56 rounded-full bg-white/5" />
      <div className="mb-3 h-4 w-24 rounded bg-white/5" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-white/5" />
        ))}
      </div>
    </div>
  );
}
