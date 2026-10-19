import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { EnvName, Scope, TimeRange } from "@/lib/api/types";
import { parseEnv, parseRange } from "@/lib/scope";

export function useScope(): Scope & {
  fingerprint: string | null;
  update: (patch: Partial<Pick<Scope, "project" | "env" | "range">> & { fingerprint?: string | null }) => void;
} {
  const [params, setParams] = useSearchParams();
  const range = parseRange(params.get("range"));
  const env = parseEnv(params.get("env"));
  const project = params.get("project") || "shop-api";
  const chaos = params.get("chaos") === "1";
  const fingerprint = params.get("fingerprint");

  const update = useCallback(
    (patch: Partial<Pick<Scope, "project" | "env" | "range">> & { fingerprint?: string | null }) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (!next.get("project")) next.set("project", "shop-api");
          if (!next.get("env")) next.set("env", "prod");
          if (!next.get("range")) next.set("range", "1h");
          if (patch.project) next.set("project", patch.project);
          if (patch.env) next.set("env", patch.env);
          if (patch.range) next.set("range", patch.range);
          if (patch.fingerprint === null) next.delete("fingerprint");
          else if (patch.fingerprint) next.set("fingerprint", patch.fingerprint);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { project, env, range, chaos, fingerprint, update };
}

export type { EnvName, TimeRange };
