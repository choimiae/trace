import { redactPatterns } from "@trace/shared/privacy";

/**
 * 1x1 투명 GIF. 빈 문자열로 두면 브라우저가 깨진 이미지 아이콘을 그려 재생
 * 화면이 원본과 달라진다.
 */
export const TRANSPARENT_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * rrweb 의 maskTextFn — 운영자가 마스킹 셀렉터로 지정한 노드를 전부 가린다.
 *
 * rrweb 2.0.0-alpha.4 의 실제 동작을 실측하고 고쳤다. 두 가지가 동시에 참이다
 * (rrweb-snapshot 의 serializeTextNode, 그리고 mutation 관찰자):
 *
 *   needsMask ? (maskTextFn ? maskTextFn(text) : text.replace(/[\S]/g, '*')) : text
 *
 *  1. maskTextFn 은 기본 마스킹을 보강하지 않고 **대체한다**.
 *  2. `needMaskingText()` 가 참인 노드 - 즉 운영자가 maskTextClass·
 *     maskTextSelector 로 지정한 노드 - 에만 불린다.
 *
 * 그래서 예전처럼 여기서 redactPatterns 를 돌리면 안 된다. 운영자가 "이건
 * 가려" 라고 지정한 노드인데 redactPatterns 는 패턴이 없는 텍스트(사람 이름·
 * 주소·병명)를 그대로 통과시켜, 결과적으로 **아무 마스킹도 걸리지 않았다** -
 * rrweb 기본 동작보다 나빴다. 지정된 것은 전부 가린다.
 *
 * 이 버전은 부모 엘리먼트를 넘겨주지 않는다(실측: 호출 인자 1개, 두 번째는
 * undefined). 그래서 이 안에서 "선택된 노드인가" 를 다시 판정할 방법이 없고,
 * 그럴 필요도 없다 - 불렸다는 사실 자체가 선택되었다는 뜻이다.
 *
 * 패턴 기반 제거는 선택되지 **않은** 노드까지 닿아야 하므로 여기가 아니라
 * redactEventText() 가 맡는다.
 */
export function maskText(text: string): string {
  // rrweb 기본값과 같은 모양으로 지운다. 공백을 남기는 것은 의도다 - 글자 수와
  // 줄 모양이 보존되어 재생 레이아웃이 원본과 어긋나지 않는다.
  return text.replace(/\S/g, "*");
}

const TEXT_CONTENT_KEY = "textContent";

/**
 * 직렬화된 rrweb 이벤트 안의 텍스트에 패턴 제거를 적용한다.
 *
 * maskTextFn 이 운영자 셀렉터에 걸린 노드만 본다는 사실의 반대쪽 짝이다.
 * 셀렉터에 걸리지 않은 노드의 이메일·전화번호는 maskTextFn 에 도달조차 하지
 * 않으므로, 직렬화가 끝난 뒤 여기서 한 번 더 훑는다. "구조가 놓친 것을 패턴이
 * 거른다" 는 실제로 이 함수가 하는 일이다 - maskText 는 그 일을 할 수 없다.
 *
 * 실측한 페이로드 모양 두 군데를 본다:
 *  - 직렬화된 텍스트 노드의 `textContent` — 스냅샷과 mutation 의 adds 양쪽에
 *    같은 모양으로 들어 있다.
 *  - mutation 의 `data.texts[].value` — 텍스트 노드가 정체성을 유지한 채
 *    내용만 바뀔 때는 adds 가 아니라 이쪽으로 온다.
 *
 * 키 이름만 보고 아무 `value` 나 건드리지 않는다 - 속성 변경이나 입력 이벤트의
 * value 까지 바꾸면 재생 화면이 원본과 달라진다. 그래서 `texts` 배열 안에서만
 * value 를 만진다.
 *
 * style 텍스트는 건너뛴다. CSS 본문에 9자리 이상 숫자가 흔한데(z-index·
 * 색상·좌표) 거기에 패턴을 돌리면 [redacted] 가 박혀 스타일시트가 깨진다.
 *
 * stripDataUris 와 같은 이유로 재귀가 아니라 스택으로 훑는다 - emit 콜백 안에서
 * 고객 페이지가 만든 임의 깊이의 트리를 도는데, 재귀는 깊은 트리에서
 * RangeError 로 죽고 그러면 그 이벤트의 마스킹이 통째로 스킵된다.
 */
export function redactEventText(value: unknown): void {
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;

    const textContent = record[TEXT_CONTENT_KEY];
    // isStyle 인 텍스트 노드는 화면 본문이 아니라 CSS 다.
    if (typeof textContent === "string" && record["isStyle"] !== true) {
      record[TEXT_CONTENT_KEY] = redactPatterns(textContent);
    }

    const texts = record["texts"];
    if (Array.isArray(texts)) {
      for (const entry of texts) {
        if (entry === null || typeof entry !== "object") continue;
        const text = entry as Record<string, unknown>;
        if (typeof text["value"] === "string") text["value"] = redactPatterns(text["value"]);
      }
    }

    for (const nested of Object.values(record)) stack.push(nested);
  }
}

const DATA_URI_PATTERN = /^\s*data:/i;
const SRCSET_DATA_URI_PATTERN = /(^|,)\s*data:/i;
const STRIPPED_ATTRIBUTES = ["src", "srcset", "href"] as const;

/**
 * rrweb 이벤트에서 data: URI 를 걷어낸다. 이 버전의 rrweb 에는 maskAttributeFn 이
 * 없어서(번들 grep 0회) 우리가 직접 훑는다.
 *
 * 스냅샷만 훑으면 새어 나간다 - 페이지가 나중에 붙이는 노드도 같은 base64 를
 * 싣고 오므로 mutation 이벤트까지 같은 함수로 훑는다. 그래서 rrweb 의 특정
 * 구조를 가정하지 않고 객체 트리 전체를 돈다.
 *
 * 실측 근거: 대상 앱 스냅샷 5,285,916 B 의 95%가 base64 이미지 145개였고,
 * 걷어내면 30,016 B 가 된다(176배).
 *
 * 재귀가 아니라 스택으로 훑는다. rrweb 의 emit 콜백 안에서 고객 페이지가
 * 만든 임의 깊이의 DOM 트리를 도는데, 재귀는 깊이만큼 네이티브 콜스택을
 * 먹어 깊은 트리에서 RangeError 로 죽는다 - 죽으면 그 이벤트의 마스킹이
 * 통째로 스킵된다. 순서는 상관없다(제자리 변형이라 방문 순서에 의존하는
 * 로직이 없다).
 */
export function stripDataUris(value: unknown): void {
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const name of STRIPPED_ATTRIBUTES) {
      const attribute = record[name];
      if (typeof attribute !== "string") continue;

      // srcset 은 콤마로 구분된 후보 목록이라 시작 앵커 패턴으로는 두 번째
      // 이후 후보의 data: 를 못 잡는다. 포함 여부만 보고 매치되면 목록
      // 전체를 자리표시자로 바꾼다 - 나머지 후보를 보존하는 부분 재구성은
      // 하지 않는다(파싱 위험 대비 재생 충실도 이득이 미미하다).
      const isDataUri = name === "srcset" ? SRCSET_DATA_URI_PATTERN.test(attribute) : DATA_URI_PATTERN.test(attribute);
      if (!isDataUri) continue;

      record[name] = name === "href" ? "" : TRANSPARENT_PLACEHOLDER;
    }

    for (const nested of Object.values(record)) stack.push(nested);
  }
}
