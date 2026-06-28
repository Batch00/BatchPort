import type { BucketCompletion } from "@/lib/stats-data";

// Circular progress ring for bucket list completion. The unfilled track keeps a
// visible stroke so the ring reads as a circle even at 0%. The heading is
// optional: pages that already label the section (the dashboard) hide it.
export function BucketProgress({
  bucket,
  heading = true,
}: {
  bucket: BucketCompletion;
  heading?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, bucket.completion_pct));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  return (
    <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
      {heading ? (
        <div className="mb-4">
          <h2 className="text-sm font-medium text-foreground/80">Bucket list</h2>
          <p className="mt-0.5 text-xs text-foreground/45">Dreams checked off</p>
        </div>
      ) : null}
      <div className="flex items-center gap-6">
        <div className="relative size-32 shrink-0">
          <svg viewBox="0 0 128 128" className="size-full -rotate-90">
            <circle
              cx="64"
              cy="64"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="10"
            />
            <circle
              cx="64"
              cy="64"
              r={radius}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {Math.round(pct)}%
            </span>
          </div>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {bucket.fulfilled} of {bucket.total}
          </p>
          <p className="text-sm text-foreground/50">
            bucket list goals completed
          </p>
        </div>
      </div>
    </div>
  );
}
