import { Check, Copy } from "lucide-react";
import { useCopy } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ingestUrl } from "@/lib/api/client";

const PLACEHOLDER_KEY = "po_live_generate_a_key_first";

function snippetFor(serviceName: string, apiKey: string): string {
  return `import { startPulseOps } from "./pulseops";

startPulseOps({
  url: "${ingestUrl()}",
  apiKey: "${apiKey}",
  service: ${JSON.stringify(serviceName)},
  env: "dev",
});`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy(value);
  return (
    <Button size="sm" variant="ghost" onClick={copy} aria-label={label}>
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/**
 * The three steps that send an app's real traffic to this project.
 * `apiKey` is the full token when it has just been created, otherwise a placeholder.
 */
export function ConnectSnippet({
  serviceName,
  apiKey,
}: {
  serviceName: string;
  apiKey: string | null;
}) {
  const code = snippetFor(serviceName, apiKey ?? PLACEHOLDER_KEY);
  return (
    <div className="space-y-3 text-sm text-dim">
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Copy{" "}
          <code className="num text-ink">
            packages/sdk-browser/src/index.ts
          </code>{" "}
          into your app as <code className="num text-ink">src/pulseops.ts</code>
          .
        </li>
        <li>
          Install the Web Vitals library:{" "}
          <code className="num text-ink">npm install web-vitals</code>.
        </li>
        <li>
          Call it once in <code className="num text-ink">src/main.tsx</code>,
          before the app renders.
        </li>
        <li>
          Reload the app and use it. New calls show up under API, and page speed
          shows up under Web Vitals, within a couple of minutes.
        </li>
      </ol>
      <div className="overflow-hidden rounded-xl2 border border-line bg-base/80">
        <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
          <span className="text-[11px] uppercase tracking-wide text-mute">
            src/main.tsx
          </span>
          <CopyButton value={code} label="Copy snippet" />
        </div>
        <pre className="num overflow-x-auto p-3 text-xs leading-5 text-dim">
          {code}
        </pre>
      </div>
      {apiKey === null ? (
        <p className="text-xs text-mute">
          Generate a key first, then paste it in place of the placeholder. Keys
          are shown only once.
        </p>
      ) : null}
    </div>
  );
}

/** Shown right after a key is created, so it is never lost. */
export function ConnectDialog({
  open,
  onOpenChange,
  title,
  description,
  serviceName,
  apiKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  serviceName: string;
  apiKey: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-line bg-base/60 px-3 py-2">
          <code className="num truncate text-xs text-ink">{apiKey}</code>
          <CopyButton value={apiKey} label="Copy key" />
        </div>
        <ConnectSnippet serviceName={serviceName} apiKey={apiKey} />
        <div className="mt-4 flex justify-end">
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
