export function ApdexGauge({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const length = Math.PI * 28;
  const dash = length * pct;
  const color = pct >= 0.94 ? "#34D399" : pct >= 0.85 ? "#FBBF24" : "#F43F5E";
  return (
    <svg viewBox="0 0 72 42" className="h-12 w-full" role="img" aria-label={`Apdex ${value.toFixed(2)}`}>
      <path d="M8 36 A28 28 0 0 1 64 36" stroke="#232741" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path
        d="M8 36 A28 28 0 0 1 64 36"
        stroke={color}
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${length}`}
      />
    </svg>
  );
}
