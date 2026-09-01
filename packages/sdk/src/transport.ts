import type { TraceClient } from "./client.js";

export interface TransportOptions {
  intervalMs?: number;
  queueThreshold?: number;
  flushDelayMs?: number;
}

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_QUEUE_THRESHOLD = 20;
const DEFAULT_FLUSH_DELAY_MS = 1000;

export function installTransport(client: TraceClient, options: TransportOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const queueThreshold = options.queueThreshold ?? DEFAULT_QUEUE_THRESHOLD;
  const flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  let stopped = false;
  let pendingFlush: ReturnType<typeof setTimeout> | undefined;

  const send = () => {
    if (stopped || client.queueLength === 0) return;
    if (pendingFlush !== undefined) {
      clearTimeout(pendingFlush);
      pendingFlush = undefined;
    }
    void client.flush();
  };

  const scheduleFlush = () => {
    if (stopped || pendingFlush !== undefined) return;
    pendingFlush = setTimeout(send, flushDelayMs);
  };

  const timer = setInterval(send, intervalMs);

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") send();
  };
  const onPageHide = () => send();
  const onEnqueue = () => {
    if (client.queueLength >= queueThreshold) {
      send();
    } else {
      scheduleFlush();
    }
  };

  client.onEnqueue(onEnqueue);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    stopped = true;
    clearInterval(timer);
    if (pendingFlush !== undefined) clearTimeout(pendingFlush);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
  };
}
