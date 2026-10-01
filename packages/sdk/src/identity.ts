import { isSafeTraceIdentifier } from "@trace/shared/privacy";
import { nanoid } from "nanoid";
import { readItem, removeItem, REPLAY_SEQ_KEY, SESSION_KEY, VISITOR_KEY, writeItem } from "./storage.js";

/** 이만큼 활동이 없던 탭은 다음에 페이지를 불러올 때 새 세션을 시작한다. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * 세션과 방문자 ID.
 *
 * 세션은 탭 하나다. sessionStorage 는 탭마다 따로이고 새로고침에도 남으므로, 같은
 * 탭에서 페이지를 새로 불러와도 세션이 이어진다. 새 세션인지는 **스크립트가 시작할
 * 때만** 정한다 - 열려 있는 페이지 안에서 세션을 바꾸면 이미 돌고 있는 리플레이가
 * 옛 세션 주소로 계속 올린다.
 *
 * 저장은 동의가 있을 때만 한다(persist). 보류·거부 상태에서는 저장소를 읽지도
 * 쓰지도 않고 메모리 값만 쓴다.
 */
export class Identity {
  sessionId = `sess_${nanoid(10)}`;
  anonymousUserId = `anon_${nanoid(10)}`;
  private persistent = false;
  private readonly now: () => number;

  constructor(options: { persist: boolean; now?: () => number }) {
    this.now = options.now ?? Date.now;
    if (options.persist) this.persist();
  }

  /**
   * 저장소를 쓰기 시작한다. 이어 갈 세션과 방문자가 저장돼 있으면 그 ID 로 바꾼다.
   *
   * 동의 보류 중에는 아무 이벤트도 나가지 않았으므로(TraceClient.enqueue 가 막는다)
   * 여기서 ID 를 바꿔도 한 세션이 둘로 갈리지 않는다.
   */
  persist(): void {
    if (this.persistent) return;
    this.persistent = true;

    const storedSessionId = readLiveSessionId(this.now());
    if (storedSessionId) this.sessionId = storedSessionId;

    const storedVisitor = readItem("local", VISITOR_KEY);
    if (storedVisitor && isSafeTraceIdentifier(storedVisitor, "anon")) {
      this.anonymousUserId = storedVisitor;
    } else {
      writeItem("local", VISITOR_KEY, this.anonymousUserId);
    }

    this.touch();
  }

  /** 마지막 활동 시각을 지금으로 적는다. 이벤트를 큐에 넣을 때마다 부른다. */
  touch(): void {
    if (!this.persistent) return;
    writeItem("session", SESSION_KEY, JSON.stringify({ sessionId: this.sessionId, lastActivityAt: this.now() }));
  }

  /** 동의 거부. Trace 키를 지우고 다시 persist() 가 오기 전까지 쓰지 않는다. */
  forget(): void {
    this.persistent = false;
    removeItem("session", SESSION_KEY);
    removeItem("session", REPLAY_SEQ_KEY);
    removeItem("local", VISITOR_KEY);
  }
}

// 깨진 값은 없는 것으로 본다. 다른 스크립트가 같은 키를 썼거나 사용자가 고친 값을
// 그대로 쓰면 서버가 그 ID 를 새로 바꿔 세션이 배치마다 갈린다.
function readLiveSessionId(now: number): string | undefined {
  const raw = readItem("session", SESSION_KEY);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as { sessionId?: unknown; lastActivityAt?: unknown };
    if (typeof parsed.sessionId !== "string" || !isSafeTraceIdentifier(parsed.sessionId, "sess")) return undefined;
    if (typeof parsed.lastActivityAt !== "number" || !Number.isFinite(parsed.lastActivityAt)) return undefined;
    if (now - parsed.lastActivityAt > SESSION_IDLE_MS) return undefined;
    return parsed.sessionId;
  } catch {
    return undefined;
  }
}
