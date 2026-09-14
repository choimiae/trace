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
 * 패턴을 돌리면 안 되는 속성.
 *  - `style`·`_cssText` 는 CSS 다. 9자리 이상 숫자가 흔해서(z-index·좌표·색)
 *    훑으면 [redacted] 가 박혀 스타일이 깨진다 - 텍스트 노드의 isStyle 예외와
 *    같은 이유다.
 *  - `src`·`srcset` 은 stripDataUris 가 이미 책임진다. 여기서 또 만지면 긴 숫자를
 *    담은 자산 경로(/img/1234567890.jpg)가 통째로 바뀌어 재생 화면이 원본과
 *    달라진다. `href` 도 같은 이유로 기본은 제외지만 아래 예외가 하나 있다.
 */
const SKIPPED_ATTRIBUTES = new Set(["style", "_cssText", "src", "srcset", "href"]);

/**
 * `href` 제외의 구멍을 메우는 예외. `mailto:`·`tel:` 은 연락처를 그대로 싣는
 * 스킴이고, 경로처럼 생기지 않아 긴 숫자를 깨뜨릴 위험이 없다 - 그래서 이 둘만
 * 훑는다. `https:` 같은 다른 스킴의 href 는 계속 손대지 않는다(/orders/987654321).
 *
 * 값이 어느 속성에 들어 있든 같은 판정을 쓴다 - 속성 이름이 아니라 값의 스킴을
 * 보므로 `data-*` 에 담긴 `tel:` 도 함께 잡힌다.
 *
 * 둘의 처리가 다르다:
 *  - `tel:` 은 **스킴 뒤를 통째로 지운다.** 스킴 자체가 "이 값은 전화번호" 를
 *    보장하므로 패턴으로 고르는 것은 언제나 이보다 약하다 - 공용 PHONE_PATTERN 은
 *    한국 휴대폰 형태(01[016789])를 겨냥해서 대표번호(1588-1234)나 국제 번호를
 *    지나치고, `+82-` 형태에서는 앞의 `+` 를 남긴다. 정의상 전화번호인 필드를
 *    한국 휴대폰용 정규식에 맡길 이유가 없다.
 *  - `mailto:` 는 `redactPatterns` 그대로다. EMAIL_PATTERN 이 주소를 확실히
 *    걷어내고, 쿼리(`?subject=…`)에는 지울 이유가 없는 화면 맥락이 들어온다.
 */
const TEL_SCHEME_PATTERN = /^\s*tel:/i;
const MAILTO_SCHEME_PATTERN = /^\s*mailto:/i;

/** redactPatterns 가 쓰는 표식과 같은 값. 그 상수는 공용 모듈 밖으로 나오지 않는다. */
const REDACTED = "[redacted]";

/**
 * 직렬화된 rrweb 이벤트 안의 텍스트에 패턴 제거를 적용한다.
 *
 * maskTextFn 이 운영자 셀렉터에 걸린 노드만 본다는 사실의 반대쪽 짝이다.
 * 셀렉터에 걸리지 않은 노드의 이메일·전화번호는 maskTextFn 에 도달조차 하지
 * 않으므로, 직렬화가 끝난 뒤 여기서 한 번 더 훑는다. "구조가 놓친 것을 패턴이
 * 거른다" 는 실제로 이 함수가 하는 일이다 - maskText 는 그 일을 할 수 없다.
 *
 * 실측한 페이로드 모양 세 군데를 본다:
 *  - 직렬화된 텍스트 노드의 `textContent` — 스냅샷과 mutation 의 adds 양쪽에
 *    같은 모양으로 들어 있다.
 *  - mutation 의 `data.texts[].value` — 텍스트 노드가 정체성을 유지한 채
 *    내용만 바뀔 때는 adds 가 아니라 이쪽으로 온다.
 *  - 엘리먼트의 `attributes` — title·aria-label·alt·placeholder·data-* 가
 *    사용자 텍스트를 싣고 그대로 나간다. rrweb 의 needMaskingText 는 텍스트
 *    노드만 게이트하므로 운영자 셀렉터에 걸린 엘리먼트라도 속성은 안 가려진다.
 *
 * 키 이름만 보고 아무 `value` 나 건드리지 않는다 - 입력 이벤트의 value 까지
 * 바꾸면 재생이 원본과 달라진다. `texts` 배열 안과 속성 가방 안에서만 만진다.
 *
 * **style 예외는 두 경로 모두에 필요하다.** 텍스트 노드는 `isStyle` 로 알 수
 * 있지만, rrweb 의 characterData 관찰자는 같은 노드의 변경을 `texts[]` 로 내면서
 * isStyle 을 붙이지 않는다(실측: `.b{z-index:999999999}` 가
 * `.b{z-index:[redacted]}` 로 깨졌다). 그래서 스냅샷·adds 에서 본 style 텍스트
 * 노드의 **id** 를 `styleTextNodeIds` 에 적어 두고, texts[] 에서 그 id 를
 * 건너뛴다. 세션 하나가 Set 하나를 들고 이벤트 사이로 이어 간다.
 *
 * texts[] 처리를 walk 뒤로 미루는 것은 순서 때문이다 - 같은 이벤트 안에서
 * style 노드를 먼저 볼지 texts 를 먼저 볼지는 스택 순서에 달렸는데, 거기에
 * 판정이 흔들리면 안 된다.
 *
 * **id 재사용 가정(rrweb 을 올릴 때 다시 확인할 것).** 이 Set 은 "한번 style
 * 텍스트 노드였던 id 는 영영 다른 노드가 되지 않는다" 에 기댄다. 어긋나면 조용한
 * 유출이다 - 재사용된 id 의 노드가 패턴 훑기를 건너뛰어 그 안의 이메일이 원문 그대로
 * 나간다. rrweb 2.0.0-alpha.4 에서는 성립한다:
 *
 *   rrweb-snapshot/es/rrweb-snapshot.js:147  `var _id = 1;`
 *   rrweb-snapshot/es/rrweb-snapshot.js:150  `function genId() { return _id++; }`
 *
 * `_id` 에 쓰는 곳은 저 두 줄뿐이다 - 초기화와 후위 증가. 리셋도, 감소도, 반납
 * 목록도 없고 `genId()` 가 유일한 id 발급처다(호출 지점도 :807 하나).
 * `Mirror.removeNodeFromMap` 은 `idNodeMap` 에서 지우기만 할 뿐 id 를 어디에도
 * 돌려주지 않는다. 실측으로도 확인했다 - id 7 인 style 을 지우고 새 엘리먼트 5개를
 * 붙이니 11·13·14·15·16 을 받았다.
 *
 * stripDataUris 와 같은 이유로 재귀가 아니라 스택으로 훑는다 - emit 콜백 안에서
 * 고객 페이지가 만든 임의 깊이의 트리를 도는데, 재귀는 깊은 트리에서
 * RangeError 로 죽고 그러면 그 이벤트의 마스킹이 통째로 스킵된다.
 */
export function redactEventText(value: unknown, styleTextNodeIds: Set<number>): void {
  const stack: unknown[] = [value];
  const pendingTexts: Array<Record<string, unknown>> = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    const isStyleNode = record["isStyle"] === true;

    // style 텍스트 노드의 id 를 적어 둔다 - 나중에 texts[] 로 올 변경을 알아보려면
    // 이것뿐이다.
    const id = record["id"];
    if (isStyleNode && typeof id === "number") styleTextNodeIds.add(id);

    const textContent = record[TEXT_CONTENT_KEY];
    // isStyle 인 텍스트 노드는 화면 본문이 아니라 CSS 다.
    if (typeof textContent === "string" && !isStyleNode) {
      record[TEXT_CONTENT_KEY] = redactPatterns(textContent);
    }

    // 속성 가방. mutation 의 data.attributes 는 배열([{id, attributes}])이라
    // 여기서 걸러지고, 그 안의 각 항목을 walk 가 따로 방문해 처리한다.
    const attributes = record["attributes"];
    if (attributes !== null && typeof attributes === "object" && !Array.isArray(attributes)) {
      const bag = attributes as Record<string, unknown>;
      for (const name of Object.keys(bag)) {
        const attribute = bag[name];
        if (typeof attribute !== "string") continue;
        // 연락처 스킴이면 제외 목록보다 우선한다 - href 를 통째로 빼 두면
        // mailto:hong@example.com 이 그대로 나간다.
        const tel = TEL_SCHEME_PATTERN.exec(attribute);
        if (tel !== null) {
          // 스킴만 남기고 뒤는 전부 지운다. 번호 모양을 맞혀 볼 필요가 없다.
          bag[name] = `${tel[0]}${REDACTED}`;
          continue;
        }
        if (MAILTO_SCHEME_PATTERN.test(attribute)) {
          bag[name] = redactPatterns(attribute);
          continue;
        }
        if (SKIPPED_ATTRIBUTES.has(name)) continue;
        bag[name] = redactPatterns(attribute);
      }
    }

    const texts = record["texts"];
    if (Array.isArray(texts)) {
      for (const entry of texts) {
        if (entry === null || typeof entry !== "object") continue;
        pendingTexts.push(entry as Record<string, unknown>);
      }
    }

    for (const nested of Object.values(record)) stack.push(nested);
  }

  for (const entry of pendingTexts) {
    const id = entry["id"];
    if (typeof id === "number" && styleTextNodeIds.has(id)) continue;
    const text = entry["value"];
    if (typeof text === "string") entry["value"] = redactPatterns(text);
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
