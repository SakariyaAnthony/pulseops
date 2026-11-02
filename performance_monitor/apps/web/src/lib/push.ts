import { api, apiBase } from "@/lib/api/client";
import type { PushSubscriptionInfo, Severity } from "@/lib/api/types";

export const ALL_SEVERITIES: Severity[] = ["critical", "warning", "info"];

export type PushPermission = NotificationPermission | "unsupported";

export type PushMessage = {
  title: string;
  body?: string;
  image?: string;
  data?: {
    url?: string;
    incident_id?: string;
    project_id?: string;
    severity?: Severity;
    started_at?: string;
    incident?: unknown;
  };
};

export type WorkerMessage =
  | { type: "push.alert"; payload: PushMessage }
  | { type: "push.acked"; incidentId?: string }
  | { type: "push.navigate"; url: string }
  | { type: "push.resubscribed"; subscription: PushSubscriptionJSON };

const STORE_KEY = "pulseops-push";

type Stored = { id: string; severities: Severity[] };

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function writeStored(info: PushSubscriptionInfo | null) {
  if (info) localStorage.setItem(STORE_KEY, JSON.stringify({ id: info.id, severities: info.severities }));
  else localStorage.removeItem(STORE_KEY);
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getPermissionState(): PushPermission {
  return pushSupported() ? Notification.permission : "unsupported";
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return Promise.resolve(null);
  if (!registration) {
    registration = navigator.serviceWorker
      .register(`/sw.js?api=${encodeURIComponent(apiBase())}`, { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return registration;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`;
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const worker = await registerServiceWorker();
  return worker ? worker.pushManager.getSubscription() : null;
}

export function storedSeverities(): Severity[] {
  return readStored()?.severities ?? ALL_SEVERITIES;
}

/** Must run from a click: browsers only show the permission prompt after a user gesture. */
export async function enablePush(severities: Severity[] = storedSeverities()): Promise<PushSubscriptionInfo> {
  if (!pushSupported()) throw new Error("This browser does not support push notifications");
  const config = await api.pushConfig();
  if (!config.enabled || !config.publicKey)
    throw new Error("Push is not configured on the API. Set the VAPID keys in apps/api/.env.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(permission === "denied" ? "Notifications are blocked for this site" : "Permission was dismissed");
  const worker = await registerServiceWorker();
  if (!worker) throw new Error("The service worker could not start");
  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.publicKey) }));
  const info = await api.savePushSubscription(subscription.toJSON(), severities);
  writeStored(info);
  return info;
}

export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) {
    await api.deletePushSubscription(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  }
  writeStored(null);
}

export async function setPushSeverities(severities: Severity[]): Promise<PushSubscriptionInfo | null> {
  const stored = readStored();
  if (!stored) return null;
  const info = await api.updatePushSeverities(stored.id, severities);
  writeStored(info);
  return info;
}

/** Re-save an existing subscription on load so the API always has this browser's latest endpoint. */
export async function syncPush(subscription?: PushSubscriptionJSON): Promise<void> {
  if (getPermissionState() !== "granted") return;
  const json = subscription ?? (await currentSubscription())?.toJSON();
  if (!json?.endpoint) return;
  const config = await api.pushConfig();
  if (!config.enabled) return;
  try {
    writeStored(await api.savePushSubscription(json, storedSeverities()));
  } catch {
    /* signed out or API down; the next load retries */
  }
}

export function onWorkerMessage(handler: (message: WorkerMessage) => void): () => void {
  if (!pushSupported()) return () => undefined;
  const listener = (event: MessageEvent) => {
    const message = event.data as WorkerMessage | undefined;
    if (message && typeof message.type === "string" && message.type.startsWith("push.")) handler(message);
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}

export function setBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (!nav.setAppBadge || !nav.clearAppBadge) return;
  const done = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge();
  void done.catch(() => undefined);
}
