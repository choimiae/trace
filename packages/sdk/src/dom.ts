import { isSensitiveField, redactText } from "@trace/shared/privacy";
import type { ScreenContext } from "@trace/shared";

export interface ElementMetadata {
  elementSelectorHash?: string;
  elementRole?: string;
  elementTextMaskedOrLimited?: string;
}

export function getElementMetadata(element: Element): ElementMetadata {
  const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
  const selector = buildSelector(element);
  const sensitive = isSensitiveField({
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

type ScreenRect = NonNullable<ScreenContext["target"]>["rect"];

function rectFromDomRect(rect: DOMRect | ClientRect): ScreenRect {
  return {
    x: Math.max(0, Math.round(rect.x ?? rect.left)),
    y: Math.max(0, Math.round(rect.y ?? rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

export function getScreenContext(element: Element): ScreenContext | undefined {
  try {
    const rect = element.getBoundingClientRect();
    const metadata = getElementMetadata(element);
    const title = redactText(document.title.trim());
    const text = metadata.elementTextMaskedOrLimited
      ? redactText(metadata.elementTextMaskedOrLimited).slice(0, 120)
      : undefined;

    return {
      ...(title.length > 0 ? { titleMasked: title } : {}),
      viewport: {
        width: Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1)),
        height: Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1)),
      },
      target: {
        tagName: element.tagName.toLowerCase(),
        ...(metadata.elementRole ? { role: metadata.elementRole } : {}),
        ...(text && text.length > 0 ? { textMaskedOrLimited: text } : {}),
        ...(metadata.elementSelectorHash ? { selectorHash: metadata.elementSelectorHash } : {}),
        rect: rectFromDomRect(rect),
      },
      layoutHints: [],
    };
  } catch {
    return undefined;
  }
}
