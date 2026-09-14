import type { ReplayBootConfig } from "./replay-config.js";

interface ConfigResponse {
  ok: boolean;
  json: () => Promise<unknown>;
}

/**
 * 설정을 받아, 리플레이가 켜진 프로젝트에만 리플레이 번들을 주입한다.
 *
 * "설정이 도착하기 전에는 기록을 시작하지 않는다" 가 여기서 구조적으로
 * 보장된다 - 설정이 오기 전에는 번들 자체를 내려받지 않으므로 시작될 수가
 * 없다. 마스킹 셀렉터를 모르는 채로 기록하면 가려야 할 자리가 버퍼에 원문으로
 * 들어가고, 나중에 설정이 와도 이미 늦다.
 */
export async function loadReplay(options: {
  projectId: string;
  sessionId: string;
  endpoint: string;
  fetcher?: (input: string) => Promise<ConfigResponse>;
  documentRef?: Document;
}): Promise<boolean> {
  const doc = options.documentRef ?? document;
  const fetcher = options.fetcher ?? ((input: string) => fetch(input));

  let config: { replay?: unknown; maskSelectors?: unknown };
  try {
    const response = await fetcher(resolve(`/v1/projects/${options.projectId}/config`, options.endpoint));
    if (!response.ok) return false;
    config = (await response.json()) as typeof config;
  } catch {
    // 수집 서버가 죽어 있어도 고객 사이트는 멀쩡해야 한다.
    return false;
  }

  if (config?.replay !== true) return false;

  const boot: ReplayBootConfig = {
    projectId: options.projectId,
    sessionId: options.sessionId,
    endpoint: resolve(`/v1/sessions/${options.sessionId}/recording`, options.endpoint),
    maskSelectors: Array.isArray(config.maskSelectors) ? (config.maskSelectors as string[]) : [],
  };
  window.__traceReplay = boot;

  const script = doc.createElement("script");
  // trace.js 와 같은 출처다 - 고객 CSP 에 새로 추가할 항목이 없다.
  script.src = resolve("/trace-replay.js", options.endpoint);
  script.async = true;
  doc.head.appendChild(script);
  return true;
}

// endpoint 가 상대 경로로 떨어진 경우(install.ts 의 inferEndpoint 폴백)에는
// new URL 이 던진다. 그때는 같은 출처의 상대 경로를 그대로 쓴다.
function resolve(path: string, base: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}
