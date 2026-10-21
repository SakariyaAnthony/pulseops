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
    <header className="mb-6">
      {eyebrow ? (
        <p className="inline-flex items-center gap-2 rounded-full border border-violet/25 bg-violet/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet">
          <span
            className="h-1.5 w-1.5 rounded-full bg-violet shadow-glow"
            aria-hidden
          />
          {eyebrow}
        </p>
      ) : null}
      <h1 className="gradient-text mt-2 text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-dim">
          {description}
        </p>
      ) : null}
    </header>
  );
}
