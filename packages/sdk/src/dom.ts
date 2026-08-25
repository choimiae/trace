import { isSensitiveField, redactText } from "@trace/shared";

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
