export interface ReplayBootConfig {
  projectId: string;
  sessionId: string;
  /** 기록 수집 엔드포인트(전체 URL). */
  endpoint: string;
  maskSelectors: string[];
}

declare global {
  interface Window {
    __traceReplay?: ReplayBootConfig;
  }
}
