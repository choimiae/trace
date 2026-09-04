import { isSafeElementRole, isSensitiveField, redactText } from "@trace/shared/privacy";
import { hash64Hex } from "@trace/shared/hash";
import type { ScreenContext } from "@trace/shared";

export interface ElementMetadata {
  elementSelectorHash?: string;
  elementRole?: string;
  elementTextMaskedOrLimited?: string;
}

const MAX_SCREEN_RECT = 10000;
const MAX_VIEWPORT = 10000;
const SAFE_TAG_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_LAYOUT_HINTS = 20;
// 골격 몫. 나머지(20 - 12 = 8)는 클릭 근처가 쓴다. 골격에는 랜드마크가 먼저 들어간다.
const SKELETON_HINTS = 12;
// 랜드마크가 골격 칸을 다 먹지 않게 한다. 랜드마크가 20개인 문서도 있다.
const MAX_LANDMARK_HINTS = 4;
// getComputedStyle 호출 예산이다. 2,360 요소 화면에서 전체를 훑으면 13ms,
// 60개만 보면 0.9ms 로 측정됐다.
const MAX_HINT_CANDIDATES = 60;
// rect 읽기 상한. 2,360 요소에 2.3ms 였다. 거대 문서에서 선형으로 늘어나는 것을 막는다.
const MAX_RECT_SCAN = 3000;
// 이보다 작으면 사람 눈에 상자가 아니다.
const MIN_BOX_SIDE = 8;
// 뷰포트의 이 비율 이상을 덮는 상자는 골격에서 뺀다. <html>·<body> 가 골격 칸을
// 먹으면 화면 전체를 덮는 빈 사각형만 남는다. (스펙 §3 에 없던 규칙 — 근거는 이것이다.)
const SKELETON_MAX_VIEWPORT_RATIO = 0.9;
const LANDMARK_SELECTOR =
  "header, nav, main, aside, [role=banner], [role=navigation], [role=main], [role=complementary]";
// role 은 getAttribute("role") ?? tagName 이므로 <a> 는 role 이 "a", <h2> 는 "h2" 다.
// role 이름만으로 화이트리스트를 쓰면 대부분 걸리지 않는다.
const TEXT_ROLE_WHITELIST = new Set(["button", "link", "tab", "heading"]);
const TEXT_TAG_WHITELIST = new Set(["button", "a", "h1", "h2", "h3"]);

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
// 지문에 넣으면 같은 버튼이 렌더마다 다른 요소로 갈려 이슈가 폭증한다.
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

type ScreenTarget = NonNullable<ScreenContext["target"]>;
type ScreenRect = ScreenTarget["rect"];
type ScreenViewport = ScreenContext["viewport"];
type ScreenLayoutHint = ScreenContext["layoutHints"][number];

// redactText 는 자체 slice(0, 120) 경계 때문에 멱등이 아니다. 1회만 마스킹하면
// 잘린 끝자리가 새 단어 경계를 만들어 다음 마스킹 대상이 남고, 수집 API 의
// screenContextSchema("이미 마스킹된 값") 검증에서 탈락한다. 두 번째 호출은
// 선택이 아니라 필수다.
function redactScreenText(value: string): string {
  return redactText(redactText(value));
}

function clampRectValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_SCREEN_RECT, Math.max(0, Math.round(value)));
}

function rectFromDomRect(rect: DOMRect | ClientRect): ScreenRect {
  return {
    x: clampRectValue(rect.x ?? rect.left),
    y: clampRectValue(rect.y ?? rect.top),
    width: clampRectValue(rect.width),
    height: clampRectValue(rect.height),
  };
}

function clampViewportValue(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_VIEWPORT, Math.max(1, Math.round(value)));
}

function safeRole(role: string | undefined): string | undefined {
  // role 은 공백으로 나열한 토큰 목록("none presentation")일 수 있고 대문자도 온다.
  const normalized = (role ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
  return isSafeElementRole(normalized) ? normalized : undefined;
}

function buildScreenTarget(element: Element, viewport: ScreenViewport): ScreenTarget | undefined {
  const tagName = element.tagName.toLowerCase();
  if (!SAFE_TAG_NAME_PATTERN.test(tagName)) return undefined;

  const rect = rectFromDomRect(element.getBoundingClientRect());
  // 뷰포트보다 큰 대상은 미리보기에서 화면 전체를 덮어 클릭 지점을 오해하게 만든다.
  if (rect.width > viewport.width || rect.height > viewport.height) return undefined;

  const metadata = getElementMetadata(element);
  const role = safeRole(metadata.elementRole);
  const text = metadata.elementTextMaskedOrLimited
    ? redactScreenText(metadata.elementTextMaskedOrLimited)
    : undefined;

  return {
    tagName,
    ...(role ? { role } : {}),
    ...(text && text.length > 0 ? { textMaskedOrLimited: text } : {}),
    ...(metadata.elementSelectorHash ? { selectorHash: metadata.elementSelectorHash } : {}),
    rect,
  };
}

function rectCenterDistance(left: ScreenRect, right: ScreenRect): number {
  const dx = left.x + left.width / 2 - (right.x + right.width / 2);
  const dy = left.y + left.height / 2 - (right.y + right.height / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

function allowsHintText(element: Element, tagName: string, role: string | undefined): boolean {
  if (isTextEntryElement(element)) return false;
  if (role !== undefined && TEXT_ROLE_WHITELIST.has(role)) return true;
  return TEXT_TAG_WHITELIST.has(tagName);
}

// 대체 요소는 배경색·테두리가 없어도 언제나 무언가를 그린다.
const REPLACED_TAGS = new Set(["img", "iframe", "frame", "canvas", "video", "svg", "object", "embed"]);

// 판정에만 쓰고 저장하지 않는다. 여기서 읽은 문자열은 이 함수 밖으로 나가지 않는다 —
// 힌트에 실릴 텍스트는 allowsHintText 화이트리스트가 따로 정한다.
function hasOwnTextNode(element: Element): boolean {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? "").trim().length > 0) return true;
  }
  return false;
}

// 태그 이름이 아니라 그려진 결과로 판정한다. 이름은 사이트마다 다르지만
// "칠해졌는가" 는 모든 프레임워크에서 같은 뜻이다.
export function isPaintedBox(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;

  let style: CSSStyleDeclaration;
  try {
    style = view.getComputedStyle(element);
  } catch {
    return false;
  }

  if (style.visibility === "hidden" || style.opacity === "0") return false;
  if (REPLACED_TAGS.has(element.tagName.toLowerCase())) return true;

  const background = style.backgroundColor;
  if (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") return true;

  for (const side of ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"] as const) {
    if (Number.parseFloat(style[side]) > 0) return true;
  }

  if (style.backgroundImage && style.backgroundImage !== "none") return true;

  return hasOwnTextNode(element);
}

// masked 는 "내용을 보여주지 않는다" 는 표시다. isTextEntryElement 는 textarea 와
// contenteditable 만 잡고 <input> 은 잡지 않으므로, 그것만으로 계산하면 password
// 입력조차 masked:false 가 되어 미리보기가 평범한 박스로 그려지고 Task 3 의 서버
// 집행도 무력해진다. spec 표(입력 계열 또는 isSensitiveField)대로 계산한다.
function isMaskedHintElement(element: Element, tagName: string): boolean {
  if (isTextEntryElement(element)) return true;
  if (tagName === "input" || tagName === "select") return true;
  return isSensitiveField({
    tagName: element.tagName,
    type: element instanceof HTMLInputElement ? element.type : "",
    name: element instanceof HTMLInputElement ? element.name : "",
    id: element.id,
  });
}

function buildLayoutHint(
  element: Element,
  viewport: ScreenViewport,
  precomputedRect?: ScreenRect,
): { hint: ScreenLayoutHint; rect: ScreenRect } | undefined {
  const tagName = element.tagName.toLowerCase();
  if (!SAFE_TAG_NAME_PATTERN.test(tagName)) return undefined;

  // 호출부가 이미 rect 를 계산했으면 다시 읽지 않는다. iframe 내부 요소는 부모
  // 문서 좌표로 보정된 값이라 여기서 다시 읽으면 프레임 기준으로 되돌아간다.
  const rect = precomputedRect ?? rectFromDomRect(element.getBoundingClientRect());
  if (!intersectsViewportRect(rect, viewport)) return undefined;

  // getElementMetadata 를 부르지 않는다. 힌트는 selectorHash 를 쓰지 않고, 무엇보다
  // 텍스트를 쓸지 정하기 전에 텍스트를 뽑아 버리면 랜드마크(<main> 등)에서 화면 전체
  // 문자열을 만들었다가 그대로 버린다.
  const role = safeRole(element.getAttribute("role") ?? tagName);
  const masked = isMaskedHintElement(element, tagName);
  // masked 를 텍스트 판정보다 앞에 둔다. "masked:true 인 힌트는 텍스트를 담지 않는다" 는
  // 규칙이 화이트리스트 두 개의 조합에 기대지 않고 이 한 줄로 서게 한다.
  const rawText = !masked && allowsHintText(element, tagName, role) ? allowedElementText(element) : undefined;
  const text = rawText === undefined ? undefined : redactScreenText(rawText);

  return {
    rect,
    hint: {
      tagName,
      ...(role ? { role } : {}),
      ...(text && text.length > 0 ? { textMaskedOrLimited: text } : {}),
      rect,
      masked,
    },
  };
}

interface BoxCandidate {
  element: Element;
  rect: ScreenRect;
  area: number;
  distance: number;
}

function offsetRect(rect: ScreenRect, offset: { x: number; y: number }): ScreenRect {
  return { ...rect, x: clampRectValue(rect.x + offset.x), y: clampRectValue(rect.y + offset.y) };
}

function intersectsViewportRect(rect: ScreenRect, viewport: ScreenViewport): boolean {
  return rect.x < viewport.width && rect.y < viewport.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

// 원시 DOMRect 로 판정한다. rectFromDomRect 가 x/y 를 0 으로 클램프한 뒤에 보면
// 화면 위쪽·왼쪽으로 완전히 벗어난 요소가 0 으로 접혀 뷰포트 안으로 잘못
// 판정된다. offset 은 iframe 좌표 보정치다(지금은 항상 {0,0}).
function domRectIntersectsViewport(
  rect: DOMRect | ClientRect,
  viewport: ScreenViewport,
  offset: { x: number; y: number },
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.right + offset.x > 0 &&
    rect.bottom + offset.y > 0 &&
    rect.left + offset.x < viewport.width &&
    rect.top + offset.y < viewport.height
  );
}

// rect 만 읽는다. getComputedStyle 은 아직 부르지 않는다 — 그게 비싼 쪽이다.
function scanBoxes(
  doc: Document,
  viewport: ScreenViewport,
  targetRect: ScreenRect,
  offset: { x: number; y: number },
): BoxCandidate[] {
  const candidates: BoxCandidate[] = [];
  const elements = doc.querySelectorAll("*");
  const limit = Math.min(elements.length, MAX_RECT_SCAN);

  for (let index = 0; index < limit; index += 1) {
    const element = elements[index]!;
    let domRect: DOMRect | ClientRect;
    try {
      domRect = element.getBoundingClientRect();
    } catch {
      continue;
    }
    if (domRect.width < MIN_BOX_SIDE || domRect.height < MIN_BOX_SIDE) continue;
    if (!domRectIntersectsViewport(domRect, viewport, offset)) continue;
    const rect = offsetRect(rectFromDomRect(domRect), offset);
    candidates.push({
      element,
      rect,
      area: rect.width * rect.height,
      distance: rectCenterDistance(rect, targetRect),
    });
  }

  return candidates;
}

// 면적과 거리 양쪽에서 절반씩 뽑는다. 한쪽으로만 뽑으면 다른 쪽이 후보에조차 못 든다.
function budgetedCandidates(candidates: BoxCandidate[]): BoxCandidate[] {
  const half = Math.floor(MAX_HINT_CANDIDATES / 2);
  const byArea = [...candidates].sort((left, right) => right.area - left.area).slice(0, half);
  const byDistance = [...candidates].sort((left, right) => left.distance - right.distance).slice(0, half);
  return Array.from(new Set([...byArea, ...byDistance]));
}

function isNearSameRect(left: ScreenRect, right: ScreenRect): boolean {
  return (
    Math.abs(left.x - right.x) < 4 &&
    Math.abs(left.y - right.y) < 4 &&
    Math.abs(left.width - right.width) < 4 &&
    Math.abs(left.height - right.height) < 4
  );
}

// 래퍼 div 가 겹겹이 쌓인 구조에서 같은 상자를 여러 번 그리는 것을 막는다.
function dropNearParent(candidates: BoxCandidate[]): BoxCandidate[] {
  const byElement = new Map(candidates.map((candidate) => [candidate.element, candidate] as const));
  return candidates.filter((candidate) => {
    const parent = candidate.element.parentElement;
    if (!parent) return true;
    const parentCandidate = byElement.get(parent);
    return parentCandidate === undefined || !isNearSameRect(candidate.rect, parentCandidate.rect);
  });
}

function collectLayoutHints(target: Element, viewport: ScreenViewport): ScreenLayoutHint[] {
  const targetRect = rectFromDomRect(target.getBoundingClientRect());
  const seen = new Set<string>();
  const hints: ScreenLayoutHint[] = [];

  // 힌트 하나가 던져도 화면 맥락 전체를 잃지 않는다. getScreenContext 의 바깥
  // try/catch 에 맡기면 타겟과 뷰포트까지 날아가서 힌트를 안 걷는 것보다 나쁘다.
  const push = (element: Element, rect?: ScreenRect): void => {
    if (element === target || hints.length >= MAX_LAYOUT_HINTS) return;
    let built: ReturnType<typeof buildLayoutHint>;
    try {
      built = buildLayoutHint(element, viewport, rect);
    } catch {
      return;
    }
    if (!built) return;
    const key = `${built.rect.x}:${built.rect.y}:${built.rect.width}:${built.rect.height}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(built.hint);
  };

  // ① 랜드마크 — querySelectorAll 한 번이라 공짜다. 투명해서 칠해짐 판정에 걸리지
  // 않는 <main>·<header> 를 여기서 건진다.
  const landmarks = Array.from(target.ownerDocument.querySelectorAll(LANDMARK_SELECTOR)).slice(
    0,
    MAX_HINT_CANDIDATES,
  );
  for (const landmark of landmarks) {
    if (hints.length >= MAX_LANDMARK_HINTS) break;
    push(landmark);
  }

  // ② rect 스캔 → ③ 예산 안에서만 style 판정 → ④ 칠해짐 + 부모 중복 접기
  const scanned = scanBoxes(target.ownerDocument, viewport, targetRect, { x: 0, y: 0 });
  const painted = budgetedCandidates(scanned).filter((candidate) => isPaintedBox(candidate.element));
  const boxes = dropNearParent(painted);

  // 골격: 면적 큰 순. 화면 전체를 덮는 상자는 아무것도 알려주지 않으므로 뺀다.
  const viewportArea = viewport.width * viewport.height;
  const skeleton = boxes
    .filter((candidate) => candidate.area < viewportArea * SKELETON_MAX_VIEWPORT_RATIO)
    .sort((left, right) => right.area - left.area);
  for (const candidate of skeleton) {
    if (hints.length >= SKELETON_HINTS) break;
    push(candidate.element, candidate.rect);
  }

  // 클릭 근처: 중심 거리 가까운 순. 남은 칸을 채운다. 한쪽이 부족하면 다른 쪽이 메운다.
  const nearby = [...boxes].sort((left, right) => left.distance - right.distance);
  for (const candidate of nearby) {
    if (hints.length >= MAX_LAYOUT_HINTS) break;
    push(candidate.element, candidate.rect);
  }

  return hints;
}

// 페이지 제목은 수집하지 않는다. 업무 화면의 title 은 "김철수 - 고객 상세" 처럼
// 레코드 주체를 담는 일이 많고, redactText 는 이메일·전화·9자리+ 숫자만 지우므로
// 이름·주소를 걸러내지 못한다. 미리보기는 urlPath 폴백으로 화면을 표시한다.
export function getScreenContext(element: Element): ScreenContext | undefined {
  try {
    const viewport: ScreenViewport = {
      width: clampViewportValue(window.innerWidth || document.documentElement.clientWidth || 1),
      height: clampViewportValue(window.innerHeight || document.documentElement.clientHeight || 1),
    };
    const target = buildScreenTarget(element, viewport);

    return {
      viewport,
      ...(target ? { target } : {}),
      layoutHints: collectLayoutHints(element, viewport),
    };
  } catch {
    return undefined;
  }
}
