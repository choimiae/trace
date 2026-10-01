import { CHECKPOINT_INTERVAL_MS } from "@trace/shared/recording-limits";
import { record } from "rrweb";
import type { ReplayBootConfig } from "../replay-config.js";
import { maskText, redactEventText, redactEventUrl, stripDataUris } from "./mask.js";
import { readNextSeq, writeNextSeq } from "./seq-store.js";
import { RecordingUploader, type RecordedEvent } from "./uploader.js";

const SDK_VERSION = "0.1.0";
const UPLOAD_INTERVAL_MS = 10_000;

/**
 * 실제로 컴파일되는 셀렉터만 남긴다.
 *
 * 운영자 셀렉터는 `isSafeMaskSelector` 를 통과해 저장되지만, 그 검사는 "파서를
 * 흔드는 문자가 없다" 까지다 - ".foo)" · "]" 처럼 문자 집합은 멀쩡하면서
 * CSS 파서가 던지는 문자열이 남는다. rrweb 의 needMaskingText 는 **모든 텍스트
 * 노드에서** closest 를 부르므로, 그중 하나가 던지면 스냅샷이 통째로 죽는다 -
 * 실측으로 나가는 이벤트가 Meta 하나뿐이고 FullSnapshot 도 mutation 도 없다.
 * 프로젝트 설정 한 줄로 기록이 조용히 멎는데, 마스킹을 보는 단언은 전부
 * 초록인 실패다.
 *
 * 그래서 치명적으로 두지 않고 **버린다.** 셀렉터 하나가 안 걸리는 것과 기록
 * 전체가 없어지는 것은 비교할 일이 아니다.
 *
 * 검사는 여기서 **한 번만** 돈다. 던질 수 있는 것은 `matches` 뿐이고 그것을
 * try/catch 로 감싼다 - 이 코드는 고객 사이트에서 돌므로 어떤 경로로도 던져
 * 나가면 안 된다. 문서를 훑는 querySelector 가 아니라 붙지 않은 노드의
 * `matches` 인 것은 같은 파서를 쓰면서 비용이 없기 때문이다.
 */
function compilableSelectors(selectors: string[]): string[] {
  if (typeof document === "undefined") return [];

  const probe = document.createElement("div");
  return selectors.filter((selector) => {
    try {
      probe.matches(selector);
      return true;
    } catch {
      return false;
    }
  });
}

export interface UploadSink {
  enqueue(events: RecordedEvent[]): void;
  flush(options?: { keepalive?: boolean }): Promise<boolean>;
}

export function startReplay(
  config: ReplayBootConfig,
  overrides: { uploader?: UploadSink } = {},
): () => void {
  // 주입 지점은 업로드 시점을 단위 테스트로 보기 위한 것이다. 실제 실행에서는 언제나 아래 기본값이 쓰인다.
  const uploader: UploadSink =
    overrides.uploader ??
    new RecordingUploader({
      endpoint: config.endpoint,
      projectId: config.projectId,
      sdkVersion: SDK_VERSION,
      // 같은 탭에서 페이지를 새로 불러오면 세션이 이어진다. 번호도 이어서 매겨야
      // 서버가 새 페이지의 조각을 앞 페이지 조각과 겹친 것으로 보고 버리지 않는다.
      firstSeq: readNextSeq(config.sessionId),
      onSeqClaimed: (next) => writeNextSeq(config.sessionId, next),
    });

  // 스냅샷에서 본 style 텍스트 노드의 id 를 세션 내내 들고 간다. rrweb 은
  // 나중에 같은 노드의 변경을 texts[] 로 내면서 style 이라는 표시를 붙이지
  // 않으므로, 이게 없으면 그 CSS 에 패턴 제거가 돌아 스타일이 깨진다.
  const styleTextNodeIds = new Set<number>();

  // 기록은 시작부터 계속 올린다. 모든 세션을 재생할 수 있어야 한다(제품 재정의
  // 2026-09-30). 대기열은 다음 주기까지 쌓인 이벤트뿐이다.
  let pending: RecordedEvent[] = [];
  const drain = (): RecordedEvent[] => {
    const drained = pending;
    pending = [];
    return drained;
  };
  const uploadTimer = setInterval(() => {
    uploader.enqueue(drain());
    void uploader.flush();
  }, UPLOAD_INTERVAL_MS);

  const stopRecording = record({
    emit(event: unknown) {
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
      pending.push(recorded);
    },
    // 주기적 전체 스냅샷은 계속 남긴다. 청크 하나가 유실돼도 다음
    // 스냅샷부터 재생을 이어 갈 수 있다. 대역폭 비용(스냅샷을 자주 올린다)은
    // ② 단계에서 다시 따진다.
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
    // 우리가 앞에 얹는 "textarea" 는 언제나 유효하다. 운영자 셀렉터는
    // compilableSelectors 가 걸러 이 자리에 컴파일되는 것만 온다 - 관리자 쪽
    // 검증(isSafeMaskSelector)은 문자 집합만 보므로 ".foo)" 같은 것이 통과한다.
    // 전부 걸러져도 "textarea" 가 남아 빈 문자열이 되지 않는다(빈 문자열이면
    // rrweb 이 `if (maskTextSelector)` 에서 거짓으로 보고 게이트를 통째로 연다).
    maskTextSelector: ["textarea", ...compilableSelectors(config.maskSelectors)].join(","),
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
    uploader.enqueue(drain());
    // 페이지를 떠나는 마지막 한 번만 keepalive 다.
    void uploader.flush({ keepalive: true });
  };
  window.addEventListener("pagehide", onPageHide);

  return () => {
    stopRecording?.();
    window.removeEventListener("pagehide", onPageHide);
    clearInterval(uploadTimer);
  };
}

// `!window.__traceReplayStop` 은 "이미 기록기가 돌고 있으면 시작하지 않는다" 다.
//
// 이미 내려받기 시작한 <script> 는 DOM 에서 떼어도 실행이 취소되지 않는다.
// 그래서 deny() 직후의 grant() 에서는 늦게 도착한 앞 스크립트와 새로 주입한
// 스크립트가 **둘 다** 실행된다. 뒤엣것이 그대로 시작하면 아래 대입이 앞
// 기록기의 정리 함수를 덮어써서, 그 기록기를 멈출 방법이 영영 사라진다 -
// 동의를 철회해도 계속 담고 올리는, 동의 게이트가 조용히 실패하는 그 모양이다.
// 고아 기록기는 자기 pagehide keepalive 와 seq 0 부터 다시 시작하는 업로더까지
// 들고 있고, 서버의 (session_id, seq) INSERT OR IGNORE 가 그 중복을 말없이 덮는다.
//
// 정당한 재시작은 그대로 산다. stopReplay 는 __traceReplayStop 을 **지운 뒤에**
// 표식을 걷으므로, deny 다음의 grant 가 주입한 스크립트는 이 검사를 통과한다.
if (typeof window !== "undefined" && window.__traceReplay && !window.__traceReplayStop) {
  // 정리 함수를 window 에 남긴다. 기본 번들은 이 리플레이 번들을 import 할 수
  // 없으므로(따로 로드된다), consent.deny() 가 기록을 멈출 다리가 이것뿐이다.
  window.__traceReplayStop = startReplay(window.__traceReplay);
}

export type { ReplayBootConfig };
