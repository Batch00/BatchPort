"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_COLOR,
  BRAND,
  ChartCard,
  ChartEmpty,
  ChartTooltipFrame,
  GRID_COLOR,
  TEAL,
  tooltipCursor,
} from "./chart-card";
import type { YearStat } from "@/lib/stats-data";

interface TipProps {
  active?: boolean;
  payload?: { payload: YearStat }[];
}

function YearTooltip({ active, payload }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <ChartTooltipFrame>
      <div className="font-medium text-foreground">{row.year}</div>
      <div className="text-foreground/70">
        {row.trips} {row.trips === 1 ? "trip" : "trips"}
      </div>
      <div className="text-foreground/70">
        {row.countries} {row.countries === 1 ? "country" : "countries"}
      </div>
      {row.new_countries > 0 ? (
        <div className="text-brand">
          {row.new_countries} new{" "}
          {row.new_countries === 1 ? "country" : "countries"}
        </div>
      ) : null}
    </ChartTooltipFrame>
  );
}

// Travel growth over time: total countries and newly visited countries as bars,
// trips as a line overlay. ComposedChart layers the Bar and Line series.
export function YearlyChart({
  data,
  description = "How your map has grown",
}: {
  data: YearStat[];
  description?: string;
}) {
  if (data.length === 0) {
    return (
      <ChartCard title="Travel by year">
        <ChartEmpty message="No trips recorded yet." />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Travel by year" description={description}>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 4, left: -16 }}
        >
          <CartesianGrid stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="year"
            tick={{ fill: AXIS_COLOR, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: GRID_COLOR }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: AXIS_COLOR, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<YearTooltip />} cursor={tooltipCursor} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: AXIS_COLOR }}
            iconType="circle"
            iconSize={8}
          />
          <Bar
            dataKey="countries"
            name="Countries"
            fill={BRAND}
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
          <Bar
            dataKey="new_countries"
            name="New countries"
            fill={TEAL}
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="trips"
            name="Trips"
            stroke="#ffffff"
            strokeWidth={2}
            dot={{ r: 3, fill: "#ffffff" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
