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

// input·textarea·contenteditable 내부 텍스트는 저장하지 않는다.
function isTextEntryElement(element: Element): boolean {
  if (element.tagName.toLowerCase() === "textarea") return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  // jsdom 등 isContentEditable 미구현 환경을 위해 속성도 함께 본다.
  const editable = element.getAttribute("contenteditable");
  return editable === "" || editable === "true" || editable === "plaintext-only";
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
      layoutHints: [],
    };
  } catch {
    return undefined;
  }
}
