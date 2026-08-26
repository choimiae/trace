const PROJECT_STORAGE_KEY = "trace.selectedProjectId";

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
