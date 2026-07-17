"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_COLOR,
  ChartCard,
  ChartEmpty,
  ChartTooltipFrame,
  tooltipCursor,
} from "./chart-card";
import type { CategoryStat } from "@/lib/stats-data";

// Recharts injects active/payload at render time; all fields are optional here.
interface TipProps {
  active?: boolean;
  payload?: { payload: CategoryStat }[];
}

function CategoryTooltip({ active, payload }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <ChartTooltipFrame>
      <div className="font-medium text-foreground">{row.label}</div>
      <div className="text-foreground/70">
        {row.experience_count}{" "}
        {row.experience_count === 1 ? "experience" : "experiences"}
      </div>
      {row.avg_rating_stars !== null ? (
        <div className="text-brand">
          {"★"} {row.avg_rating_stars.toFixed(1)} avg
        </div>
      ) : null}
    </ChartTooltipFrame>
  );
}

// Horizontal bar chart of experience count per category, each bar tinted with
// the category's own color. Data arrives pre-sorted by count descending.
export function CategoryChart({
  data,
  description = "What you spend your time on",
}: {
  data: CategoryStat[];
  description?: string;
}) {
  if (data.length === 0) {
    return (
      <ChartCard title="Experiences by category">
        <ChartEmpty message="No experiences logged yet." />
      </ChartCard>
    );
  }

  const height = Math.max(160, data.length * 46);

  return (
    <ChartCard title="Experiences by category" description={description}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={92}
            tick={{ fill: AXIS_COLOR, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CategoryTooltip />} cursor={tooltipCursor} />
          <Bar
            dataKey="experience_count"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            {data.map((row) => (
              <Cell key={row.slug} fill={row.color} />
            ))}
            <LabelList
              dataKey="experience_count"
              position="right"
              fill="rgba(255,255,255,0.7)"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
