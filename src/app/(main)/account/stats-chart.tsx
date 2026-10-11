"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCompact } from "@/lib/format";

const config = {
  value: { label: "Total", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function StatsChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const max = Math.max(...data.map((item) => item.value));
  const ticks = [0, 10];
  for (let tick = 100; tick / 10 < max; tick *= 10) ticks.push(tick);

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-64 w-full overflow-hidden"
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 16, right: 4, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          interval={0}
          tickLine={false}
          axisLine={false}
          height={40}
          tick={({ x, y, payload }) => (
            <text
              x={x}
              y={y}
              textAnchor="middle"
              fontSize={10}
              className="fill-muted-foreground"
            >
              {String(payload.value)
                .split(" ")
                .map((word, index) => (
                  <tspan key={word} x={x} dy={index ? 12 : 10}>
                    {word}
                  </tspan>
                ))}
            </text>
          )}
        />
        <YAxis
          scale="symlog"
          domain={[0, ticks[ticks.length - 1]]}
          ticks={ticks}
          width={36}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          tickFormatter={formatCompact}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          maxBarSize={28}
          minPointSize={2}
          isAnimationActive={false}
        >
          <LabelList
            position="top"
            fontSize={10}
            className="fill-foreground"
            formatter={(value) => formatCompact(Number(value))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
