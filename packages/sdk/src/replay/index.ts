import { CHECKPOINT_INTERVAL_MS } from "@trace/shared/recording-limits";
import { record } from "rrweb";
import { CheckpointBuffer, type RecordedEvent } from "./buffer.js";
import { maskText, redactEventText, redactEventUrl, stripDataUris } from "./mask.js";
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
  // 스냅샷에서 본 style 텍스트 노드의 id 를 세션 내내 들고 간다. rrweb 은
  // 나중에 같은 노드의 변경을 texts[] 로 내면서 style 이라는 표시를 붙이지
  // 않으므로, 이게 없으면 그 CSS 에 패턴 제거가 돌아 스타일이 깨진다.
  const styleTextNodeIds = new Set<number>();

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
      redactEventText(recorded, styleTextNodeIds);
      // Meta 가 싣는 페이지 URL. 제품의 다른 모든 이벤트는 redactUrl 을 거치는데
      // 리플레이 경로만 비켜 가고 있었다 - 그것도 모든 기록의 첫 이벤트에서.
      redactEventUrl(recorded);
      buffer.push(recorded, isCheckout === true);

      const data = recorded.data as { source?: number } | undefined;
      if (recorded.type === INCREMENTAL_SNAPSHOT && data?.source === MUTATION_SOURCE) {
        triggers.notifyMutation();
      }
    },
    checkoutEveryNms: CHECKPOINT_INTERVAL_MS,
    // maskAllInputs: true 가 아니라 명시 집합인 것이 중요하다. 그 플래그가
    // 펼쳐지는 집합에는 **"input" 태그명 키가 없다** - type 이름들(text·email·
    // tel…)과 textarea·select·password 뿐이다. 그런데 rrweb 의 스냅샷 경로는
    // HTML **type 속성**으로 마스킹 여부를 가르고(maskInputValue 는 태그명만
    // 소문자로 내린다), 그래서 type 속성이 없거나·hidden 이거나·대문자(TEXT)면
    // 값이 그대로 직렬화됐다. 증분 경로는 DOM 의 type *프로퍼티*를 읽어
    // 멀쩡했으므로, 입력에 타이핑하는 테스트는 초록인 채 **모든 기록의 첫
    // 이벤트**가 샜다.
    //
    // "input" 은 태그명 키라 스냅샷 게이트와 관찰자 게이트를 한 번에 닫는다 -
    // type 이 무엇이든(없어도) <input> 이면 가려진다. submit·button·radio·
    // checkbox 는 rrweb 이 값 마스킹 대상에서 미리 빼므로 버튼 라벨은 그대로
    // 보인다.
    maskInputOptions: {
      input: true,
      textarea: true,
      select: true,
      password: true,
    },
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
