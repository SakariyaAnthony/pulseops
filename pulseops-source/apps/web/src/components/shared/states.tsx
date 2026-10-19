import { AlertTriangle, Copy, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function InlineError({
  title,
  message,
  onRetry,
  pending = false,
}: {
  title: string;
  message: string;
  onRetry: () => void;
  pending?: boolean;
}) {
  return (
    <div className="glass shadow-card flex flex-col items-start gap-3 rounded-xl2 p-6">
      <div className="flex items-center gap-2 text-danger">
        <AlertTriangle className="h-4 w-4" />
        <h2 className="text-sm font-medium text-ink">{title}</h2>
      </div>
      <p className="max-w-xl text-sm text-dim">{message}</p>
      <Button variant="secondary" onClick={onRetry} disabled={pending}>
        <RefreshCw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        Retry
      </Button>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass shadow-card rounded-xl2 px-6 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 h-10 w-10 rounded-xl2 bg-violet/15 shadow-glow" aria-hidden />
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-dim">{body}</p>
        <SdkSnippet />
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

function SdkSnippet() {
  const snippet = `npm install @pulseops/node

import { PulseOps } from "@pulseops/node";

PulseOps.init({
  apiKey: process.env.PULSEOPS_API_KEY,
  service: "orders",
  env: "dev",
});`;
  return (
    <div className="mt-5 overflow-hidden rounded-xl2 border border-line bg-base/80">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[11px] uppercase tracking-wide text-mute">Install the SDK</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-dim hover:text-ink"
          onClick={() => {
            void navigator.clipboard.writeText(snippet);
            toast.success("Snippet copied");
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
      </div>
      <pre className="num overflow-x-auto p-3 text-xs leading-5 text-dim">{snippet}</pre>
    </div>
  );
}

export function QueryGate<T>({
  query,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return skeleton;
  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : "The request failed.";
    return <InlineError title="This view didn't load" message={message} onRetry={() => void query.refetch()} pending={query.isRefetching} />;
  }
  if (!query.data) return skeleton;
  if (isEmpty?.(query.data)) return empty ?? null;
  return children(query.data);
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function ChartSkeleton({ className = "h-64" }: { className?: string }) {
  return <Skeleton className={className} />;
}

export function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: () => {
      void navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        toast.success("Copied");
        window.setTimeout(() => setCopied(false), 1500);
      });
    },
  };
}
