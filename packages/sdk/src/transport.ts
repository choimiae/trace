import type { TraceClient } from "./client.js";

export interface TransportOptions {
  intervalMs?: number;
  queueThreshold?: number;
}

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_QUEUE_THRESHOLD = 20;

export function installTransport(client: TraceClient, options: TransportOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const queueThreshold = options.queueThreshold ?? DEFAULT_QUEUE_THRESHOLD;
  let stopped = false;

  const send = () => {
    if (stopped || client.queueLength === 0) return;
    void client.flush();
  };

  const timer = setInterval(send, intervalMs);

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") send();
  };
  const onPageHide = () => send();
  const onEnqueue = () => {
    if (client.queueLength >= queueThreshold) send();
  };

  client.onEnqueue(onEnqueue);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
  };
}
