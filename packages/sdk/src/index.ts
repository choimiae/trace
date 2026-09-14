import { TraceClient } from "./client.js";
import { installCollectors } from "./collectors.js";
import { autoInstall, type Consent, type InstallOptions } from "./install.js";
import { loadReplay } from "./replay-loader.js";

let client: TraceClient | undefined;

export function init(options: { projectId: string; endpoint?: string; consent?: Consent }) {
  const endpoint = options.endpoint ?? "/v1/events/batch";
  client = new TraceClient({
    projectId: options.projectId,
    endpoint,
    consent: options.consent ?? "granted",
  });
  installCollectors(client);
  // 리플레이는 켜진 프로젝트에서만 켜진다. 실패해도 수집은 계속돼야 하므로
  // 기다리지 않고, loadReplay 는 절대 던지지 않는다.
  void loadReplay({ projectId: options.projectId, sessionId: client.sessionId, endpoint });
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

  if (typeof document !== "undefined") {
    autoInstall(document.currentScript, (options: InstallOptions) => init(options));
  }
}

export { TraceClient };
export type { Consent, InstallOptions };
