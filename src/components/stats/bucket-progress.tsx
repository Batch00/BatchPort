import { ChartCard } from "./chart-card";
import type { BucketCompletion } from "@/lib/stats-data";

// Circular progress ring for bucket list completion. The page only renders this
// when the user actually has bucket list items, so bucket is always present.
export function BucketProgress({ bucket }: { bucket: BucketCompletion }) {
  const pct = Math.max(0, Math.min(100, bucket.completion_pct));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  return (
    <ChartCard title="Bucket list" description="Dreams checked off">
      <div className="flex items-center gap-6">
        <div className="relative size-32 shrink-0">
          <svg viewBox="0 0 128 128" className="size-full -rotate-90">
            <circle
              cx="64"
              cy="64"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
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
    </ChartCard>
  );
}
