import { wsUrl } from "@/lib/api/client";

type LiveHandlers = {
  projectId: string;
  token: string;
  onStatus: (connected: boolean) => void;
  onSnapshot: () => void;
};

export function connectLive({ projectId, token, onStatus, onSnapshot }: LiveHandlers) {
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let timer = 0;

  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** attempt);
    attempt += 1;
    timer = window.setTimeout(open, delay);
  };

  const open = () => {
    if (stopped) return;
    try {
      socket = new WebSocket(wsUrl(projectId, token));
    } catch {
      onStatus(false);
      schedule();
      return;
    }
    socket.onopen = () => {
      attempt = 0;
      onStatus(true);
      socket?.send(JSON.stringify({ type: "subscribe", channel: "overview" }));
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string; event?: string };
        const kind = payload.type || payload.event;
        if (kind === "metrics.snapshot" || kind === "alert.triggered") onSnapshot();
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onerror = () => {
      socket?.close();
    };
    socket.onclose = () => {
      onStatus(false);
      schedule();
    };
  };

  open();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    socket?.close();
  };
}
