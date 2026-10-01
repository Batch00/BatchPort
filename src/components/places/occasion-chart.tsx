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
  ChartTooltipFrame,
  tooltipCursor,
} from "@/components/stats/chart-card";
import type { OccasionBar } from "@/lib/places-stats";

// Visits by occasion, built the same way as the experiences-by-category chart
// (horizontal bars, each in the occasion's own seeded colour, the count at the
// bar's end) so the two read as one family on the same page.
//
// Built for a distribution where one bar is 5 and five bars are 1. A row of
// equal one-visit bars is a true picture, and every bar carries its number, so
// nothing depends on judging a bar length against an axis that is not drawn.
// The places and states each occasion reached live in the tooltip: they are
// the second question, and at 1 place and 1 state per bar they would be
// repetition on screen.

interface TipProps {
  active?: boolean;
  payload?: { payload: OccasionBar }[];
}

function OccasionTooltip({ active, payload }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <ChartTooltipFrame>
      <div className="font-medium text-foreground">{row.label}</div>
      <div className="text-foreground/70">
        {row.visits} {row.visits === 1 ? "visit" : "visits"}
        {row.places !== row.visits
          ? `, ${row.places} ${row.places === 1 ? "place" : "places"}`
          : null}
      </div>
      {row.states > 0 ? (
        <div className="text-foreground/50">
          {row.states} {row.states === 1 ? "state" : "states"}
        </div>
      ) : null}
    </ChartTooltipFrame>
  );
}

export function OccasionChart({
  data,
  description,
}: {
  data: OccasionBar[];
  description?: string;
}) {
  const height = Math.max(120, data.length * 40);
  return (
    <ChartCard
      title="Why you went"
      description={description ?? "Visits by occasion"}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 32, bottom: 4, left: 8 }}
        >
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={104}
            tick={{ fill: AXIS_COLOR, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<OccasionTooltip />} cursor={tooltipCursor} />
          <Bar
            dataKey="visits"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          >
            {data.map((row) => (
              <Cell key={row.key} fill={row.color} />
            ))}
            <LabelList
              dataKey="visits"
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
