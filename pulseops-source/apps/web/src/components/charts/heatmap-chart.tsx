import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { ECharts, EChartsCoreOption } from "echarts";
import { ensureAuroraTheme } from "@/lib/echarts-theme";

export function HeatmapChart({
  hosts,
  times,
  values,
}: {
  hosts: string[];
  times: string[];
  values: [number, number, number][];
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const option = useMemo<EChartsCoreOption>(
    () => ({
      grid: { left: 8, right: 12, top: 8, bottom: 48, containLabel: true },
      tooltip: {
        backgroundColor: "#171A2C",
        borderColor: "#232741",
        textStyle: { color: "#EEF0FF" },
        formatter: (params: unknown) => {
          const point = params as { data?: [number, number, number] };
          const data = point.data;
          if (!data) return "";
          return `${hosts[data[1]] ?? "host"} · ${times[data[0]] ?? ""}<br/>CPU ${data[2]}%`;
        },
      },
      xAxis: {
        type: "category",
        data: times,
        axisLabel: { color: "#5E6490", fontSize: 10 },
        splitArea: { show: false },
      },
      yAxis: {
        type: "category",
        data: hosts,
        axisLabel: { color: "#9AA0C3", fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
      },
      visualMap: {
        min: 0,
        max: 100,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemWidth: 10,
        itemHeight: 80,
        textStyle: { color: "#5E6490", fontSize: 10 },
        inRange: { color: ["#10121F", "#312E81", "#7C5CFF", "#F43F5E"] },
      },
      series: [{ type: "heatmap", data: values, emphasis: { itemStyle: { borderColor: "#EEF0FF", borderWidth: 1 } } }],
    }),
    [hosts, times, values],
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

  return <div ref={host} role="img" aria-label="CPU heatmap across hosts" style={{ height: Math.max(220, hosts.length * 28 + 80) }} />;
}
