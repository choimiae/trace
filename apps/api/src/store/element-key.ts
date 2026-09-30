import { hash64Hex, type TraceEvent } from "@trace/shared";

// 기능 하나를 가리키는 키. 선택자 해시만으로는 부족하다 — 구조와 속성이 같고
// 적힌 글자만 다른 버튼이 나란히 놓이는 일이 흔하다. 글자는 이미 마스킹·절단돼
// 저장되므로 새로 모을 것이 없다. 구분자는 마스킹된 글자에 나올 수 없는 NUL 이라
// 두 필드의 경계가 겹치지 않는다.
export function elementKey(event: TraceEvent): string | undefined {
  if (!event.elementSelectorHash) return undefined;
  return hash64Hex(`${event.elementSelectorHash}\u0000${event.elementTextMaskedOrLimited ?? ""}`);
}
