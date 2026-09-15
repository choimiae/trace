export type AssembledChunk =
  | { ok: true; events: unknown[] }
  | { ok: false; reason: "unreadable" };

/**
 * 청크 본문에서 rrweb 이벤트를 꺼낸다.
 *
 * 이벤트 **본문은 검증하지 않는다** — 모양이 rrweb 버전에 묶여 있어 계약으로
 * 고정하면 라이브러리를 올릴 수 없다. 배열인지만 본다.
 */
export function assembleChunk(raw: unknown): AssembledChunk {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "unreadable" };

  const events = (raw as { events?: unknown }).events;
  if (!Array.isArray(events)) return { ok: false, reason: "unreadable" };

  return { ok: true, events };
}
