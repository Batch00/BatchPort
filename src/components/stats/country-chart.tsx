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

import { AXIS_COLOR, BRAND, ChartCard, ChartEmpty } from "./chart-card";
import type { CountryStat } from "@/lib/stats-data";

interface TipProps {
  active?: boolean;
  payload?: { payload: CountryStat }[];
}

function CountryTooltip({ active, payload }: TipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-foreground">{row.country_name}</div>
      <div className="text-foreground/70">
        {row.destinations}{" "}
        {row.destinations === 1 ? "destination" : "destinations"}
      </div>
      <div className="text-foreground/50">
        {row.trips} {row.trips === 1 ? "trip" : "trips"}
      </div>
    </div>
  );
}

// Top 10 most-visited countries by destination count. Bars share the electric
// blue accent with a slight opacity falloff so the ranking reads at a glance.
export function CountryChart({ data }: { data: CountryStat[] }) {
  if (data.length === 0) {
    return (
      <ChartCard title="Top countries">
        <ChartEmpty message="No countries visited yet." />
      </ChartCard>
    );
  }

  const height = Math.max(200, data.length * 38);

  return (
    <ChartCard title="Top countries" description="Where you keep going back">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
        >
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="country_name"
            width={112}
            tick={{ fill: AXIS_COLOR, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CountryTooltip />} />
          <Bar
            dataKey="destinations"
            fill={BRAND}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            {data.map((row, index) => (
              <Cell
                key={row.country_code}
                fillOpacity={Math.max(0.45, 1 - index * 0.06)}
              />
            ))}
            <LabelList
              dataKey="destinations"
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
