import type { GraphEdge, GraphNode, Health } from "@/lib/api/types";

const COLUMN: Record<GraphNode["kind"], number> = {
  client: 0,
  gateway: 1,
  service: 2,
  data: 3,
};

const STROKE: Record<Health, string> = {
  healthy: "#34D399",
  degraded: "#FBBF24",
  critical: "#F43F5E",
};

export function DependencyMap({ nodes, edges, highlight }: { nodes: GraphNode[]; edges: GraphEdge[]; highlight?: string }) {
  const columns = [0, 1, 2, 3].map((index) => nodes.filter((node) => COLUMN[node.kind] === index));
  const positions = new Map<string, { x: number; y: number }>();
  columns.forEach((group, column) => {
    group.forEach((node, row) => {
      positions.set(node.id, { x: 16 + column * 196, y: 12 + row * 76 });
    });
  });
  const height = Math.max(220, Math.max(...columns.map((group) => group.length), 1) * 76 + 20);
  const width = 16 + 4 * 196;

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0" aria-hidden>
          {edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x + 156}
                y1={from.y + 26}
                x2={to.x}
                y2={to.y + 26}
                stroke={STROKE[edge.health]}
                strokeWidth={Math.max(1.5, Math.min(4, edge.rps / 30))}
                strokeOpacity={0.8}
              />
            );
          })}
        </svg>
        {nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          const active = highlight === node.id || highlight === node.label;
          return (
            <div
              key={node.id}
              className="absolute w-[156px] rounded-xl2 border bg-surface/95 px-3 py-2"
              style={{
                left: position.x,
                top: position.y,
                borderColor: active ? "#7C5CFF" : "#232741",
                boxShadow: active ? "0 0 24px -8px rgba(124,92,255,.8)" : undefined,
              }}
            >
              <p className="truncate text-sm text-ink">{node.label}</p>
              <p className="text-[11px] capitalize" style={{ color: STROKE[node.health] }}>
                {node.kind} · {node.health}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
