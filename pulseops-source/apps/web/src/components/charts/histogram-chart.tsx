import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { ECharts, EChartsCoreOption } from "echarts";
import { ensureAuroraTheme } from "@/lib/echarts-theme";
import type { HistogramBucket } from "@/lib/api/types";

export function HistogramChart({ buckets }: { buckets: HistogramBucket[] }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const option = useMemo<EChartsCoreOption>(
    () => ({
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#171A2C",
        borderColor: "#232741",
        textStyle: { color: "#EEF0FF" },
      },
      xAxis: {
        type: "category",
        data: buckets.map((bucket) => bucket.label),
        axisLabel: { color: "#5E6490", fontSize: 10 },
        axisLine: { lineStyle: { color: "#232741" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#5E6490", fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(35,39,65,.7)" } },
      },
      series: [
        {
          type: "bar",
          data: buckets.map((bucket) => bucket.count),
          itemStyle: { color: "#7C5CFF", borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 28,
        },
      ],
    }),
    [buckets],
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

  return <div ref={host} role="img" aria-label="Latency histogram" className="h-56" />;
}
