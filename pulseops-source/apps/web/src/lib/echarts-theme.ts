import * as echarts from "echarts";

let registered = false;

export function ensureAuroraTheme() {
  if (registered) return;
  registered = true;
  echarts.registerTheme("aurora", {
    backgroundColor: "transparent",
    textStyle: { color: "#9AA0C3", fontFamily: "Inter Variable, Inter, sans-serif" },
    categoryAxis: {
      axisLine: { lineStyle: { color: "#232741" } },
      axisLabel: { color: "#5E6490" },
      splitLine: { lineStyle: { color: "rgba(35,39,65,.7)" } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: "#232741" } },
      axisLabel: { color: "#5E6490" },
      splitLine: { lineStyle: { color: "rgba(35,39,65,.65)" } },
    },
  });
}

export const CHART = {
  p50: "#22D3EE",
  p95: "#7C5CFF",
  p99: "#F472B6",
  throughput: "#60A5FA",
  cpu: "#7C5CFF",
  memory: "#22D3EE",
  read: "#60A5FA",
  write: "#F472B6",
  netIn: "#22D3EE",
  netOut: "#A78BFA",
  lag: "#FBBF24",
  errors: "#F43F5E",
  app: "#7C5CFF",
  db: "#22D3EE",
  cache: "#34D399",
  external: "#F472B6",
};
