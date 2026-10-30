/* PulseOps service worker: Web Push for alert incidents. Plain JS because Vite serves /public as-is. */

const API = new URL(self.location.href).searchParams.get("api") || "/api";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function windows() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

async function updateBadge(delta) {
  if (!("setAppBadge" in self.navigator)) return;
  const shown = await self.registration.getNotifications();
  const count = shown.filter((item) => item.data && item.data.incident_id).length + delta;
  try {
    if (count > 0) await self.navigator.setAppBadge(count);
    else await self.navigator.clearAppBadge();
  } catch {
    /* badging is best effort */
  }
}

async function onPush(event) {
  let message;
  try {
    message = event.data ? event.data.json() : null;
  } catch {
    message = null;
  }
  if (!message || !message.title) return;

  // A visible PulseOps tab shows its own in-app banner, so skip the system notification.
  const open = await windows();
  const visible = open.filter((client) => client.visibilityState === "visible");
  if (visible.length > 0) {
    for (const client of visible) client.postMessage({ type: "push.alert", payload: message });
    return;
  }

  await self.registration.showNotification(message.title, {
    body: message.body,
    icon: message.icon,
    badge: message.badge,
    image: message.image,
    tag: message.tag,
    renotify: message.renotify,
    requireInteraction: message.requireInteraction,
    timestamp: message.timestamp,
    actions: message.actions || [],
    data: message.data || {},
  });
  await updateBadge(0);
}

async function acknowledge(notification) {
  const data = notification.data || {};
  let title = "Acknowledged";
  let body = "The incident is marked as acknowledged.";
  try {
    const response = await fetch(`${API}/push/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: data.ack_token }),
    });
    if (response.status === 409) {
      title = "Already resolved";
      body = "This incident was resolved before you acknowledged it.";
    } else if (!response.ok) {
      title = "Couldn't acknowledge";
      body = "Open PulseOps to acknowledge this incident.";
    }
  } catch {
    title = "Couldn't acknowledge";
    body = "PulseOps is unreachable. Open the dashboard to try again.";
  }
  await self.registration.showNotification(title, {
    body,
    icon: "/push/icon-192.png",
    badge: "/push/badge-72.png",
    tag: `${notification.tag}-ack`,
    data: { url: data.url },
  });
  for (const client of await windows()) client.postMessage({ type: "push.acked", incidentId: data.incident_id });
  await updateBadge(0);
}

async function openTarget(url) {
  const target = new URL(url || "/alerts", self.location.origin).href;
  const open = await windows();
  const existing = open.find((client) => new URL(client.url).origin === self.location.origin);
  if (existing) {
    await existing.focus();
    existing.postMessage({ type: "push.navigate", url: target });
    return;
  }
  await self.clients.openWindow(target);
}

self.addEventListener("push", (event) => event.waitUntil(onPush(event)));

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  notification.close();
  if (event.action === "ack") {
    event.waitUntil(acknowledge(notification));
    return;
  }
  event.waitUntil(Promise.all([openTarget(notification.data && notification.data.url), updateBadge(0)]));
});

self.addEventListener("notificationclose", (event) => event.waitUntil(updateBadge(0)));

// The browser rotated the subscription. Re-subscribe, then let an open tab save it (only tabs hold the sign-in token).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription && event.oldSubscription.options.applicationServerKey;
      if (!key) return;
      const fresh = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      for (const client of await windows()) client.postMessage({ type: "push.resubscribed", subscription: fresh.toJSON() });
    })(),
  );
});
