import { TrophyIcon } from "lucide-react";

import type { TravelRecord } from "@/lib/stats-insights";

// A slim row of travel records, all derived from view rows the stats page
// already fetched (see travelRecords in stats-insights.ts). Renders nothing
// when no record has data behind it.
export function RecordsRow({ records }: { records: TravelRecord[] }) {
  if (records.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {records.map((record) => (
        <div
          key={record.label}
          className="flex flex-col gap-0.5 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium text-foreground/50">
            <TrophyIcon className="size-3.5 text-brand/60" />
            {record.label}
          </span>
          <span className="truncate text-lg font-semibold tracking-tight text-foreground">
            {record.value}
          </span>
          <span className="text-xs text-foreground/50">{record.detail}</span>
        </div>
      ))}
    </div>
  );
}
