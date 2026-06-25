import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Shared dark-theme constants for the Recharts charts.
export const AXIS_COLOR = "rgba(255,255,255,0.45)";
export const GRID_COLOR = "rgba(255,255,255,0.06)";
export const BRAND = "var(--brand)";
export const TEAL = "#14b8a6";

// Props that style the default Recharts Tooltip for the dark theme. Spread onto
// a <Tooltip /> where a custom content component is not needed.
export const tooltipStyleProps = {
  cursor: { fill: "rgba(255,255,255,0.05)" },
  contentStyle: {
    background: "#0a0a0a",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  labelStyle: { color: "rgba(255,255,255,0.6)", marginBottom: 2 },
  itemStyle: { color: "#ffffff" },
};

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
        "rounded-2xl bg-card p-5 ring-1 ring-foreground/10",
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
