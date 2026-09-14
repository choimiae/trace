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
 * 걷어내면 30,016 B 가 된다(187배).
 */
export function stripDataUris(value: unknown): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) stripDataUris(item);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const name of STRIPPED_ATTRIBUTES) {
    const attribute = record[name];
    if (typeof attribute === "string" && DATA_URI_PATTERN.test(attribute)) {
      record[name] = name === "href" ? "" : TRANSPARENT_PLACEHOLDER;
    }
  }

  for (const nested of Object.values(record)) stripDataUris(nested);
}
