import { afterEach, describe, expect, it, vi } from "vitest";
import { Identity, SESSION_IDLE_MS } from "./identity.js";
import { REPLAY_SEQ_KEY, SESSION_KEY, VISITOR_KEY } from "./storage.js";
import { breakStorage } from "./test-storage.js";

const T0 = 1_790_000_000_000;

function storedSession(): unknown {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw === null ? null : JSON.parse(raw);
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Identity", () => {
  it("저장소가 비어 있으면 새 ID 를 만들고 저장한다", () => {
    const identity = new Identity({ persist: true, now: () => T0 });

    expect(identity.sessionId).toMatch(/^sess_/);
    expect(identity.anonymousUserId).toMatch(/^anon_/);
    expect(storedSession()).toEqual({ sessionId: identity.sessionId, lastActivityAt: T0 });
    expect(localStorage.getItem(VISITOR_KEY)).toBe(identity.anonymousUserId);
  });

  // 새로고침은 스크립트를 처음부터 다시 실행한다. 같은 탭의 sessionStorage 는 남는다.
  it("새로고침해도 같은 세션과 방문자를 이어 받는다", () => {
    const first = new Identity({ persist: true, now: () => T0 });
    const second = new Identity({ persist: true, now: () => T0 + 60_000 });

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.anonymousUserId).toBe(first.anonymousUserId);
  });

  it("마지막 활동이 30분보다 오래됐으면 새 세션을 시작하고 방문자는 유지한다", () => {
    const first = new Identity({ persist: true, now: () => T0 });
    const second = new Identity({ persist: true, now: () => T0 + SESSION_IDLE_MS + 1 });

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.anonymousUserId).toBe(first.anonymousUserId);
  });

  it("정확히 30분이면 이어 간다", () => {
    const first = new Identity({ persist: true, now: () => T0 });
    const second = new Identity({ persist: true, now: () => T0 + SESSION_IDLE_MS });

    expect(second.sessionId).toBe(first.sessionId);
  });

  it("touch 는 마지막 활동 시각을 늦춰 세션을 이어지게 한다", () => {
    let now = T0;
    const first = new Identity({ persist: true, now: () => now });
    now = T0 + 20 * 60_000;
    first.touch();
    const second = new Identity({ persist: true, now: () => T0 + 45 * 60_000 });

    expect(second.sessionId).toBe(first.sessionId);
  });

  it("persist 가 거짓이면 저장소를 읽지도 쓰지도 않는다", () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: "sess_Stored12345", lastActivityAt: T0 }));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const identity = new Identity({ persist: false, now: () => T0 });
    identity.touch();

    expect(identity.sessionId).not.toBe("sess_Stored12345");
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  // 동의 보류 → grant() 의 흐름이다. 보류 중에 보낸 이벤트는 없으므로 ID 를 바꿔도 된다.
  it("persist() 를 부르면 그때 저장된 세션을 이어 받는다", () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: "sess_Stored12345", lastActivityAt: T0 }));
    localStorage.setItem(VISITOR_KEY, "anon_Stored12345");
    const identity = new Identity({ persist: false, now: () => T0 + 1_000 });

    identity.persist();

    expect(identity.sessionId).toBe("sess_Stored12345");
    expect(identity.anonymousUserId).toBe("anon_Stored12345");
    expect(storedSession()).toEqual({ sessionId: "sess_Stored12345", lastActivityAt: T0 + 1_000 });
  });

  it("forget 은 Trace 키를 모두 지우고 이후로는 쓰지 않는다", () => {
    const identity = new Identity({ persist: true, now: () => T0 });
    sessionStorage.setItem(REPLAY_SEQ_KEY, JSON.stringify({ sessionId: identity.sessionId, next: 3 }));
    sessionStorage.setItem("host-app", "keep");

    identity.forget();
    identity.touch();

    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(REPLAY_SEQ_KEY)).toBeNull();
    expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
    expect(sessionStorage.getItem("host-app")).toBe("keep");
  });

  it.each([
    ["JSON 이 아님", "{not json"],
    ["접두사가 다름", JSON.stringify({ sessionId: "anon_Stored12345", lastActivityAt: T0 })],
    ["식별자에 쓸 수 없는 글자", JSON.stringify({ sessionId: "sess_choi@example.com", lastActivityAt: T0 })],
    ["시각이 숫자가 아님", JSON.stringify({ sessionId: "sess_Stored12345", lastActivityAt: "어제" })],
  ])("저장된 값이 깨졌으면 새로 만든다 (%s)", (_label, raw) => {
    sessionStorage.setItem(SESSION_KEY, raw);
    localStorage.setItem(VISITOR_KEY, "choi@example.com");

    const identity = new Identity({ persist: true, now: () => T0 });

    expect(identity.sessionId).toMatch(/^sess_/);
    expect(identity.sessionId).not.toBe("sess_Stored12345");
    expect(identity.anonymousUserId).toMatch(/^anon_/);
    expect(localStorage.getItem(VISITOR_KEY)).toBe(identity.anonymousUserId);
  });

  it("저장소 접근이 던지면 메모리 ID 로 계속한다", () => {
    const restoreSession = breakStorage("sessionStorage");
    const restoreLocal = breakStorage("localStorage");
    try {
      const identity = new Identity({ persist: true, now: () => T0 });
      identity.touch();
      identity.forget();

      expect(identity.sessionId).toMatch(/^sess_/);
      expect(identity.anonymousUserId).toMatch(/^anon_/);
    } finally {
      restoreSession();
      restoreLocal();
    }
  });
});
