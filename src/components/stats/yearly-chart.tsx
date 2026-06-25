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
  GRID_COLOR,
  TEAL,
  tooltipStyleProps,
} from "./chart-card";
import type { YearStat } from "@/lib/stats-data";

// Travel growth over time: total countries and newly visited countries as bars,
// trips as a line overlay. ComposedChart layers the Bar and Line series.
export function YearlyChart({ data }: { data: YearStat[] }) {
  if (data.length === 0) {
    return (
      <ChartCard title="Travel by year">
        <ChartEmpty message="No trips recorded yet." />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Travel by year" description="How your map has grown">
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
          <Tooltip {...tooltipStyleProps} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: AXIS_COLOR }}
            iconType="circle"
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
