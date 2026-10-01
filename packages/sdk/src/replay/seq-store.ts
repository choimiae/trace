import { readItem, REPLAY_SEQ_KEY, writeItem } from "../storage.js";

// 같은 탭의 세션은 페이지를 새로 불러와도 이어진다(identity.ts). 조각 번호도 이어야
// 한다 - 새 페이지가 0 부터 다시 매기면 서버의 (session_id, seq) INSERT OR IGNORE 가
// 앞 페이지 조각과 번호가 겹친 새 조각을 말없이 버린다.
//
// 세션 ID 를 함께 적는 것은 30분이 지나 새 세션이 된 탭이 옛 번호를 이어 받지 않게
// 하려는 것이다.
export function readNextSeq(sessionId: string): number {
  const raw = readItem("session", REPLAY_SEQ_KEY);
  if (!raw) return 0;

  try {
    const parsed = JSON.parse(raw) as { sessionId?: unknown; next?: unknown };
    if (parsed.sessionId !== sessionId) return 0;
    const next = parsed.next;
    return typeof next === "number" && Number.isInteger(next) && next >= 0 ? next : 0;
  } catch {
    return 0;
  }
}

export function writeNextSeq(sessionId: string, next: number): void {
  writeItem("session", REPLAY_SEQ_KEY, JSON.stringify({ sessionId, next }));
}
