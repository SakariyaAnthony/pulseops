import type { AlertRule, Incident, RuleInput } from "@/lib/api/types";

type Overrides = {
  acked: Record<string, number>;
  enabled: Record<string, boolean>;
  extraRules: AlertRule[];
  keys: Record<string, string>;
};

const STORAGE_KEY = "pulseops-overrides";

const empty = (): Overrides => ({
  acked: {},
  enabled: {},
  extraRules: [],
  keys: {},
});

function load(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Overrides>;
    return {
      acked: parsed.acked ?? {},
      enabled: parsed.enabled ?? {},
      extraRules: parsed.extraRules ?? [],
      keys: parsed.keys ?? {},
    };
  } catch {
    return empty();
  }
}

function save(next: Overrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function mergeIncidents(list: Incident[]): Incident[] {
  const overrides = load();
  return list.map((incident) =>
    overrides.acked[incident.id]
      ? { ...incident, status: "acknowledged" as const }
      : incident,
  );
}

export function mergeRules(project: string, list: AlertRule[]): AlertRule[] {
  const overrides = load();
  const extras = overrides.extraRules.filter(
    (rule) => rule.project === project && !list.some((item) => item.id === rule.id),
  );
  return [...list, ...extras].map((rule) =>
    rule.id in overrides.enabled ? { ...rule, enabled: overrides.enabled[rule.id] } : rule,
  );
}

export function ackIncident(id: string) {
  const overrides = load();
  overrides.acked[id] = Date.now();
  save(overrides);
}

export function setRuleEnabled(id: string, enabled: boolean) {
  const overrides = load();
  overrides.enabled[id] = enabled;
  overrides.extraRules = overrides.extraRules.map((rule) =>
    rule.id === id ? { ...rule, enabled } : rule,
  );
  save(overrides);
}

export function addRule(project: string, input: RuleInput): AlertRule {
  const rule: AlertRule = {
    id: `rule_${Date.now().toString(36)}`,
    project,
    name: input.name,
    metric: input.metric,
    operator: input.operator,
    threshold: input.threshold,
    window: input.window,
    severity: input.severity,
    channels: input.channels,
    enabled: true,
  };
  const overrides = load();
  overrides.extraRules = [rule, ...overrides.extraRules];
  save(overrides);
  return rule;
}

export function currentKey(project: string, fallback: string): string {
  return load().keys[project] ?? fallback;
}

export function rotateKey(project: string): string {
  const alphabet = "abcdef0123456789";
  let body = "";
  for (let i = 0; i < 20; i += 1) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  const key = `po_live_${body}`;
  const overrides = load();
  overrides.keys[project] = key;
  save(overrides);
  return key;
}

export function maskKey(key: string): string {
  if (key.length < 16) return key;
  return `${key.slice(0, 12)}••••••••${key.slice(-4)}`;
}
