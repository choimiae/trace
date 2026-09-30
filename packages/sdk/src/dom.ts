import { isSafeElementRole, isSensitiveField, redactText } from "@trace/shared/privacy";
import { hash64Hex } from "@trace/shared/hash";

export interface ElementMetadata {
  elementSelectorHash?: string;
  elementRole?: string;
  elementTextMaskedOrLimited?: string;
}

const CONTENTEDITABLE_SELECTOR = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';
// select 의 option 라벨도 textContent 에 들어간다. <a><span>행 열기</span><select>
// <option>김철수</option></select></a> 처럼 사용자 데이터가 실린다.
const TEXT_ENTRY_SUBTREE_SELECTOR = `textarea, select, ${CONTENTEDITABLE_SELECTOR}`;

// input·textarea·contenteditable 내부 텍스트는 저장하지 않는다.
function isTextEntryElement(element: Element): boolean {
  if (element.tagName.toLowerCase() === "textarea") return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  // jsdom 은 isContentEditable 을 상속하지 않고, SVG 자손은 HTMLElement 도 아니다.
  // 편집 영역 안의 텍스트는 어느 자손이 담고 있어도 사용자가 쓴 내용이므로 조상을 본다.
  return element.closest(CONTENTEDITABLE_SELECTOR) !== null;
}

// textContent 는 자손을 포함한다. isTextEntryElement 는 요소 자신과 조상만 보므로,
// 화이트리스트 요소(예: <h1>, <a>) 안에 편집 가능 자손이나 textarea·select 가
// 있으면 그 안의 글자가 textContent 를 통해 새어 나간다. 요소 전체를 건너뛰는
// 쪽이 텍스트 노드를 걸러내는 것보다 단순하고 안전하다 — 제목 일부를 잃더라도.
// 자신과 자손을 모두 본다. querySelector 는 자신을 매칭하지 않으므로, 이걸
// 자손만으로 두면 <select> 를 직접 클릭했을 때 option 라벨이 타겟 경로로 새어나간다.
function containsTextEntrySubtree(element: Element): boolean {
  return element.matches(TEXT_ENTRY_SUBTREE_SELECTOR) || element.querySelector(TEXT_ENTRY_SUBTREE_SELECTOR) !== null;
}

// 텍스트를 쓸지 정한 뒤에만 부른다. textContent 는 자손을 모두 이어 붙인 문자열이고
// redactText 는 그 위로 전역 정규식 3개를 돌리므로, <main> 같은 화면 크기 컨테이너에서
// 미리 계산하면 버릴 문자열에 클릭당 밀리초를 쓴다(200KB 에서 2ms, 600KB 에서 5.4ms).
// containsTextEntrySubtree 의 서브트리 순회도 같은 이유로 이 안에 둔다.
function allowedElementText(element: Element): string | undefined {
  const sensitive =
    isTextEntryElement(element) ||
    containsTextEntrySubtree(element) ||
    isSensitiveField({
      tagName: element.tagName,
      type: element instanceof HTMLInputElement ? element.type : "",
      name: element instanceof HTMLInputElement ? element.name : "",
      id: element.id,
    });
  if (sensitive) return undefined;

  const text = redactText((element.textContent || element.getAttribute("aria-label") || "").trim());
  return text.length === 0 ? undefined : text;
}

export function getElementMetadata(element: Element): ElementMetadata {
  const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
  const selector = buildSelector(element);
  const text = allowedElementText(element);

  return {
    elementSelectorHash: hash64Hex(selector),
    elementRole: role,
    ...(text === undefined ? {} : { elementTextMaskedOrLimited: text }),
  };
}

// 조상은 3단까지만 본다. 더 올라가면 페이지 껍데기가 지문을 지배해 판별력이 떨어지고,
// 얕으면 서로 다른 영역의 같은 컨트롤을 못 가른다.
const ANCESTOR_DEPTH = 3;
// 개발자가 쓴 값만 넣는다. 사용자 텍스트(aria-label·textContent)는 행마다 달라져
// 목록 행을 갈라 버리고, 클래스는 CSS 모듈·빌드 해시로 배포마다 바뀐다.
const STABLE_ATTRIBUTES = ["data-trace-id", "data-testid", "name", "type"] as const;
const ATTRIBUTE_VALUE_LIMIT = 64;

// React useId 는 `:r1:` 처럼 콜론을 포함한 id 를 렌더마다 새로 만든다. 그 id 를
// 지문에 넣으면 같은 버튼이 렌더마다 다른 요소 키로 갈려 같은 요소가 수없이 쪼개진다.
// 콜론을 쓰지 않는 다른 생성기(무작위 UUID 등)는 이 가드가 잡지 못한다.
function stableId(element: Element): string {
  return element.id && !element.id.includes(":") ? `#${element.id}` : "";
}

function ancestorChain(element: Element): string {
  const root = element.ownerDocument.documentElement;
  const tags: string[] = [];
  let current = element.parentElement;

  for (let depth = 0; depth < ANCESTOR_DEPTH && current && current !== root; depth += 1) {
    tags.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }

  return tags.length === 0 ? "" : `${tags.join(">")}>`;
}

// 고정 순서로 이어 붙인다. 순서가 흔들리면 같은 요소가 다른 문자열을 만들어
// 지문이 불안정해진다.
function stableAttributes(element: Element): string {
  let attributes = "";

  for (const name of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    attributes += `[${name}="${value.slice(0, ATTRIBUTE_VALUE_LIMIT)}"]`;
  }

  return attributes;
}

function buildSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");

  return `${ancestorChain(element)}${tag}${stableId(element)}${stableAttributes(element)}${
    role ? `[role="${role}"]` : ""
  }`;
}
