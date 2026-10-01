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
  ChartTooltipFrame,
  GRID_COLOR,
  TEAL,
  tooltipCursor,
} from "@/components/stats/chart-card";
import type { YearlyPlacesRow } from "@/lib/places-stats";

// Places by year, the same composition as "Travel by year" directly above it
// on the page: the year's total and its new half as brand and teal bars, a
// third series as a white line. Countries become places, and trips become new
// states, which is the place-side answer to "how did the map grow".
//
// new_states is presence-wide (a trip stop counts, decided in SQL), so a year
// can carry a new state with no places. The tooltip says so in that case
// rather than letting a zero bar under a raised line look like an error.

interface TipProps {
  active?: boolean;
  payload?: { payload: YearlyPlacesRow }[];
}

function YearTooltip({ active, payload }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const returns = row.places - row.new_places;
  return (
    <ChartTooltipFrame>
      <div className="font-medium text-foreground">{row.year}</div>
      <div className="text-foreground/70">
        {row.places} {row.places === 1 ? "place" : "places"}
      </div>
      {row.new_places > 0 ? (
        <div style={{ color: TEAL }}>{row.new_places} new</div>
      ) : null}
      {returns > 0 ? (
        <div className="text-foreground/50">
          {returns} {returns === 1 ? "return visit" : "return visits"}
        </div>
      ) : null}
      {row.new_states > 0 ? (
        <div className="text-foreground/70">
          {row.new_states} new {row.new_states === 1 ? "state" : "states"}
          {row.places === 0 ? " (from trips)" : null}
        </div>
      ) : null}
    </ChartTooltipFrame>
  );
}

export function PlacesYearlyChart({
  data,
  description,
}: {
  data: YearlyPlacesRow[];
  description?: string;
}) {
  return (
    <ChartCard
      title="Places by year"
      description={description ?? "New places and new states each year"}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
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
            dataKey="places"
            name="Places"
            fill={BRAND}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
          <Bar
            dataKey="new_places"
            name="New places"
            fill={TEAL}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="new_states"
            name="New states"
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
