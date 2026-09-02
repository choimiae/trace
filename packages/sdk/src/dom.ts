import { isSafeElementRole, isSensitiveField, redactText } from "@trace/shared/privacy";
import type { ScreenContext } from "@trace/shared";

export interface ElementMetadata {
  elementSelectorHash?: string;
  elementRole?: string;
  elementTextMaskedOrLimited?: string;
}

const MAX_SCREEN_RECT = 10000;
const MAX_VIEWPORT = 10000;
const SAFE_TAG_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_LAYOUT_HINTS = 12;
// 랜드마크 몫 예약. 이웃 상한은 따로 두지 않는다 — 랜드마크가 없는 문서에서는
// 이웃이 유일한 신호이므로 나머지 전부(MAX_LAYOUT_HINTS)를 채울 수 있어야 한다.
const MAX_LANDMARK_HINTS = 4;
// 클릭당 검사 후보 상한. 시간 기반 throttle 대신 작업량을 묶는다 — rage click 의
// 2번째 이후 클릭에서 힌트가 사라지면 정작 필요한 이슈에서 화면이 빈다.
const MAX_HINT_CANDIDATES = 60;
const LANDMARK_SELECTOR =
  "header, nav, main, aside, [role=banner], [role=navigation], [role=main], [role=complementary]";
// 제목도 포함한다. h1-h3 는 TEXT_TAG_WHITELIST 에 있는데 랜드마크도 아니어서,
// 이웃 셀렉터에 없으면 수집 자체가 안 돼 화이트리스트가 死코드가 된다.
const NEIGHBOR_SELECTOR =
  "button, a[href], input, select, textarea, h1, h2, h3, [role=button], [role=link], [role=tab], [role=heading]";
const CONTAINER_SELECTOR = "form, section, header, nav, main, aside";
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
function containsTextEntrySubtree(element: Element): boolean {
  return element.querySelector(TEXT_ENTRY_SUBTREE_SELECTOR) !== null;
}

export function getElementMetadata(element: Element): ElementMetadata {
  const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
  const selector = buildSelector(element);
  const sensitive =
    isTextEntryElement(element) ||
    containsTextEntrySubtree(element) ||
    isSensitiveField({
      tagName: element.tagName,
      type: element instanceof HTMLInputElement ? element.type : "",
      name: element instanceof HTMLInputElement ? element.name : "",
      id: element.id,
    });
  const text = redactText((element.textContent || element.getAttribute("aria-label") || "").trim());

  return {
    elementSelectorHash: hashSelector(selector),
    elementRole: role,
    ...(sensitive || text.length === 0 ? {} : { elementTextMaskedOrLimited: text }),
  };
}

function buildSelector(element: Element): string {
  const id = element.id ? `#${element.id}` : "";
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role") ? `[role="${element.getAttribute("role")}"]` : "";

  return `${tag}${id}${role}`;
}

function hashSelector(selector: string): string {
  let hash = 0;

  for (let index = 0; index < selector.length; index += 1) {
    hash = (hash * 31 + selector.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
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

// 원시 DOMRect 로 판정한다. rectFromDomRect 가 x/y 를 0 으로 클램프한 뒤에 보면
// 화면 위쪽·왼쪽으로 스크롤된 요소가 y:0 으로 접혀 통과하고, 미리보기 상단에
// 몰려 실제 화면을 왜곡한다.
function intersectsViewport(rect: DOMRect | ClientRect, viewport: ScreenViewport): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  return rect.right > 0 && rect.bottom > 0 && rect.left < viewport.width && rect.top < viewport.height;
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
): { hint: ScreenLayoutHint; rect: ScreenRect } | undefined {
  const tagName = element.tagName.toLowerCase();
  if (!SAFE_TAG_NAME_PATTERN.test(tagName)) return undefined;

  const domRect = element.getBoundingClientRect();
  if (!intersectsViewport(domRect, viewport)) return undefined;
  const rect = rectFromDomRect(domRect);

  const metadata = getElementMetadata(element);
  const role = safeRole(metadata.elementRole);
  const masked = isMaskedHintElement(element, tagName);
  const text =
    allowsHintText(element, tagName, role) && metadata.elementTextMaskedOrLimited
      ? redactScreenText(metadata.elementTextMaskedOrLimited)
      : undefined;

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

function nearestContainer(target: Element): Element {
  let current: Element | null = target.parentElement;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (current.matches(CONTAINER_SELECTOR)) return current;
    current = current.parentElement;
  }
  // body 가 없는 문서(XML 등)도 있다. 그 경우 documentElement 로, 그마저 없으면
  // 타겟 자신으로 떨어뜨려 querySelectorAll 이 null 에서 터지지 않게 한다.
  return target.ownerDocument.body ?? target.ownerDocument.documentElement ?? target;
}

function collectLayoutHints(target: Element, viewport: ScreenViewport): ScreenLayoutHint[] {
  const targetRect = rectFromDomRect(target.getBoundingClientRect());
  const seen = new Set<string>();
  const hints: ScreenLayoutHint[] = [];

  // 힌트 하나가 던져도 화면 맥락 전체를 잃지 않는다. getScreenContext 의 바깥
  // try/catch 에 맡기면 타겟과 뷰포트까지 날아가서 힌트를 안 걷는 것보다 나쁘다.
  const push = (element: Element): void => {
    if (element === target || hints.length >= MAX_LAYOUT_HINTS) return;
    let built: ReturnType<typeof buildLayoutHint>;
    try {
      built = buildLayoutHint(element, viewport);
    } catch {
      return;
    }
    if (!built) return;
    const key = `${built.rect.x}:${built.rect.y}:${built.rect.width}:${built.rect.height}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(built.hint);
  };

  const landmarks = Array.from(target.ownerDocument.querySelectorAll(LANDMARK_SELECTOR)).slice(
    0,
    MAX_HINT_CANDIDATES,
  );
  for (const landmark of landmarks) {
    if (hints.length >= MAX_LANDMARK_HINTS) break;
    push(landmark);
  }

  // 후보를 문서 순서로 자르면 안 된다. nearestContainer 가 body 로 폴백한 경우
  // 문서 앞쪽의 페이지 크롬이 60칸을 다 먹고 정작 타겟 이웃은 후보에도 못 든다.
  // 타겟의 문서 순서 위치를 중심으로 창을 잡아 rect 읽기를 묶은 뒤 거리로 정렬한다.
  const container = nearestContainer(target);
  const all = Array.from(container.querySelectorAll(NEIGHBOR_SELECTOR));
  // 클릭은 버튼 안의 아이콘·span, 테이블 셀, 평범한 div 에 자주 떨어진다. 그런
  // 요소는 all 에 없어서 indexOf 가 -1 이고, anchor 를 0 으로 떨어뜨리면 창이
  // 문서 앞쪽으로 붕괴해 페이지 크롬이 12칸을 다 먹는다. 가장 가까운 후보를
  // 기준으로 삼는다. 타겟 자체는 바꾸지 않는다 — 클릭 마커는 실제 클릭 요소를 쓴다.
  const anchorElement = target.closest(NEIGHBOR_SELECTOR) ?? target;
  const targetIndex = all.indexOf(anchorElement);
  const anchor = targetIndex === -1 ? 0 : targetIndex;
  const half = Math.floor(MAX_HINT_CANDIDATES / 2);
  const windowed = all.slice(Math.max(0, anchor - half), anchor + half);
  // 거리 계산도 rect 를 읽는다. push 의 try/catch 는 이 시점 이후에만 걸리므로,
  // 여기서 던지는 후보를 거르지 않으면 push 에 닿기도 전에 힌트 수집 전체가
  // 죽는다 — 하나가 던져도 나머지를 잃지 않는다는 약속이 정렬 단계에서 깨진다.
  const neighbors: Array<{ element: Element; distance: number }> = [];
  for (const element of windowed) {
    try {
      neighbors.push({
        element,
        distance: rectCenterDistance(rectFromDomRect(element.getBoundingClientRect()), targetRect),
      });
    } catch {
      // 이 후보는 순위를 매길 수 없다 — 건너뛴다. 어차피 push 에서도 같은 rect
      // 읽기가 다시 던져 걸러질 대상이다.
    }
  }
  neighbors.sort((left, right) => left.distance - right.distance);

  // 랜드마크가 없으면 이웃이 유일한 신호다. MAX_LANDMARK_HINTS 는 랜드마크 몫을
  // 예약하는 뜻이지 이웃의 전체 상한을 낮추라는 뜻이 아니므로, 이웃은
  // MAX_LAYOUT_HINTS 까지 채운다.
  for (const neighbor of neighbors) {
    if (hints.length >= MAX_LAYOUT_HINTS) break;
    push(neighbor.element);
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
