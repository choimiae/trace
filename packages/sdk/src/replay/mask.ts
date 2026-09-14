import { redactPatterns, redactUrl } from "@trace/shared/privacy";

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
 *  - `class`·`id` 는 구조 식별자지 산문이 아니다. inlineStylesheet:false 라
 *    재생기는 사이트의 진짜 스타일시트를 불러오는데, `class="row-987654321"` 을
 *    `row-[redacted]` 로 고쳐 쓰면 선택자가 안 맞아 화면이 달라진다.
 */
const SKIPPED_ATTRIBUTES = new Set(["style", "_cssText", "class", "id"]);

/**
 * URL 을 담는 속성. **경로는 그대로 두고 쿼리스트링만** 훑는다.
 *
 * 경로를 지키는 것이 애초에 이 속성들을 제외했던 이유다 - `/img/1234567890.jpg`
 * 나 `/orders/987654321` 의 긴 숫자가 [redacted] 로 바뀌면 자산이 깨지고 재생
 * 화면이 원본과 달라진다. 하지만 쿼리스트링은 지키려던 대상이 아니었고, 거기에
 * `?email=…&phone=…` 이 그대로 실려 나갔다.
 *
 * 프래그먼트(#)도 건드리지 않는다 - SVG 스프라이트(`sprite.svg#icon-123456789`)를
 * 고쳐 쓰면 그림이 안 나온다.
 */
const URL_ATTRIBUTES = new Set(["src", "srcset", "href", "poster", "data", "xlink:href"]);

/**
 * 값 안의 쿼리스트링 구간만 고른다. 공백에서 끊기므로 srcset 처럼 후보가 여럿인
 * 값에서도 후보마다 자기 쿼리만 훑고 다음 후보의 경로를 삼키지 않는다.
 * `?` 가 없으면 아무것도 매치하지 않아 값이 바이트 그대로 남는다.
 */
const URL_QUERY_PATTERN = /\?[^\s#]*/g;

function redactUrlAttribute(value: string): string {
  return value.replace(URL_QUERY_PATTERN, (query) => redactPatterns(query));
}

/**
 * **경로까지** 훑는 예외. 이 판정은 제외 목록(SKIPPED_ATTRIBUTES)보다도, URL
 * 분기(URL_ATTRIBUTES)보다도 앞에 선다 - 순서가 곧 예외의 내용이다.
 *
 * href 의 쿼리스트링은 이제 URL 분기가 훑는다. 그래도 이 둘이 따로 필요한 것은
 * 연락처가 쿼리가 아니라 **경로 자리**에 있기 때문이다 - `tel:010-1234-5678` 의
 * 번호도, `mailto:hong@example.com` 의 주소도 `?` 앞이라, 경로를 일부러 지키는
 * URL 분기에 맡기면 그대로 나간다. 연락처 스킴은 `/orders/987654321` 같은 자산
 * 경로가 아니므로 경로까지 훑어도 깨질 것이 없다. `https:` 같은 다른 스킴의
 * href 는 URL 분기가 맡는다 - 쿼리만 훑고 경로는 그대로 둔다.
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

    // 입력 이벤트의 data.text. rrweb 은 radio·checkbox 를 maskInputValue 에서
    // 일부러 빼고(그 분기는 도달 불가다), 하나를 누르면 **형제 전부**를
    // text: el.value 로 다시 내보낸다 - 고르지 않은 선택지의 값까지 함께.
    // 이벤트 스키마에서 사용자 텍스트가 실리는데 어떤 훑기도 닿지 않던 자리였다.
    // radio·checkbox 의 value 는 화면에 보이지 않으므로 훑어도 재생이 달라지지
    // 않고, 텍스트 입력 쪽은 이미 rrweb 이 가려 둔 뒤라 여기서는 무해하다.
    const text = record["text"];
    if (typeof text === "string") record["text"] = redactPatterns(text);

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
        // URL 속성은 쿼리만, 나머지는 값 전체를 훑는다.
        bag[name] = URL_ATTRIBUTES.has(name)
          ? redactUrlAttribute(attribute)
          : redactPatterns(attribute);
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
// src·srcset·href 만으로는 새어 나간다 - <video poster>, <object data>,
// <use xlink:href> 도 같은 base64 를 싣고 온다.
const STRIPPED_ATTRIBUTES = ["src", "srcset", "href", "poster", "data", "xlink:href"] as const;

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

/** rrweb 의 Meta 이벤트 타입 값. 페이지 URL·뷰포트를 담는다. */
const META_EVENT_TYPE = 4;

/**
 * Meta 이벤트가 싣고 나가는 **페이지 URL** 을 다른 이벤트와 같은 방식으로 줄인다.
 *
 * 이 URL 은 모든 기록의 첫 이벤트로, 그리고 체크포인트마다 다시 나간다. 제품의
 * 다른 모든 이벤트 종류는 redactUrl 을 거치는데(apps/api 의 수집 경로, 그리고
 * 옆의 uploader.ts 봉투) 리플레이 경로만 그것을 통째로 비켜 가고 있었다 -
 * `?email=…&phone=…` 이 쿼리에 그대로 실린 채로.
 *
 * 조합은 제품의 관례 그대로 `origin + urlPath + urlQueryRedacted` 다. 경로의
 * 식별자는 :id 로 정규화되고 쿼리 키는 안전한 것만 이름이 남는다.
 *
 * redactUrl 은 new URL(...) 을 그대로 부르므로 형식이 어긋나면 던진다. 던지거나
 * 조합 결과가 URL 로 파싱되지 않으면 **원문으로 되돌아가지 않는다** - 그러면
 * 막으려던 유출이 그대로 재현된다. uploader.ts 의 safeCurrentUrl 과 같은 자리,
 * 즉 지금 이 페이지의 origin 으로 물러난다(쿼리가 없으니 비밀이 섞일 수 없다).
 */
export function redactEventUrl(event: unknown): void {
  if (event === null || typeof event !== "object") return;

  const record = event as Record<string, unknown>;
  if (record["type"] !== META_EVENT_TYPE) return;

  const data = record["data"];
  if (data === null || typeof data !== "object") return;

  const bag = data as Record<string, unknown>;
  const href = bag["href"];
  if (typeof href !== "string") return;

  try {
    const redacted = redactUrl(href);
    const composed = `${redacted.origin}${redacted.urlPath}${redacted.urlQueryRedacted}`;
    new URL(composed);
    bag["href"] = composed;
  } catch {
    bag["href"] = window.location.origin;
  }
}
