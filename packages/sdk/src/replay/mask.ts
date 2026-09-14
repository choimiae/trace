import { redactPatterns } from "@trace/shared/privacy";

/**
 * 1x1 투명 GIF. 빈 문자열로 두면 브라우저가 깨진 이미지 아이콘을 그려 재생
 * 화면이 원본과 달라진다.
 */
export const TRANSPARENT_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * rrweb 의 maskTextFn. 구조(maskAllInputs·maskTextSelector)가 놓친 것을 패턴으로
 * 한 번 더 거른다. redactText 가 아니라 redactPatterns 를 쓰는 것은 의도다 -
 * 120자 자르기가 화면 본문을 조용히 잘라 재생이 원본과 달라진다.
 */
export function maskText(text: string): string {
  return redactPatterns(text);
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
