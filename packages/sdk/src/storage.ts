// Trace 가 브라우저 저장소에 두는 키. 동의를 거부하면 이 키들만 지운다.
export const SESSION_KEY = "trace:session";
export const VISITOR_KEY = "trace:visitor";
export const REPLAY_SEQ_KEY = "trace:replay-seq";

export type StorageArea = "session" | "local";

// 저장소는 접근만으로 던질 수 있다 — 쿠키를 막은 브라우저와 샌드박스 iframe 에서는
// window.sessionStorage 를 읽는 순간 SecurityError 가 나고, 쓰기는 용량 초과로 던진다.
// 수집 때문에 고객 사이트가 깨지면 안 되므로 전부 삼키고, 읽기 실패는 "없음" 으로 본다.
function storageFor(area: StorageArea): Storage | undefined {
  try {
    return area === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readItem(area: StorageArea, key: string): string | undefined {
  try {
    return storageFor(area)?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeItem(area: StorageArea, key: string, value: string): boolean {
  try {
    const storage = storageFor(area);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(area: StorageArea, key: string): void {
  try {
    storageFor(area)?.removeItem(key);
  } catch {
    // 지우지 못해도 수집은 이미 멈췄다. 고객 사이트로 오류를 흘리지 않는다.
  }
}
