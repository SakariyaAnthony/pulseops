export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-5">
      {eyebrow ? <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-mute">{eyebrow}</p> : null}
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">{title}</h1>
      {description ? <p className="mt-1 max-w-2xl text-sm text-dim">{description}</p> : null}
    </header>
  );
}
