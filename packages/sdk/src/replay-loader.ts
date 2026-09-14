import type { ReplayBootConfig } from "./replay-config.js";

interface ConfigResponse {
  ok: boolean;
  json: () => Promise<unknown>;
}

// 주입한 스크립트에 남기는 표식. 표식을 모듈 변수가 아니라 문서에 두는 이유는
// trace.js 태그가 두 개면 모듈 인스턴스도 두 개라 모듈 변수로는 서로를 볼 수
// 없기 때문이다 - 문서는 하나다. src 대신 전용 속성인 것은 두 태그의 endpoint 가
// 달라도 기록기는 하나여야 하기 때문이다.
const REPLAY_SCRIPT = "script[data-trace-replay]";

/**
 * 설정을 받아, 리플레이가 켜진 프로젝트에만 리플레이 번들을 주입한다.
 *
 * "설정이 도착하기 전에는 기록을 시작하지 않는다" 가 여기서 구조적으로
 * 보장된다 - 설정이 오기 전에는 번들 자체를 내려받지 않으므로 시작될 수가
 * 없다. 마스킹 셀렉터를 모르는 채로 기록하면 가려야 할 자리가 버퍼에 원문으로
 * 들어가고, 나중에 설정이 와도 이미 늦다.
 *
 * 한 문서에 한 번만 주입한다. 두 번째 주입은 기록기·업로드 타이머·DOM 리스너를
 * 통째로 하나 더 만들어 수집량을 배로 늘리고 재생 데이터를 겹치게 한다.
 * 이미 붙어 있으면 false 를 돌려준다(주입하지 않았다는 뜻이다).
 */
export async function loadReplay(options: {
  projectId: string;
  sessionId: string;
  endpoint: string;
  fetcher?: (input: string) => Promise<ConfigResponse>;
  documentRef?: Document;
}): Promise<boolean> {
  const doc = options.documentRef ?? (typeof document === "undefined" ? undefined : document);
  // 붙일 곳이 없으면(DOM 없는 환경) 시작할 것도 없다.
  if (!doc) return false;
  // 설정 요청보다 먼저 본다 - 받아 놓고 안 쓰느니 보내지 않는 편이 낫다.
  if (doc.querySelector(REPLAY_SCRIPT)) return false;

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
  // 설정을 기다리는 동안 다른 호출이 먼저 붙였을 수 있다. 부트 설정을 덮어쓰기
  // 전에 다시 본다 - 이미 돌고 있는 기록기가 읽은 값이다.
  if (doc.querySelector(REPLAY_SCRIPT)) return false;

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
  // 표식은 붙이는 순간 함께 단다. appendChild 뒤에 달면 그 사이에 낀 호출이 놓친다.
  script.dataset.traceReplay = "";
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
