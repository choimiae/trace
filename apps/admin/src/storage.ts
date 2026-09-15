const PROJECT_STORAGE_KEY = "trace.selectedProjectId";
const PREVIEW_LABELS_STORAGE_KEY = "trace.previewLabels";

export function readSelectedProjectId(): string | undefined {
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeSelectedProjectId(projectId: string): void {
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
  } catch {
    // 브라우저가 저장을 막아도 대시보드는 동작해야 한다.
  }
}

/**
 * 미리보기에서 화면 글자를 보여줄지. 기본은 꺼짐이다 — 저장된 값이 없을 때
 * 켜진 채로 열리면 운영자가 고르지 않았는데 화면의 이름들이 드러난다.
 */
export function readPreviewLabels(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_LABELS_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writePreviewLabels(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREVIEW_LABELS_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // 브라우저가 저장을 막아도 대시보드는 동작해야 한다.
  }
}
