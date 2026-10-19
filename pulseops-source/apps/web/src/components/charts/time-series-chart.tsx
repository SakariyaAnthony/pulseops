import { useEffect, useId, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { ECharts, EChartsCoreOption } from "echarts";
import { CHART, ensureAuroraTheme } from "@/lib/echarts-theme";
import { formatAxis, formatCompact, formatMs, formatPct } from "@/lib/format";
import type { Deploy, Point, TimeRange } from "@/lib/api/types";

export type ChartSeries = {
  name: string;
  color: string;
  points: Point[];
  area?: boolean;
};

export type ZoomWindow = { start: number; end: number };

type ZoomEvent = {
  start?: number;
  end?: number;
  batch?: { start?: number; end?: number }[];
};

function rgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function TimeSeriesChart({
  series,
  deploys = [],
  range,
  height = 260,
  unit = "number",
  syncGroup,
  zoom,
  onZoom,
  thresholds,
  ariaLabel,
}: {
  series: ChartSeries[];
  deploys?: Deploy[];
  range: TimeRange;
  height?: number;
  unit?: "ms" | "rpm" | "pct" | "number" | "rate";
  syncGroup?: string;
  zoom?: ZoomWindow | null;
  onZoom?: (zoom: ZoomWindow) => void;
  thresholds?: { warning: number; critical: number };
  ariaLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const applying = useRef(false);
  const labelId = useId();
  const start = zoom?.start ?? 0;
  const end = zoom?.end ?? 100;

  const option = useMemo<EChartsCoreOption>(() => {
    const formatValue = (value: number) => {
      if (unit === "ms") return formatMs(value);
      if (unit === "rpm") return formatCompact(value);
      if (unit === "pct") return formatPct(value);
      if (unit === "rate") return `${value.toFixed(1)} MB/s`;
      return formatCompact(value);
    };
    return {
      animationDuration: 280,
      grid: { left: 8, right: 12, top: 28, bottom: onZoom ? 36 : 8, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: "#9AA0C3", fontSize: 11 },
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#171A2C",
        borderColor: "#232741",
        textStyle: { color: "#EEF0FF", fontFamily: "JetBrains Mono, monospace", fontSize: 12 },
        axisPointer: { type: "cross", crossStyle: { color: "#5E6490" }, lineStyle: { color: "#7C5CFF" } },
        valueFormatter: (value: unknown) => formatValue(Number(value)),
      },
      xAxis: {
        type: "time",
        axisLabel: {
          color: "#5E6490",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
          formatter: (value: number) => formatAxis(value, range),
        },
        axisLine: { lineStyle: { color: "#232741" } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: "#5E6490",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
          formatter: (value: number) => formatValue(value),
        },
        splitLine: { lineStyle: { color: "rgba(35,39,65,.7)" } },
      },
      dataZoom: onZoom
        ? [
            { type: "inside", start, end },
            {
              type: "slider",
              start,
              end,
              height: 16,
              bottom: 4,
              borderColor: "transparent",
              backgroundColor: "#10121F",
              fillerColor: "rgba(124,92,255,.28)",
              handleStyle: { color: "#7C5CFF", borderColor: "#7C5CFF" },
              textStyle: { color: "#5E6490", fontSize: 10 },
              moveHandleSize: 0,
              dataBackground: { lineStyle: { color: "#232741" }, areaStyle: { color: "transparent" } },
            },
          ]
        : [{ type: "inside", start, end, disabled: !onZoom }],
      series: series.map((item, index) => ({
        name: item.name,
        type: "line",
        showSymbol: false,
        smooth: 0.25,
        data: item.points,
        lineStyle: { width: 1.8, color: item.color },
        itemStyle: { color: item.color },
        areaStyle: item.area
          ? {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: rgba(item.color, 0.35) },
                { offset: 1, color: rgba(item.color, 0) },
              ]),
            }
          : undefined,
        markLine:
          index === 0 && deploys.length
            ? {
                symbol: "none",
                data: deploys.map((deploy) => ({
                  xAxis: deploy.time,
                  label: { formatter: deploy.version, color: "#9AA0C3", fontSize: 10 },
                  lineStyle: { type: "dashed", color: "rgba(124,92,255,.75)" },
                })),
              }
            : undefined,
        markArea:
          index === 0 && thresholds
            ? {
                silent: true,
                data: [
                  [{ yAxis: thresholds.warning, itemStyle: { color: "rgba(251,191,36,0.06)" } }, { yAxis: thresholds.critical }],
                  [{ yAxis: thresholds.critical, itemStyle: { color: "rgba(244,63,94,0.08)" } }, { yAxis: Math.max(thresholds.critical * 1.25, 100) }],
                ],
              }
            : undefined,
      })),
    };
  }, [deploys, end, onZoom, range, series, start, thresholds, unit]);

  useEffect(() => {
    ensureAuroraTheme();
    if (!host.current) return;
    const chart = echarts.init(host.current, "aurora");
    chartRef.current = chart;
    if (syncGroup) {
      chart.group = syncGroup;
      echarts.connect(syncGroup);
    }
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [syncGroup]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    applying.current = true;
    chart.setOption(option, { notMerge: true });
    applying.current = false;
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onZoom) return;
    const handler = (event: unknown) => {
      if (applying.current) return;
      const payload = event as ZoomEvent;
      const nextStart = payload.batch?.[0]?.start ?? payload.start;
      const nextEnd = payload.batch?.[0]?.end ?? payload.end;
      if (nextStart == null || nextEnd == null) return;
      if (Math.abs(nextStart - start) < 0.4 && Math.abs(nextEnd - end) < 0.4) return;
      onZoom({ start: nextStart, end: nextEnd });
    };
    chart.on("datazoom", handler);
    return () => {
      chart.off("datazoom", handler);
    };
  }, [end, onZoom, start]);

  return <div ref={host} id={labelId} role="img" aria-label={ariaLabel} style={{ height }} />;
}

export const seriesColor = CHART;
