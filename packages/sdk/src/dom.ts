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
const MAX_LANDMARK_HINTS = 4;
const MAX_NEIGHBOR_HINTS = 8;
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

// input·textarea·contenteditable 내부 텍스트는 저장하지 않는다.
function isTextEntryElement(element: Element): boolean {
  if (element.tagName.toLowerCase() === "textarea") return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  // jsdom 은 isContentEditable 을 상속하지 않고, SVG 자손은 HTMLElement 도 아니다.
  // 편집 영역 안의 텍스트는 어느 자손이 담고 있어도 사용자가 쓴 내용이므로 조상을 본다.
  return element.closest(CONTENTEDITABLE_SELECTOR) !== null;
}

export function getElementMetadata(element: Element): ElementMetadata {
  const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
  const selector = buildSelector(element);
  const sensitive =
    isTextEntryElement(element) ||
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

function intersectsViewport(rect: ScreenRect, viewport: ScreenViewport): boolean {
  return rect.x < viewport.width && rect.y < viewport.height && rect.width > 0 && rect.height > 0;
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

function buildLayoutHint(
  element: Element,
  viewport: ScreenViewport,
): { hint: ScreenLayoutHint; rect: ScreenRect } | undefined {
  const tagName = element.tagName.toLowerCase();
  if (!SAFE_TAG_NAME_PATTERN.test(tagName)) return undefined;

  const rect = rectFromDomRect(element.getBoundingClientRect());
  if (!intersectsViewport(rect, viewport)) return undefined;

  const metadata = getElementMetadata(element);
  const role = safeRole(metadata.elementRole);
  const masked = isTextEntryElement(element);
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
  return target.ownerDocument.body;
}

function collectLayoutHints(target: Element, viewport: ScreenViewport): ScreenLayoutHint[] {
  const targetRect = rectFromDomRect(target.getBoundingClientRect());
  const seen = new Set<string>();
  const hints: ScreenLayoutHint[] = [];

  const push = (element: Element): void => {
    if (element === target || hints.length >= MAX_LAYOUT_HINTS) return;
    const built = buildLayoutHint(element, viewport);
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

  const neighbors = Array.from(nearestContainer(target).querySelectorAll(NEIGHBOR_SELECTOR))
    .slice(0, MAX_HINT_CANDIDATES)
    .map((element) => ({ element, distance: rectCenterDistance(rectFromDomRect(element.getBoundingClientRect()), targetRect) }))
    .sort((left, right) => left.distance - right.distance);

  const landmarkCount = hints.length;
  for (const neighbor of neighbors) {
    if (hints.length >= landmarkCount + MAX_NEIGHBOR_HINTS) break;
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
