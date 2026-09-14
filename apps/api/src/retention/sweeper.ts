import type { TraceStore } from "../store/types.js";
import type { SessionRecordingRetentionConfig } from "./config.js";
import { runSessionRecordingRetention } from "./recordings.js";

/**
 * 주기적 보존 스윕의 간격.
 *
 * 보존은 그동안 부팅(`server.ts`)과 업로드(`routes/recording.ts`)에서만 돌았다.
 * 그런데 기록은 운영자가 리플레이를 **끄는 순간** 끊긴다 - 데이터가 사라지기를
 * 기대하는 바로 그 시점이다. 오래 사는 프로세스는 그때부터 7일 지난 기록을
 * 무기한 쥐고 있게 된다.
 *
 * 한 시간인 것은 보존 단위가 날이기 때문이다. 더 촘촘히 돌 이유가 없고, 스윕
 * 한 번은 인덱스를 탄 DELETE 하나다.
 */
export const SESSION_RECORDING_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 세션 기록 보존을 주기적으로 돌린다. 멈추는 함수를 돌려준다.
 *
 * 스윕은 어떤 이유로도 프로세스를 내리지 않는다 - `setInterval` 콜백에서 던진
 * 예외나 그대로 둔 거절 Promise 는 Node 에서 곧바로 프로세스 종료다. 디스크가
 * 잠깐 흔들린 것 때문에 수집 전체가 멈추는 것보다, 이번 주기를 건너뛰고 다음에
 * 다시 도는 편이 낫다.
 */
export function startSessionRecordingRetentionSweep(options: {
  store: TraceStore;
  config: SessionRecordingRetentionConfig;
  now?: (() => Date) | undefined;
  intervalMs?: number | undefined;
}): () => void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        await runSessionRecordingRetention(
          options.store,
          options.config,
          options.now?.() ?? new Date(),
        );
      } catch {
        /* 다음 주기에 다시 시도한다 */
      }
    })();
  }, options.intervalMs ?? SESSION_RECORDING_SWEEP_INTERVAL_MS);

  // 이 타이머 하나 때문에 프로세스가 살아 있을 이유는 없다. API 테스트는 app 을
  // 만들기만 하고 닫지 않는 경우가 많아서, unref 가 없으면 테스트 실행이
  // 붙들린다. 닫는 경로는 아래 반환 함수(app 의 onClose)가 따로 맡는다.
  timer.unref?.();

  return () => clearInterval(timer);
}
