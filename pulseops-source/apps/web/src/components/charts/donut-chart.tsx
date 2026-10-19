import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { ECharts, EChartsCoreOption } from "echarts";
import { ensureAuroraTheme } from "@/lib/echarts-theme";
import type { StatusSlice } from "@/lib/api/types";

const COLORS: Record<string, string> = {
  "200": "#34D399",
  "201": "#22D3EE",
  "204": "#60A5FA",
  "400": "#FBBF24",
  "404": "#9AA0C3",
  "409": "#F472B6",
  "500": "#F43F5E",
  "504": "#FB7185",
};

export function DonutChart({ slices }: { slices: StatusSlice[] }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const option = useMemo<EChartsCoreOption>(
    () => ({
      tooltip: {
        trigger: "item",
        backgroundColor: "#171A2C",
        borderColor: "#232741",
        textStyle: { color: "#EEF0FF" },
      },
      legend: {
        bottom: 0,
        textStyle: { color: "#9AA0C3", fontSize: 11 },
        icon: "circle",
        itemWidth: 8,
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "78%"],
          center: ["50%", "44%"],
          label: { show: false },
          data: slices.map((slice) => ({
            name: slice.code,
            value: slice.count,
            itemStyle: { color: COLORS[slice.code] ?? "#7C5CFF" },
          })),
        },
      ],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "38%",
          style: {
            text: total.toLocaleString(),
            fill: "#EEF0FF",
            font: "600 18px JetBrains Mono, monospace",
            align: "center",
          },
        },
      ],
    }),
    [slices, total],
  );

  useEffect(() => {
    ensureAuroraTheme();
    if (!host.current) return;
    const chart = echarts.init(host.current, "aurora");
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={host} role="img" aria-label="Status code breakdown" className="h-56" />;
}
