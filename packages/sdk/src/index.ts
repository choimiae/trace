import { TraceClient } from "./client.js";
import { installCollectors } from "./collectors.js";

let client: TraceClient | undefined;

export function init(options: { projectId: string; endpoint?: string; consent?: "granted" | "denied" | "pending" }) {
  client = new TraceClient({
    projectId: options.projectId,
    endpoint: options.endpoint ?? "/v1/events/batch",
    consent: options.consent ?? "pending",
  });
  installCollectors(client);
  return client;
}

export function track(name: string, metadata?: Record<string, unknown>) {
  client?.track(name, metadata);
}

export const consent = {
  grant() {
    client?.grantConsent();
  },
  deny() {
    client?.denyConsent();
  },
};

declare global {
  interface Window {
    trace?: { init: typeof init; track: typeof track; consent: typeof consent };
  }
}

if (typeof window !== "undefined") {
  window.trace = { init, track, consent };
}

export { TraceClient };
