import { CHECKPOINT_INTERVAL_MS } from "@trace/shared/recording-limits";
import { record } from "rrweb";
import type { ReplayBootConfig } from "../replay-config.js";
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
    // 운영자 셀렉터 **앞에 textarea 를 언제나 붙인다.**
    //
    // rrweb 은 textarea 의 값을 `attributes.value` 로만 가린다. HTML 에 적혀 온
    // 초기 내용은 그와 별개로 **자식 텍스트 노드**에 실려 나가는데,
    // serializeTextNode 에는 textarea 예외가 없다(2.0.0-alpha.4). 실제 브라우저에서
    // 확인한 모양이다 - 저장된 청크 안에 `value:"*****…"` 바로 옆으로
    // `textContent:"김철수 담당자 연락처 …"` 가 앉아 있었다. 타이핑한 글자가 아니라
    // **서버가 채워 그린 값**이라, 저장값을 렌더하는 폼이면 그대로 나간다.
    //
    // 우리 쪽에서 직렬화 뒤에 훑지 않고 여기서 막는 이유는 needMaskingText 가
    // 텍스트 노드의 **부모 엘리먼트**를 셀렉터에 맞춰 보기 때문이다. 스냅샷
    // (serializeTextNode)과 mutation 의 characterData·adds 가 전부 같은 게이트를
    // 지나므로 셀렉터 한 줄이 네 경로를 한꺼번에 닫는다. 직렬화 뒤에 훑는 길을
    // 골랐다면 texts[] 로 오는 변경을 알아보려고 노드 id 를 세션 내내 들고
    // 다녀야 했다 - styleTextNodeIds 가 그 대가를 이미 치르고 있다.
    //
    // 재생 충실도로 잃는 것이 없다. 재생기는 rebuild 에서 textarea 의 자식 텍스트
    // 노드를 **전부 지우고 value 로 덮어쓴다**(rrweb-snapshot :1590). 가리기
    // 전에도 재생 화면에 나오지 않던 글자다.
    //
    // 조건부 전개는 없앴다. 이 값이 이제 비지 않는다는 것이 이유이고, **원래
    // 주석이 적은 이유는 사실이 아니었다** - "빈 문자열을 넘기면 rrweb 이
    // 던진다" 는 성립하지 않는다. needMaskingText 는 `if (maskTextSelector)` 로
    // 감싸 두어서(rrweb-snapshot :375) 빈 문자열은 그냥 거짓이다. 아무것도
    // 던지지 않고, 텍스트가 **안 가려질** 뿐이다.
    //
    // 실제로 던지는 것은 비어 있지 않은 **잘못된** 셀렉터다 - 끝에 쉼표가 붙은
    // "textarea," 같은 것. matches/closest 가 SyntaxError 를 내는데
    // needMaskingText 는 모든 텍스트 노드에서 불리므로 스냅샷이 통째로 죽는다
    // (실측: Meta 이벤트 하나만 나가고 FullSnapshot 이 아예 없다). 기록이
    // 조용히 멎는데 not.toContain(비밀) 류의 단언은 전부 초록인 실패다.
    //
    // 우리가 앞에 얹는 "textarea" 는 언제나 유효하므로 이 줄이 그 위험을 새로
    // 만들지는 않는다. 운영자 셀렉터가 검증 없이 들어오는 것은 그 전부터 있던
    // 문제이고, 막을 자리는 관리자 쪽 셀렉터 검증이다.
    maskTextSelector: ["textarea", ...config.maskSelectors].join(","),
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

if (typeof window !== "undefined" && window.__traceReplay) {
  startReplay(window.__traceReplay);
}

export type { ReplayBootConfig };
