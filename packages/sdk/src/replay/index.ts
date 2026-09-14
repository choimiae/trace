import { CHECKPOINT_INTERVAL_MS } from "@trace/shared/recording-limits";
import { record } from "rrweb";
import { CheckpointBuffer, type RecordedEvent } from "./buffer.js";
import { maskText, redactEventText, stripDataUris } from "./mask.js";
import { installTriggers } from "./triggers.js";
import { RecordingUploader } from "./uploader.js";

const SDK_VERSION = "0.1.0";
const UPLOAD_INTERVAL_MS = 10_000;

// rrweb 의 이벤트 종류. 숫자를 그대로 쓰는 것은 enum 을 import 하면 번들에
// 런타임 객체가 하나 더 들어가기 때문이다.
const INCREMENTAL_SNAPSHOT = 3;
const MUTATION_SOURCE = 0;

export interface ReplayBootConfig {
  projectId: string;
  sessionId: string;
  endpoint: string;
  maskSelectors: string[];
}

export interface UploadSink {
  enqueue(events: RecordedEvent[]): void;
  flush(options?: { keepalive?: boolean }): Promise<boolean>;
}

export function startReplay(
  config: ReplayBootConfig,
  overrides: { uploader?: UploadSink } = {},
): () => void {
  const buffer = new CheckpointBuffer();
  // 주입 지점을 둔 이유는 "트리거 전에는 아무것도 전송되지 않는다" 를 단위
  // 테스트로 못박기 위해서다. 실제 실행에서는 언제나 아래 기본값이 쓰인다.
  const uploader: UploadSink =
    overrides.uploader ??
    new RecordingUploader({
      endpoint: config.endpoint,
      projectId: config.projectId,
      sdkVersion: SDK_VERSION,
    });

  let triggered = false;
  let uploadTimer: ReturnType<typeof setInterval> | undefined;

  const triggers = installTriggers(window, {
    onTrigger: () => {
      // 세션당 한 번만 걸린다. 분노 클릭이 반복돼도 업로드가 배로 늘지 않고,
      // 그 뒤로는 아래 타이머가 이어 올린다.
      if (triggered) return;
      triggered = true;
      // 트리거 뒤에는 계속 이어 올린다. 문제가 난 뒤에 무슨 일이 있었는지가
      // 종종 더 중요하다.
      buffer.stopDiscarding();
      uploader.enqueue(buffer.drain());
      void uploader.flush();
      uploadTimer = setInterval(() => {
        uploader.enqueue(buffer.drain());
        void uploader.flush();
      }, UPLOAD_INTERVAL_MS);
    },
  });

  const stopRecording = record({
    emit(event: unknown, isCheckout?: boolean) {
      const recorded = event as RecordedEvent;
      // 스냅샷이든 mutation 이든 같은 함수로 훑는다 - 페이지가 나중에 붙이는
      // 노드도 base64 를 싣고 온다.
      stripDataUris(recorded);
      // 운영자 셀렉터에 걸린 노드는 rrweb 이 maskTextFn(=maskText)으로 이미
      // 전부 가렸다. 여기서 훑는 것은 셀렉터에 걸리지 않은 나머지다 -
      // maskTextFn 은 걸린 노드에만 불리므로 그쪽 텍스트는 도달조차 하지 않는다.
      redactEventText(recorded);
      buffer.push(recorded, isCheckout === true);

      const data = recorded.data as { source?: number } | undefined;
      if (recorded.type === INCREMENTAL_SNAPSHOT && data?.source === MUTATION_SOURCE) {
        triggers.notifyMutation();
      }
    },
    checkoutEveryNms: CHECKPOINT_INTERVAL_MS,
    maskAllInputs: true,
    maskTextFn: maskText,
    // 빈 문자열을 넘기면 rrweb 안에서 querySelectorAll 이 던진다.
    ...(config.maskSelectors.length > 0
      ? { maskTextSelector: config.maskSelectors.join(",") }
      : {}),
    inlineStylesheet: false,
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
    slimDOMOptions: {
      script: true,
      comment: true,
      headFavicon: true,
      headWhitespace: true,
      headMetaSocial: true,
      headMetaRobots: true,
      headMetaHttpEquiv: true,
      headMetaVerification: true,
    },
  } as Parameters<typeof record>[0]);

  const onPageHide = () => {
    if (!triggered) return;
    uploader.enqueue(buffer.drain());
    // 페이지를 떠나는 마지막 한 번만 keepalive 다.
    void uploader.flush({ keepalive: true });
  };
  window.addEventListener("pagehide", onPageHide);

  return () => {
    stopRecording?.();
    triggers.dispose();
    window.removeEventListener("pagehide", onPageHide);
    if (uploadTimer !== undefined) clearInterval(uploadTimer);
  };
}

declare global {
  interface Window {
    __traceReplay?: ReplayBootConfig;
  }
}

if (typeof window !== "undefined" && window.__traceReplay) {
  startReplay(window.__traceReplay);
}
