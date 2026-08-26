export type Consent = "granted" | "denied" | "pending";

export interface InstallOptions {
  projectId: string;
  endpoint: string;
  consent: Consent;
}

const EVENTS_PATH = "/v1/events/batch";

export function readInstallOptions(script: HTMLOrSVGScriptElement | null): InstallOptions | undefined {
  if (!script) return undefined;

  const projectId = script.dataset.projectId;
  if (!projectId) return undefined;

  const src = script instanceof HTMLScriptElement ? script.src : "";

  return {
    projectId,
    endpoint: script.dataset.endpoint ?? inferEndpoint(src),
    consent: normalizeConsent(script.dataset.consent),
  };
}

export function autoInstall(
  script: HTMLOrSVGScriptElement | null,
  start: (options: InstallOptions) => unknown,
): void {
  if (!script) return;

  const options = readInstallOptions(script);
  if (!options) {
    console.warn("[trace] data-project-id 가 없어 수집을 시작하지 않습니다.");
    return;
  }

  start(options);
}

function inferEndpoint(src: string): string {
  try {
    return new URL(EVENTS_PATH, src).toString();
  } catch {
    return EVENTS_PATH;
  }
}

function normalizeConsent(value: string | undefined): Consent {
  return value === "denied" || value === "pending" ? value : "granted";
}
