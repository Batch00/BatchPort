import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  subtext?: string;
  className?: string;
}

// A single metric: large value, muted label, optional icon and sub-text.
export function StatCard({
  label,
  value,
  icon: Icon,
  subtext,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground/50">{label}</span>
        {Icon ? <Icon className="size-4 text-foreground/30" /> : null}
      </div>
      <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </span>
      {subtext ? (
        <span className="text-xs text-brand/90">{subtext}</span>
      ) : null}
    </div>
  );
}
