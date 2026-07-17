import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Shared dark-theme constants for the Recharts charts.
export const AXIS_COLOR = "rgba(255,255,255,0.45)";
export const GRID_COLOR = "rgba(255,255,255,0.06)";
export const BRAND = "var(--brand)";
export const TEAL = "#14b8a6";

// The hover cursor fill shared by every chart's <Tooltip cursor={...}>.
export const tooltipCursor = { fill: "rgba(255,255,255,0.05)" };

// The dark container every custom tooltip renders into, so hover cards look
// identical across all charts.
export function ChartTooltipFrame({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2 text-xs shadow-lg">
      {children}
    </div>
  );
}

// A titled card wrapper for a chart, matching the app's dark card aesthetic.
export function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // min-w-0 lets the chart's ResponsiveContainer shrink inside grid and
        // flex parents instead of forcing horizontal overflow on phones.
        "min-w-0 rounded-2xl bg-card p-5 ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground/80">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-foreground/45">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// A small empty state for charts with no data.
export function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-foreground/40">
      {message}
    </div>
  );
}
