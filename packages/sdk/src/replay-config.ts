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
    /**
     * 돌고 있는 기록기를 멈추는 함수. 리플레이 번들이 시작하면서 여기에 남긴다.
     *
     * 두 번들은 따로 로드되어 서로를 import 할 수 없으므로, 기본 번들이
     * `consent.deny()` 에서 기록을 멈추려면 이 전역이 유일한 다리다.
     */
    __traceReplayStop?: () => void;
  }
}
