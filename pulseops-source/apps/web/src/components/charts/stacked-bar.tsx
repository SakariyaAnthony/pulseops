const COLORS = ["#7C5CFF", "#22D3EE", "#34D399", "#F472B6"];

export function StackedBar({ segments }: { segments: { name: string; ms: number }[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.ms, 0) || 1;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-base" role="img" aria-label="Time spent breakdown">
        {segments.map((segment, index) => (
          <div
            key={segment.name}
            style={{ width: `${(segment.ms / total) * 100}%`, background: COLORS[index % COLORS.length] }}
            title={`${segment.name} ${segment.ms} ms`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {segments.map((segment, index) => (
          <li key={segment.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-dim">
              <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
              {segment.name}
            </span>
            <span className="num text-ink">{segment.ms} ms</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
