# ② 수집 바꾸기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 탭에서는 새로고침하거나 페이지를 새로 불러와도 세션 하나로 이어지고, 브라우저마다 익명 방문자 ID가 유지되며, `page_view`에 화면 제목이 실리고, 리플레이가 페이지를 넘어 한 세션으로 이어 재생되게 한다.

**Architecture:** SDK에 저장소 도우미(`storage.ts`)와 신원(`identity.ts`)을 새로 두고, `TraceClient`가 세션·방문자 ID를 직접 만들지 않고 `Identity`에서 읽는다. 동의 상태가 `Identity`의 저장 여부를 정한다(보류·거부면 메모리만, 허락하면 저장소). 리플레이 번들은 같은 저장소 도우미로 조각 번호를 이어 받는다. 서버는 방문자 ID를 이벤트 행에 저장하고, 수집 API는 이벤트 종류를 먼저 보고 버릴 이벤트의 필드는 검사하지 않는다. 재생기는 쉬는 구간을 건너뛴다.

**Tech Stack:** TypeScript, npm workspaces, vitest(jsdom), Fastify, `node:sqlite`, React, rrweb 2.0.0-alpha.4, esbuild

**Spec:** `docs/superpowers/specs/2026-09-30-behavior-analytics-redefinition-design.md` ("세션과 방문자", "리플레이 녹화", "진행 단계"의 ②)

## Global Constraints

- 응답, 커밋 메시지, 사용자에게 보이는 문구는 한국어로 쓴다. 코드 식별자, 명령, 경로는 원문 그대로 둔다.
- 커밋 메시지는 이 저장소 관례(`<영역>: <한국어 문장>`)를 따르고 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 워크트리는 `git worktree add .worktrees/<name> -b feature/<name>`으로 로컬 HEAD 기준으로 만든다. `EnterWorktree`는 쓰지 않는다.
- `git push`는 하지 않는다. 푸시는 사용자가 한다.
- 세션: **탭 단위**(sessionStorage), **30분 무활동 시 종료**. 새 세션 여부는 스크립트가 시작할 때(페이지를 불러올 때) 정한다. 열려 있는 페이지 안에서는 세션을 바꾸지 않는다.
- 방문자: localStorage의 `anon_` ID.
- 동의 대기(`data-consent="pending"`) 중에는 두 저장소에 **읽지도 쓰지도 않는다.** `grant()`가 오면 그때 읽고 쓴다. `deny()`가 오면 두 저장소에서 Trace 키를 지운다.
- 저장소 접근이 던지면 삼키고 메모리 값으로 물러선다. 수집은 멈추지 않는다.
- 저장소 키: sessionStorage `trace:session`(`{ sessionId, lastActivityAt }`), sessionStorage `trace:replay-seq`(`{ sessionId, next }`), localStorage `trace:visitor`(`anon_…`).
- 리플레이 업로드: 10초 간격 + 페이지 이탈 시 keepalive. 조각 크기 상한(`MAX_RECORDING_CHUNK_BYTES` 2 MB)과 마스킹 규칙, 보존 기간 7일은 바꾸지 않는다.
- SDK 번들은 gzip 10KB 예산 안이어야 한다(`packages/sdk/src/bundle-size.test.ts`). 지금 약 4.2KB다.
- 수집 API는 "거절이 아니라 정리한다". 계약이 받지 않는 종류의 이벤트는 배치를 떨어뜨리지 않고 버린다.
- 스키마를 새로 만든다. 옛 DB를 위한 `ALTER TABLE` 마이그레이션은 두지 않는다. 로컬 SQLite를 지우거나 비우는 SQL은 명령줄에 쓰지 않는다(`db-migration-guard` 훅이 막는다). DB 파일 자체를 지운다.
- 태스크가 끝날 때마다 워크트리 루트에서 `npm run typecheck`와 `npm test`가 모두 통과해야 한다.

## Review Focus

설계가 직접 말하지 않지만 쓰는 사람을 가장 먼저 물 다섯 가지다. 각 줄의 테스트를 담당 태스크에 넣었다.

1. **저장소 접근 자체가 던지는 브라우저**(쿠키 차단, 샌드박스 iframe — `window.sessionStorage`를 읽는 순간 `SecurityError`): 수집은 그대로 돌고 메모리 ID를 쓴다. → 태스크 1 `identity.test.ts` "저장소 접근이 던지면 메모리 ID 로 계속한다"
2. **저장소에 깨진 값**(JSON이 아님, 접두사가 다름, 시각이 숫자가 아님 — 다른 스크립트가 같은 키를 썼거나 옛 버전이 남긴 값): 던지지 않고 새 ID를 만든다. 서버가 400을 내는 ID를 그대로 쓰지 않는다. → 태스크 1 "저장된 값이 깨졌으면 새로 만든다"
3. **동의 보류였다가 `grant()`가 오는 페이지**(배너가 동의를 기억해 매 페이지 곧바로 `grant()`를 부르는 사이트): 앞 페이지의 세션을 이어 받고, 리플레이도 바뀐 세션 ID로 올린다. → 태스크 2 `index.test.ts` "동의 보류에서 grant 하면 저장된 세션을 이어 받고 리플레이도 그 세션으로 올린다"
4. **새로고침 직전 페이지의 마지막 조각이 아직 나가는 중**: 그 조각의 번호를 매기는 순간 저장해야 다음 페이지가 같은 번호를 다시 쓰지 않는다(서버의 `(session_id, seq)` `INSERT OR IGNORE`가 겹친 조각을 말없이 버린다). → 태스크 4 `uploader.test.ts` "번호를 매기는 즉시, 전송을 기다리기 전에 onSeqClaimed 를 부른다"
5. **SPA가 경로를 먼저 바꾸고 제목을 나중에 바꾸는 경우**(React Router 등): `page_view`에 직전 화면의 제목이 붙으면 ③의 화면 이름이 체계적으로 틀린다. 아직 나가지 않은 마지막 `page_view`에 새 제목을 덮어 준다. → 태스크 3 `collectors.test.ts` "라우팅 뒤에 바뀐 제목을 아직 나가지 않은 page_view 에 덮어 준다"

**알려진 한계(테스트하지 않고 README에 적는다):** 브라우저의 "탭 복제"는 sessionStorage를 복사하므로 복제한 탭이 원래 탭의 세션과 조각 번호를 이어 쓴다. 두 탭이 같은 번호의 조각을 올리면 한쪽은 저장되지 않는다.

## 파일 지도

**새로 만듦**
- `packages/sdk/src/storage.ts`: 저장소 키 상수와, 던지지 않는 읽기·쓰기·지우기
- `packages/sdk/src/identity.ts`: 세션·방문자 ID와 저장 여부(`Identity`)
- `packages/sdk/src/replay/seq-store.ts`: 리플레이 조각 번호 읽기·쓰기
- 각 테스트: `storage.test.ts`, `identity.test.ts`, `replay/seq-store.test.ts`, `apps/admin/src/replay/player.test.ts`

**고침**
- SDK: `client.ts`, `index.ts`, `collectors.ts`, `replay/uploader.ts`, `replay/index.ts`와 각 테스트
- 서버: `routes/ingestion.ts`, `db/schema.sqlite.ts`, `store/sqlite-store.ts`, `store/types.ts`와 테스트(`ingestion.test.ts`, `store-contract.test.ts`, `admin-recording.test.ts`)
- 관리자: `replay/player.ts`
- 예제: `examples/demo-site/demo.js`(화면마다 제목)
- `README.md`

---

### Task 0: 계획 커밋, 작업 워크트리와 기준선

**Files:** 이 계획 파일

- [ ] **Step 1: 계획을 main 에 커밋한다**

```bash
cd /Users/choimiae/workspace/trace
git status --short     # 이 계획 파일 하나만 보여야 한다
git add docs/superpowers/plans/2026-10-01-collect-stage2-session-continuity.md
git commit -q -m "문서: ② 수집 바꾸기 구현 계획을 쓴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: 워크트리를 만든다**

```bash
git worktree add .worktrees/collect -b feature/collect
cd .worktrees/collect
npm install
```

- [ ] **Step 3: 기준선을 잰다**

```bash
npm run typecheck
npm test 2>&1 | tail -5
```

Expected: 타입 오류 없음, `Test Files  58 passed (58)`, `Tests  588 passed (588)`. 숫자가 다르면 기록해 두고 진행한다. 실패가 있으면 멈추고 보고한다.

---

### Task 1: 저장소 도우미와 `Identity`

**Files:**
- Create: `packages/sdk/src/storage.ts`, `packages/sdk/src/identity.ts`
- Test: `packages/sdk/src/storage.test.ts`, `packages/sdk/src/identity.test.ts`

**Interfaces:**
- Produces:
  - `storage.ts`: `SESSION_KEY = "trace:session"`, `VISITOR_KEY = "trace:visitor"`, `REPLAY_SEQ_KEY = "trace:replay-seq"`, `type StorageArea = "session" | "local"`, `readItem(area, key): string | undefined`, `writeItem(area, key, value): boolean`, `removeItem(area, key): void`
  - `identity.ts`: `SESSION_IDLE_MS = 1_800_000`, `class Identity { sessionId: string; anonymousUserId: string; constructor(options: { persist: boolean; now?: () => number }); persist(): void; touch(): void; forget(): void }`

- [ ] **Step 1: 저장소 도우미 테스트를 쓴다**

테스트 전용 도우미 `packages/sdk/src/test-storage.ts`(테스트 파일이 아니라 두 테스트가 함께 가져다 쓴다):

```ts
// 쿠키를 막은 브라우저와 샌드박스 iframe 에서는 window.sessionStorage 를 읽는
// 순간 SecurityError 가 난다. jsdom 에서는 속성을 덮어 그 상태를 만든다.
export function breakStorage(name: "sessionStorage" | "localStorage"): () => void {
  const original = Object.getOwnPropertyDescriptor(window, name);
  Object.defineProperty(window, name, {
    configurable: true,
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(window, name, original);
  };
}
```

`packages/sdk/src/storage.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { readItem, removeItem, writeItem } from "./storage.js";
import { breakStorage } from "./test-storage.js";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("storage", () => {
  it("쓰고 읽고 지운다", () => {
    expect(writeItem("session", "trace:test", "1")).toBe(true);
    expect(readItem("session", "trace:test")).toBe("1");
    removeItem("session", "trace:test");
    expect(readItem("session", "trace:test")).toBeUndefined();
  });

  it("저장소 접근이 던지면 없음으로 보고 던지지 않는다", () => {
    const restore = breakStorage("localStorage");
    try {
      expect(readItem("local", "trace:test")).toBeUndefined();
      expect(writeItem("local", "trace:test", "1")).toBe(false);
      expect(() => removeItem("local", "trace:test")).not.toThrow();
    } finally {
      restore();
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run packages/sdk/src/storage.test.ts`
Expected: FAIL, `Failed to resolve import "./storage.js"`

- [ ] **Step 3: `storage.ts`를 쓴다**

```ts
// Trace 가 브라우저 저장소에 두는 키. 동의를 거부하면 이 키들만 지운다.
export const SESSION_KEY = "trace:session";
export const VISITOR_KEY = "trace:visitor";
export const REPLAY_SEQ_KEY = "trace:replay-seq";

export type StorageArea = "session" | "local";

// 저장소는 접근만으로 던질 수 있다 — 쿠키를 막은 브라우저와 샌드박스 iframe 에서는
// window.sessionStorage 를 읽는 순간 SecurityError 가 나고, 쓰기는 용량 초과로 던진다.
// 수집 때문에 고객 사이트가 깨지면 안 되므로 전부 삼키고, 읽기 실패는 "없음" 으로 본다.
function storageFor(area: StorageArea): Storage | undefined {
  try {
    return area === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readItem(area: StorageArea, key: string): string | undefined {
  try {
    return storageFor(area)?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeItem(area: StorageArea, key: string, value: string): boolean {
  try {
    const storage = storageFor(area);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(area: StorageArea, key: string): void {
  try {
    storageFor(area)?.removeItem(key);
  } catch {
    // 지우지 못해도 수집은 이미 멈췄다. 고객 사이트로 오류를 흘리지 않는다.
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run packages/sdk/src/storage.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: `Identity` 테스트를 쓴다**

`packages/sdk/src/identity.test.ts`:

```ts
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
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run packages/sdk/src/identity.test.ts`
Expected: FAIL, `Failed to resolve import "./identity.js"`

- [ ] **Step 7: `identity.ts`를 쓴다**

```ts
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
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run packages/sdk/src/storage.test.ts packages/sdk/src/identity.test.ts`
Expected: PASS (storage 2, identity 13)

- [ ] **Step 9: 전체 확인 후 커밋한다**

```bash
npm run typecheck && npm test 2>&1 | tail -5
git add packages/sdk/src/storage.ts packages/sdk/src/storage.test.ts packages/sdk/src/test-storage.ts packages/sdk/src/identity.ts packages/sdk/src/identity.test.ts
git commit -q -m "수집: 탭 단위 세션과 익명 방문자 ID 를 저장소에 둔다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `TraceClient`와 `init`이 `Identity`를 쓴다

**Files:**
- Modify: `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/client.test.ts`, `packages/sdk/src/index.test.ts`

**Interfaces:**
- Consumes: `Identity`, `SESSION_KEY`, `VISITOR_KEY`, `REPLAY_SEQ_KEY` (태스크 1)
- Produces: `TraceClientOptions.identity?: Identity`. `TraceClient.sessionId`는 읽기 전용 getter가 된다(동의 후 바뀔 수 있다). 기본값은 `new Identity({ persist: false })`라 `identity`를 넘기지 않는 기존 테스트는 저장소를 건드리지 않는다.

- [ ] **Step 1: `client.test.ts`에 테스트를 더한다**

파일 맨 위 import에 `import { Identity } from "./identity.js";`와 `import { SESSION_KEY, VISITOR_KEY } from "./storage.js";`를 더하고, `describe("TraceClient", ...)` 안 끝에 다음을 넣는다.

```ts
  describe("Identity", () => {
    afterEach(() => {
      sessionStorage.clear();
      localStorage.clear();
    });

    it("이벤트를 큐에 넣을 때마다 마지막 활동 시각을 저장한다", () => {
      let now = 1_000;
      const identity = new Identity({ persist: true, now: () => now });
      const client = new TraceClient({ projectId: "proj_1", endpoint: "https://trace.example.com/v1/events/batch", fetcher: vi.fn(), identity });

      now = 5_000;
      client.enqueue(client.createEvent({ eventId: "evt_touch1", type: "click", urlPath: "/", metadata: {} }));

      expect(JSON.parse(sessionStorage.getItem(SESSION_KEY)!)).toEqual({ sessionId: client.sessionId, lastActivityAt: 5_000 });
    });

    it("배치에 identity 의 세션과 방문자 ID 를 싣는다", async () => {
      const identity = new Identity({ persist: true });
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const client = new TraceClient({ projectId: "proj_1", endpoint: "https://trace.example.com/v1/events/batch", fetcher, identity });

      client.enqueue(client.createEvent({ eventId: "evt_ident1", type: "click", urlPath: "/", metadata: {} }));
      await client.flush();

      const payload = JSON.parse(String((fetcher.mock.calls[0] as [string, RequestInit])[1].body));
      expect(payload.sessionId).toBe(identity.sessionId);
      expect(payload.anonymousUserId).toBe(identity.anonymousUserId);
      expect(payload.events[0].sessionId).toBe(identity.sessionId);
    });

    it("동의를 거부하면 저장한 ID 를 지운다", () => {
      const identity = new Identity({ persist: true });
      const client = new TraceClient({ projectId: "proj_1", endpoint: "https://trace.example.com/v1/events/batch", fetcher: vi.fn(), identity });

      client.denyConsent();

      expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
      expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
    });
  });
```

`client.test.ts`의 vitest import에 `afterEach`가 없으면 더한다.

- [ ] **Step 2: `index.test.ts`에 테스트를 더한다**

import에 `import { REPLAY_SEQ_KEY, SESSION_KEY, VISITOR_KEY } from "./storage.js";`를 더한다. 기존 `describe("init 의 동의 게이트", ...)`의 `afterEach` 끝에 `sessionStorage.clear(); localStorage.clear();`를 더한다. 파일 끝에 새 describe를 둔다.

```ts
describe("init 의 세션 이어 가기", () => {
  afterEach(() => {
    consent.deny();
    document.head.innerHTML = "";
    delete window.__traceReplay;
    delete window.__traceReplayStop;
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  function sentBatches(fetcher: ReturnType<typeof stubFetch>["fetcher"]) {
    return fetcher.mock.calls
      .filter((call) => call[0] === ENDPOINT)
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as { sessionId: string; anonymousUserId: string });
  }

  // 새로고침은 스크립트를 처음부터 다시 실행한다. init 을 두 번 부르는 것으로 흉내 낸다.
  it("새로고침해도 같은 세션과 방문자로 보낸다", async () => {
    const { fetcher } = stubFetch();

    await init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" }).flush();
    await init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" }).flush();

    const [first, second] = sentBatches(fetcher);
    expect(second!.sessionId).toBe(first!.sessionId);
    expect(second!.anonymousUserId).toBe(first!.anonymousUserId);
  });

  it("동의 보류 중에는 저장소에 쓰지 않는다", () => {
    stubFetch();

    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "pending" });

    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
  });

  it("동의 보류에서 grant 하면 저장된 세션을 이어 받고 리플레이도 그 세션으로 올린다", async () => {
    stubFetch();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sessionId: "sess_Stored12345", lastActivityAt: Date.now() }));

    const client = init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "pending" });
    consent.grant();
    await settle();

    expect(client.sessionId).toBe("sess_Stored12345");
    expect(window.__traceReplay?.sessionId).toBe("sess_Stored12345");
    expect(window.__traceReplay?.endpoint).toBe("https://trace.example.com/v1/sessions/sess_Stored12345/recording");
  });

  it("거부하면 Trace 가 저장소에 둔 키를 지운다", () => {
    stubFetch();
    init({ projectId: "proj_1", endpoint: ENDPOINT, consent: "granted" });
    sessionStorage.setItem(REPLAY_SEQ_KEY, JSON.stringify({ sessionId: "sess_x", next: 2 }));

    consent.deny();

    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(REPLAY_SEQ_KEY)).toBeNull();
    expect(localStorage.getItem(VISITOR_KEY)).toBeNull();
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx vitest run packages/sdk/src/client.test.ts packages/sdk/src/index.test.ts`
Expected: 새 테스트들이 FAIL(`identity` 옵션이 무시돼 세션 ID 가 다르고, 저장소가 비어 있다). 타입 오류(`identity` 속성 없음)도 난다.

- [ ] **Step 4: `client.ts`를 고친다**

- import에 `import { Identity } from "./identity.js";`를 더한다.
- `TraceClientOptions`에 `identity?: Identity;`를 더한다(주석: `/** 세션·방문자 ID. 넘기지 않으면 저장하지 않는 메모리 ID 를 쓴다. */`).
- 필드 `private readonly anonymousUserId = ...;`와 `readonly sessionId = ...;`를 지우고 `private readonly identity: Identity;`를 둔다. 생성자에서 `this.identity = options.identity ?? new Identity({ persist: false });`.
- getter를 더한다.

```ts
  // 동의 보류에서 grant() 가 오면 저장된 세션을 이어 받아 바뀔 수 있다. 값을 들고
  // 있지 말고 부를 때마다 읽는다.
  get sessionId(): string {
    return this.identity.sessionId;
  }
```

- 동의 메서드:

```ts
  grantConsent() {
    this.consent = "granted";
    this.identity.persist();
  }

  denyConsent() {
    this.consent = "denied";
    this.queue = [];
    this.identity.forget();
  }
```

- `createEvent`의 `sessionId: this.sessionId`는 그대로 둔다(getter를 읽는다).
- `enqueue`에서 `this.queue.push(event);` 다음 줄에 `this.identity.touch();`를 더한다.
- `flush`의 배치에서 `anonymousUserId: this.anonymousUserId`를 `anonymousUserId: this.identity.anonymousUserId`로 바꾼다.

- [ ] **Step 5: `index.ts`를 고친다**

```ts
import { TraceClient } from "./client.js";
import { installCollectors } from "./collectors.js";
import { Identity } from "./identity.js";
import { autoInstall, type Consent, type InstallOptions } from "./install.js";
import { loadReplay, stopReplay } from "./replay-loader.js";

let client: TraceClient | undefined;
// 동의 상태를 여기에도 둔다. TraceClient 는 자기 큐만 막을 뿐이고, 리플레이는
// 그 큐를 지나지 않는 별도 경로다.
let consentState: Consent = "granted";
let replayTarget: { projectId: string; endpoint: string } | undefined;

function startReplayIfAllowed(): void {
  if (!client || !replayTarget) return;
  // 리플레이는 켜진 프로젝트에서만 켜진다. 실패해도 수집은 계속돼야 하므로
  // 기다리지 않고, loadReplay 는 절대 던지지 않는다.
  //
  // 세션 ID 는 부를 때 읽는다. 동의 보류에서 grant() 가 오면 저장소에 있던 세션을
  // 이어 받아 ID 가 바뀌므로, init 때 읽어 둔 값으로 올리면 리플레이만 다른 세션이 된다.
  void loadReplay({ ...replayTarget, sessionId: client.sessionId, isGranted: () => consentState === "granted" });
}

export function init(options: { projectId: string; endpoint?: string; consent?: Consent }) {
  const endpoint = options.endpoint ?? "/v1/events/batch";
  consentState = options.consent ?? "granted";
  client = new TraceClient({
    projectId: options.projectId,
    endpoint,
    consent: consentState,
    // 동의가 있을 때만 저장소를 읽고 쓴다. 보류면 grant() 가 TraceClient 를 거쳐 persist() 를 부른다.
    identity: new Identity({ persist: consentState === "granted" }),
  });
  installCollectors(client);
  replayTarget = { projectId: options.projectId, endpoint };
  startReplayIfAllowed();
  return client;
}
```

`consent` 객체와 나머지는 그대로 둔다.

- [ ] **Step 6: 통과와 전체를 확인한다**

```bash
npx vitest run packages/sdk/src/client.test.ts packages/sdk/src/index.test.ts
grep -n "sessionId" packages/sdk/src/index.ts
npm run typecheck && npm test 2>&1 | tail -5
```

Expected: 모두 PASS. grep 결과는 `startReplayIfAllowed` 안의 `sessionId: client.sessionId` 한 줄뿐이다(init 때 세션 ID 를 복사해 두는 자리가 없다).

- [ ] **Step 7: 커밋한다**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/client.test.ts packages/sdk/src/index.ts packages/sdk/src/index.test.ts
git commit -q -m "수집: 동의에 따라 세션·방문자 ID 를 저장하고 새로고침에도 잇는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `page_view`에 화면 제목을 싣는다

**Files:**
- Modify: `packages/sdk/src/collectors.ts`, `examples/demo-site/demo.js`
- Test: `packages/sdk/src/collectors.test.ts`

**Interfaces:**
- Consumes: 계약의 `titleMasked?: string`(max 120, `packages/shared/src/events.ts`에 이미 있다). 서버 `sanitizeEvent`가 이미 `redactText`로 한 번 더 정리해 저장한다(`title_masked` 열). 서버는 고치지 않는다.

- [ ] **Step 1: 테스트를 쓴다**

`collectors.test.ts` 끝에 더한다. 이 파일의 `captured`는 `enqueue`에 넘어온 **같은 객체**를 담으므로, 나중에 덮어쓴 제목도 보인다.

```ts
describe("page_view 제목", () => {
  afterEach(() => {
    document.title = "";
  });

  function pageViewTitles(): Array<string | undefined> {
    return captured
      .filter((event) => event.type === "page_view")
      .map((event) => (event as { titleMasked?: string }).titleMasked);
  }

  it("화면 제목을 마스킹해 page_view 에 싣는다", () => {
    document.title = "고객 choi@example.com 상세";

    installCollectors(makeClient());

    expect(pageViewTitles()).toEqual(["고객 [redacted] 상세"]);
  });

  // 계약은 빈 문자열을 막지 않지만 집계는 "제목이 없으면 경로" 로 물러선다.
  // 빈 문자열이 들어가면 그 화면 이름이 빈칸이 된다.
  it("제목이 비어 있으면 titleMasked 를 넣지 않는다", () => {
    document.title = "   ";

    installCollectors(makeClient());

    expect(captured[0]).not.toHaveProperty("titleMasked");
  });

  it("라우팅 뒤에 바뀐 제목을 아직 나가지 않은 page_view 에 덮어 준다", async () => {
    document.title = "대시보드";
    installCollectors(makeClient());

    // SPA 라우터의 순서다: 경로를 먼저 바꾸고, 렌더 뒤에 제목을 바꾼다.
    window.history.pushState({}, "", "/billing");
    document.title = "청구";
    // MutationObserver 콜백은 마이크로태스크로 온다.
    await Promise.resolve();

    expect(pageViewTitles()).toEqual(["대시보드", "청구"]);
  });

  it("제목이 비워지면 덮어 둔 제목도 지운다", async () => {
    document.title = "대시보드";
    installCollectors(makeClient());

    document.title = "";
    await Promise.resolve();

    expect(captured[0]).not.toHaveProperty("titleMasked");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run packages/sdk/src/collectors.test.ts`
Expected: 새 테스트 4개 중 "비어 있으면"을 뺀 셋이 FAIL(`titleMasked`가 없다)

- [ ] **Step 3: `collectors.ts`를 고친다**

- import를 `import { redactText, redactUrl } from "@trace/shared/privacy";`로 바꾸고 `import type { TraceEvent } from "@trace/shared";`를 더한다.
- `measuredViewport` 아래에 함수를 둔다.

```ts
// 제목은 마스킹해 싣는다. redactText 는 이메일·전화·9자리 이상 숫자만 지우므로
// 제목에 든 사람 이름은 남는다(README 의 수집 표에 적었다). 비어 있으면 넣지
// 않는다 - 집계는 제목이 없으면 경로로 화면 이름을 대신한다.
function pageTitle(): Pick<TraceEvent, "titleMasked"> {
  const title = redactText(document.title.trim());
  return title ? { titleMasked: title } : {};
}
```

- `sendPageView`를 바꾼다.

```ts
  // 마지막으로 만든 page_view. 아래 제목 감시가 덮어쓴다.
  let lastPageView: TraceEvent | undefined;

  const sendPageView = (urlPath: string) => {
    const event = client.createEvent({
      eventId: `evt_${nanoid(10)}`,
      type: "page_view",
      urlPath,
      ...pageTitle(),
      metadata: {},
    });
    lastPageView = event;
    client.enqueue(event);
  };
```

- `installNavigationWatcher(...)` 호출 바로 뒤에 제목 감시를 둔다.

```ts
  // SPA 라우터는 경로를 먼저 바꾸고 제목은 렌더 뒤에 바꾼다. 그래서 라우팅 순간에
  // 읽은 제목은 직전 화면의 것이다 - 그대로 두면 ③ 의 화면 이름이 화면마다 한
  // 칸씩 밀린다. 제목이 바뀌면 같은 경로의 마지막 page_view 에 덮어 준다.
  //
  // 큐에 있는 객체를 고치는 것이 맞다. flush 는 큐의 이벤트를 복사해 보내므로,
  // 이미 나간 page_view 는 여기서 고쳐도 아무 데도 닿지 않는다.
  const titleObserver = new MutationObserver(() => {
    try {
      if (!lastPageView || lastPageView.urlPath !== currentPath()) return;
      const { titleMasked } = pageTitle();
      if (titleMasked) lastPageView.titleMasked = titleMasked;
      else delete lastPageView.titleMasked;
    } catch {
      // 고객 사이트의 DOM 변경 안에서 도는 콜백이다. 던지지 않는다.
    }
  });
  // <title> 은 통째로 바뀌기도 하고(childList) 글자만 바뀌기도 한다(characterData).
  if (document.head) {
    titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true });
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run packages/sdk/src/collectors.test.ts packages/sdk/src/bundle-size.test.ts`
Expected: PASS

- [ ] **Step 5: 데모 사이트가 화면마다 제목을 바꾸게 한다**

③의 화면 이름과 이 태스크를 데모에서 확인하려면 제목이 화면마다 달라야 한다. 지금은 언제나 `Trace Demo SaaS`다.

`examples/demo-site/demo.js`:
- `navKeyFor` 아래에 둔다.

```js
// 화면 이름이 제목에서 나온다. 실제 SPA 처럼 렌더할 때 제목을 바꾼다.
function titleFor(path) {
  const label = NAV.find((item) => item.path === navKeyFor(path))?.label ?? "대시보드";
  return `${label} - Trace Demo SaaS`;
}
```

- `render()`의 `renderChrome(path);` 다음 줄에 `document.title = titleFor(path);`를 더한다.
- `push-route` 클릭 처리기의 `bindViewHandlers();` 다음 줄에 `document.title = titleFor("/invoices");`를 더한다. 이 경로는 `pushState`가 먼저 불리고 제목이 나중에 바뀌는, Review Focus 5번의 순서다.

- [ ] **Step 6: 전체 확인 후 커밋한다**

```bash
npm run typecheck && npm test 2>&1 | tail -5
git add packages/sdk/src/collectors.ts packages/sdk/src/collectors.test.ts examples/demo-site/demo.js
git commit -q -m "수집: page_view 에 마스킹한 화면 제목을 싣는다

라우팅 뒤에 바뀐 제목은 아직 나가지 않은 page_view 에 덮어 준다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 리플레이 조각 번호를 페이지를 넘어 잇는다

**Files:**
- Create: `packages/sdk/src/replay/seq-store.ts`, `packages/sdk/src/replay/seq-store.test.ts`
- Modify: `packages/sdk/src/replay/uploader.ts`, `packages/sdk/src/replay/index.ts`
- Test: `packages/sdk/src/replay/uploader.test.ts`, `packages/sdk/src/replay/index.test.ts`

**Interfaces:**
- Consumes: `readItem`, `writeItem`, `REPLAY_SEQ_KEY` (태스크 1). `Identity.forget()`가 이미 `REPLAY_SEQ_KEY`를 지운다.
- Produces: `readNextSeq(sessionId: string): number`, `writeNextSeq(sessionId: string, next: number): void`. `RecordingUploader` 옵션 `firstSeq?: number`, `onSeqClaimed?: (nextSeq: number) => void`.

- [ ] **Step 1: `seq-store` 테스트를 쓴다**

`packages/sdk/src/replay/seq-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { REPLAY_SEQ_KEY } from "../storage.js";
import { readNextSeq, writeNextSeq } from "./seq-store.js";

afterEach(() => sessionStorage.clear());

describe("seq-store", () => {
  it("같은 세션이 남긴 다음 번호를 읽는다", () => {
    writeNextSeq("sess_1", 5);

    expect(readNextSeq("sess_1")).toBe(5);
  });

  it("다른 세션이 남긴 번호는 쓰지 않는다", () => {
    writeNextSeq("sess_other", 9);

    expect(readNextSeq("sess_1")).toBe(0);
  });

  it.each([
    ["없음", null],
    ["JSON 이 아님", "{oops"],
    ["음수", JSON.stringify({ sessionId: "sess_1", next: -1 })],
    ["소수", JSON.stringify({ sessionId: "sess_1", next: 1.5 })],
  ])("값이 쓸 수 없으면 0 부터 매긴다 (%s)", (_label, raw) => {
    if (raw !== null) sessionStorage.setItem(REPLAY_SEQ_KEY, raw);

    expect(readNextSeq("sess_1")).toBe(0);
  });
});
```

- [ ] **Step 2: 실패를 확인하고 `seq-store.ts`를 쓴다**

Run: `npx vitest run packages/sdk/src/replay/seq-store.test.ts` → FAIL(모듈 없음)

```ts
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
```

Run again → PASS (6 tests)

- [ ] **Step 3: 업로더 테스트를 더한다**

`uploader.test.ts`의 `createUploader`에 옵션을 넘길 수 있게 `overrides` 타입을 `Partial<{ currentUrl: () => string; firstSeq: number; onSeqClaimed: (next: number) => void }>`로 넓히고, 생성자 인자에 `...(overrides.firstSeq === undefined ? {} : { firstSeq: overrides.firstSeq }), ...(overrides.onSeqClaimed ? { onSeqClaimed: overrides.onSeqClaimed } : {}),`를 더한다. `describe("RecordingUploader", ...)` 안 끝에 넣는다.

```ts
  describe("페이지를 넘는 번호", () => {
    it("firstSeq 부터 번호를 매긴다", async () => {
      const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
      const uploader = createUploader(fetcher, { firstSeq: 7 });

      uploader.enqueue([event(1)]);
      await uploader.flush();
      uploader.enqueue([event(2)]);
      await uploader.flush();

      expect(bodyOf(fetcher.mock.calls[0]!).seq).toBe(7);
      expect(bodyOf(fetcher.mock.calls[1]!).seq).toBe(8);
    });

    // 페이지 이탈 flush 는 전송을 기다리는 사이 페이지가 사라진다. 번호를 저장하는
    // 일이 전송 뒤에 있으면 다음 페이지가 같은 번호를 다시 쓴다.
    it("번호를 매기는 즉시, 전송을 기다리기 전에 onSeqClaimed 를 부른다", () => {
      const fetcher = vi.fn(() => new Promise<never>(() => {}));
      const onSeqClaimed = vi.fn();
      const uploader = createUploader(fetcher, { firstSeq: 3, onSeqClaimed });

      uploader.enqueue([event(1)]);
      void uploader.flush({ keepalive: true });

      expect(onSeqClaimed).toHaveBeenCalledWith(4);
    });

    it("onSeqClaimed 가 던져도 올린다", async () => {
      const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
      const uploader = createUploader(fetcher, {
        onSeqClaimed: () => {
          throw new Error("quota");
        },
      });

      uploader.enqueue([event(1)]);
      await uploader.flush();

      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });
```

- [ ] **Step 4: 실패를 확인하고 업로더를 고친다**

Run: `npx vitest run packages/sdk/src/replay/uploader.test.ts` → 새 테스트 3개 FAIL(타입 오류 포함)

`uploader.ts`:
- 생성자 `options` 타입에 더한다.

```ts
      /** 첫 조각 번호. 같은 세션의 앞 페이지가 쓴 번호 다음부터 잇는다. */
      firstSeq?: number;
      /** 번호를 하나 매길 때마다 다음 번호를 넘겨 부른다. 다음 페이지가 이어 가도록 저장하는 자리다. */
      onSeqClaimed?: (nextSeq: number) => void;
```

- 생성자 본문 끝에 `this.nextSeq = options.firstSeq ?? 0;`을 더한다(필드 선언 `private nextSeq = 0;`은 그대로 둔다).
- `flush()`의 claim 블록을 바꾼다.

```ts
    if (this.unclaimed.length > 0) {
      this.outstanding.push({ seq: this.nextSeq++, events: this.unclaimed, keepalive });
      this.unclaimed = [];
      // 번호는 매긴 즉시 알린다. 페이지 이탈 flush 는 아래 await 를 마치기 전에
      // 페이지가 사라질 수 있다 - 저장이 그 뒤에 있으면 다음 페이지가 같은 번호를
      // 다시 쓰고, 서버의 (session_id, seq) INSERT OR IGNORE 가 그 조각을 버린다.
      try {
        this.options.onSeqClaimed?.(this.nextSeq);
      } catch {
        // 저장에 실패해도 올리는 일은 계속한다.
      }
    }
```

Run again → PASS

- [ ] **Step 5: `startReplay` 테스트를 더한다**

`replay/index.test.ts` import에 `import { REPLAY_SEQ_KEY } from "../storage.js";`를 더하고, `describe("startReplay", ...)` 안 끝에 넣는다. 업로더를 주입하지 않아 진짜 `RecordingUploader`가 돈다. 번호는 `flush()` 안에서 동기로 매겨지므로 타이머를 한 주기 돌리면 저장값이 바뀌어 있다.

```ts
  describe("조각 번호 이어 가기", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 202 })));
      sessionStorage.clear();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      sessionStorage.clear();
    });

    // 마스킹 함수들이 건드리지 않는 Custom 이벤트(type 5)를 흘린다.
    function emitOne(): void {
      const options = record.mock.calls[0]![0] as { emit: (event: unknown) => void };
      options.emit({ type: 5, timestamp: Date.now(), data: { tag: "probe", payload: {} } });
    }

    it("앞 페이지가 남긴 번호 다음부터 매기고 다음 번호를 남긴다", () => {
      sessionStorage.setItem(REPLAY_SEQ_KEY, JSON.stringify({ sessionId: "sess_1", next: 5 }));

      startReplay(config);
      emitOne();
      vi.advanceTimersByTime(10_000);

      expect(JSON.parse(sessionStorage.getItem(REPLAY_SEQ_KEY)!)).toEqual({ sessionId: "sess_1", next: 6 });
    });

    it("다른 세션이 남긴 번호는 이어 받지 않는다", () => {
      sessionStorage.setItem(REPLAY_SEQ_KEY, JSON.stringify({ sessionId: "sess_other", next: 9 }));

      startReplay(config);
      emitOne();
      vi.advanceTimersByTime(10_000);

      expect(JSON.parse(sessionStorage.getItem(REPLAY_SEQ_KEY)!)).toEqual({ sessionId: "sess_1", next: 1 });
    });
  });
```

- [ ] **Step 6: 실패를 확인하고 `startReplay`를 고친다**

Run: `npx vitest run packages/sdk/src/replay/index.test.ts` → 새 테스트 2개 FAIL(저장값이 그대로이거나 없다)

`replay/index.ts`:
- import에 `import { readNextSeq, writeNextSeq } from "./seq-store.js";`를 더한다.
- 기본 업로더 생성을 바꾼다.

```ts
    new RecordingUploader({
      endpoint: config.endpoint,
      projectId: config.projectId,
      sdkVersion: SDK_VERSION,
      // 같은 탭에서 페이지를 새로 불러오면 세션이 이어진다. 번호도 이어서 매겨야
      // 서버가 새 페이지의 조각을 앞 페이지 조각과 겹친 것으로 보고 버리지 않는다.
      firstSeq: readNextSeq(config.sessionId),
      onSeqClaimed: (next) => writeNextSeq(config.sessionId, next),
    });
```

리플레이는 동의가 있을 때만 시작하므로(`loadReplay`의 `isGranted`) 여기서 저장소에 써도 동의 규칙을 어기지 않는다. 거부하면 `Identity.forget()`이 이 키를 지우고 `stopReplay()`가 기록기를 멈춘다.

Run again → PASS

- [ ] **Step 7: 전체 확인 후 커밋한다**

```bash
npm run typecheck && npm test 2>&1 | tail -5
git add packages/sdk/src/replay/seq-store.ts packages/sdk/src/replay/seq-store.test.ts packages/sdk/src/replay/uploader.ts packages/sdk/src/replay/uploader.test.ts packages/sdk/src/replay/index.ts packages/sdk/src/replay/index.test.ts
git commit -q -m "리플레이: 같은 세션의 조각 번호를 페이지를 넘어 잇는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 서버가 방문자 ID 를 저장하고 이벤트 종류부터 거른다

**Files:**
- Modify: `apps/api/src/db/schema.sqlite.ts`, `apps/api/src/store/sqlite-store.ts`, `apps/api/src/store/types.ts`, `apps/api/src/routes/ingestion.ts`
- Test: `apps/api/src/routes/ingestion.test.ts`, `apps/api/src/store/store-contract.test.ts`, `apps/api/src/routes/admin-recording.test.ts`

**Interfaces:**
- Produces: `SessionSummary.anonymousUserId: string`(③의 세션 행 "방문자 ID 일부"와 방문자 수 집계가 쓴다). 관리자 화면 `apps/admin/src/api.ts`의 타입은 ③에서 넓힌다. 지금은 여분 필드라 화면이 무시한다.

- [ ] **Step 1: 테스트를 고치고 더한다**

`store-contract.test.ts`의 "세션 목록" 테스트(595행 근처)에서 두 `toEqual` 기대값에 `anonymousUserId: "anon_1",`을 `sessionId` 다음 줄에 더한다. 같은 describe 안에 테스트를 더한다.

```ts
    it("세션의 방문자 ID 를 돌려준다", async () => {
      const store = open();
      const project = await store.createProject({ name: "p", allowedDomains: ["https://demo.example.com"] });
      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_visitor1",
        sessionId: "sess_v1",
        sentAt: "2026-10-01T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/",
        events: [{ eventId: "evt_v1", sessionId: "sess_v1", pageId: "page_1", timestamp: "2026-10-01T00:00:00.000Z", type: "page_view", urlPath: "/", metadata: {} }],
      });

      const [session] = await store.listSessions(project.projectId, 10);

      expect(session?.anonymousUserId).toBe("anon_visitor1");
    });
```

`admin-recording.test.ts`의 "모든 세션을 최근 순으로 돌려준다"(270행 근처) 기대값에 `anonymousUserId: "anon_1",`을 더한다.

`ingestion.test.ts`:
- "does not store unsafe raw identifiers or element labels"의 `const [session] = ...` 다음에 `expect(session?.anonymousUserId).toMatch(/^anon_/);`와 `expect(session?.anonymousUserId).not.toContain("choi");`를 더한다.
- 새 테스트를 "남는 이벤트가 없어도 202 로 받는다" 다음에 둔다.

```ts
  // 걷어낸 종류는 옛 SDK 가 보내는 모양 그대로 온다. 버릴 이벤트의 필드를 검사해
  // 배치 전체를 400 으로 떨어뜨리면 같은 배치의 멀쩡한 클릭까지 잃는다.
  it("버릴 종류의 이벤트는 필드가 계약과 달라도 배치를 떨어뜨리지 않는다", async () => {
    const store = createTestStore();
    const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://app.example.com" },
      payload: batchPayload(project.projectId, [
        { type: "js_error", timestamp: "어제", message: "x".repeat(2000) },
        "not-an-object",
        { eventId: "evt_2", sessionId: "sess_1", pageId: "page_1", timestamp: "2026-09-30T00:00:01.000Z", type: "click", urlPath: "/quote", metadata: {} },
      ]),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 1 });
    await app.close();
  });

  it("남길 종류의 이벤트가 계약과 다르면 지금처럼 400 이다", async () => {
    const store = createTestStore();
    const project = await store.createProject({ name: "p", allowedDomains: ["https://app.example.com"] });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://app.example.com" },
      payload: batchPayload(project.projectId, [{ type: "click", timestamp: "어제" }]),
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run apps/api/src`
Expected: 세션 목록 기대값과 방문자 ID 테스트, "버릴 종류" 테스트가 FAIL(지금은 400)

- [ ] **Step 3: 스키마와 저장소를 고친다**

`schema.sqlite.ts`의 `events` 테이블에서 `session_id TEXT NOT NULL,` 다음 줄에 `anonymous_user_id TEXT NOT NULL,`을 더한다.

`sqlite-store.ts` `saveBatch`:
- 열 목록 `(event_id, project_id, session_id, page_id, ...` 을 `(event_id, project_id, session_id, anonymous_user_id, page_id, ...`로 바꾸고 `VALUES`의 `?`를 하나 늘린다(19개 → 20개).
- `insert.run(` 인자에서 `event.sessionId,` 다음에 `batch.anonymousUserId,`를 더한다.

`listSessions`의 SELECT에 `MIN(e.anonymous_user_id) AS anonymous_user_id,`를 `MAX(e.timestamp) AS last_seen_at,` 다음에 더하고, 매핑에 `anonymousUserId: row.anonymous_user_id as string,`를 `sessionId` 다음에 더한다. 한 세션의 이벤트는 한 탭에서 오므로 방문자 ID 는 하나다. `MIN`은 집계 문법을 맞추려는 것이다.

`types.ts` `SessionSummary`의 `sessionId` 다음에 더한다.

```ts
  /** 이 세션을 만든 브라우저의 익명 방문자 ID(`anon_…`). */
  anonymousUserId: string;
```

`events`에 직접 INSERT 하는 다른 곳이 없는지 확인한다.

```bash
grep -rn "INTO events" apps/api/src
```

Expected: `sqlite-store.ts`의 한 곳뿐이다.

- [ ] **Step 4: 수집 API 가 종류부터 보게 한다**

`ingestion.ts`:
- `rawEventBatchSchema`의 `events: z.array(rawTraceEventSchema).min(1).max(100),`를 `events: z.array(z.unknown()).min(1).max(100),`로 바꾼다.
- `KEPT_EVENT_TYPES` 아래에 둔다.

```ts
// 종류부터 본다. 걷어낸 종류(js_error·custom 등)는 옛 SDK 가 보내는 모양 그대로
// 오므로, 버릴 이벤트의 필드까지 검사하면 같은 배치의 멀쩡한 이벤트가 400 으로
// 함께 떨어진다. 남길 종류만 필드를 검사한다 - 그쪽이 틀리면 지금처럼 400 이다.
function isKeptEvent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && KEPT_EVENT_TYPES.has(type);
}
```

- 라우트의 `const keptEvents = rawBatch.events.filter((event) => KEPT_EVENT_TYPES.has(event.type));`를 `const keptEvents = rawBatch.events.filter(isKeptEvent).map((event) => rawTraceEventSchema.parse(event));`로 바꾼다. `rawTraceEventSchema.parse`가 던지는 `ZodError`는 아래 catch가 400으로 바꾼다.

- [ ] **Step 5: 통과와 전체를 확인하고 커밋한다**

```bash
npx vitest run apps/api/src
npm run typecheck && npm test 2>&1 | tail -5
git add apps/api/src
git commit -q -m "서버: 방문자 ID 를 저장하고 수집 API 가 이벤트 종류부터 거른다

events 에 anonymous_user_id 열을 더한다. 마이그레이션은 두지 않는다 —
로컬 DB 는 새로 만든다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 재생기가 쉬는 구간을 건너뛴다

**Files:**
- Modify: `apps/admin/src/replay/player.ts`
- Test: `apps/admin/src/replay/player.test.ts`(새로 만듦)

이제 한 세션이 새로고침과 페이지 이동을 넘어 30분 무활동까지 이어지므로, 기록 안에 아무 일도 없는 구간이 길어진다. rrweb 의 `skipInactive`는 그런 구간을 빠르게 넘긴다. 여러 전체 스냅샷(페이지마다 하나)은 `Replayer`가 이미 받아 다시 그린다 — 코드 변경 없이 태스크 8에서 브라우저로 확인한다.

- [ ] **Step 1: 테스트를 쓴다**

`apps/admin/src/replay/player.test.ts`:

```ts
import { expect, it, vi } from "vitest";

// Replayer 는 jsdom 에서 돌지 않는다. 생성 옵션만 본다.
const { constructed } = vi.hoisted(() => ({ constructed: [] as unknown[] }));
vi.mock("rrweb", () => ({
  Replayer: class {
    wrapper = document.createElement("div");
    constructor(_events: unknown[], config: unknown) {
      constructed.push(config);
    }
    on() {}
    addEvent() {}
    play() {}
    pause() {}
    setConfig() {}
    destroy() {}
  },
}));
vi.mock("rrweb/dist/rrweb.css", () => ({}));

const { createPlayer } = await import("./player.js");

it("쉬는 구간을 건너뛰며 재생한다", () => {
  const mount = document.createElement("div");

  createPlayer(mount, []);

  expect(constructed[0]).toMatchObject({ root: mount, skipInactive: true });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run apps/admin/src/replay/player.test.ts`
Expected: FAIL, `skipInactive` 가 없다

- [ ] **Step 3: `player.ts`를 고친다**

`const replayer = new Replayer(firstEvents as never[], { root: mount });`를 다음으로 바꾼다.

```ts
  // 쉬는 구간을 건너뛴다. 세션이 새로고침과 페이지 이동을 넘어 30분 무활동까지
  // 이어지므로 기록 안에 아무 일도 없는 구간이 길어진다 - 그대로 재생하면 그
  // 시간만큼 화면이 멈춘 것처럼 보인다.
  const replayer = new Replayer(firstEvents as never[], { root: mount, skipInactive: true });
```

- [ ] **Step 4: 통과와 전체를 확인하고 커밋한다**

```bash
npx vitest run apps/admin/src/replay
npm run typecheck && npm test 2>&1 | tail -5
git add apps/admin/src/replay/player.ts apps/admin/src/replay/player.test.ts
git commit -q -m "리플레이: 재생기가 쉬는 구간을 건너뛴다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: README 를 고친다

**Files:**
- Modify: `README.md`
- Test: `packages/sdk/src/replay/index.integration.test.ts`의 README 표 확인 테스트가 계속 통과해야 한다

- [ ] **Step 1: "수집하는 것과 수집하지 않는 것" 표를 고친다**

`| 쿠키, localStorage, sessionStorage | 사용하지 않습니다 |` 줄을 다음 세 줄로 바꾼다.

```markdown
| 쿠키 | 사용하지 않습니다 |
| sessionStorage | 탭 하나의 세션 ID와 마지막 활동 시각을 둡니다(`trace:session`). 리플레이를 켠 프로젝트는 녹화 조각 번호도 둡니다(`trace:replay-seq`). 같은 탭에서는 새로고침하거나 페이지를 새로 불러와도 세션이 이어지고, 30분 동안 활동이 없었으면 다음에 페이지를 불러올 때 새 세션을 시작합니다. 새 탭은 새 세션입니다. 브라우저의 탭 복제는 sessionStorage를 함께 복사하므로 복제한 탭이 원래 탭의 세션을 이어 쓰고, 리플레이를 켠 경우 두 탭의 조각 번호가 겹쳐 한쪽 조각이 저장되지 않을 수 있습니다 |
| localStorage | 익명 방문자 ID를 둡니다(`trace:visitor`) |
```

`| 방문자 ID | 페이지를 열 때마다 새로 만들고 저장하지 않습니다. 새로고침하면 다른 ID가 됩니다 |` 줄을 바꾼다.

```markdown
| 방문자 ID | 브라우저마다 `anon_`으로 시작하는 무작위 ID를 하나 만듭니다. 계정·이메일과 연결하지 않습니다. 저장소를 쓸 수 없는 브라우저(저장소 차단, 일부 사생활 보호 모드)에서는 페이지를 불러올 때마다 새로 만들고, 그때는 세션도 페이지 단위가 됩니다 |
```

`| 페이지 제목 | 지금은 수집하지 않습니다(이후 단계에서 다시 들어옵니다) |` 줄을 바꾼다.

```markdown
| 페이지 제목 | 화면에 들어올 때 `document.title`을 마스킹하고 120자로 제한해 기록합니다. 마스킹은 이메일·한국 휴대폰·9자리 이상 숫자만 지우므로 **제목에 든 사람 이름은 저장됩니다** |
```

- [ ] **Step 2: "동의 배너를 쓰는 경우" 절에 동작을 적는다**

`window.trace.consent.grant();` 코드 블록 바로 뒤에 둔다.

```markdown
동의를 기다리는 동안에는 이벤트를 보내지 않고 sessionStorage·localStorage를 읽지도 쓰지도 않습니다. `grant()`가 오면 그때부터 저장하고, 같은 탭에 이어 갈 세션이 남아 있으면 그 세션을 이어 받습니다. 배너가 동의를 기억해 페이지마다 곧바로 `grant()`를 부르는 사이트도 새로고침을 넘어 한 세션으로 이어집니다.

동의를 거두면 `window.trace.consent.deny()`를 부르세요. 수집과 리플레이 녹화를 멈추고 Trace가 저장소에 둔 키(`trace:session`, `trace:replay-seq`, `trace:visitor`)를 지웁니다.
```

- [ ] **Step 3: "스펙과 계획" 절에 이 계획을 더한다**

`- 계획(① 걷어내기): ...` 줄 다음에 `- 계획(② 수집 바꾸기): \`docs/superpowers/plans/2026-10-01-collect-stage2-session-continuity.md\``를 더한다.

- [ ] **Step 4: 확인하고 커밋한다**

```bash
grep -n "사용하지 않습니다\|저장하지 않습니다\|수집하지 않습니다" README.md
npm test 2>&1 | tail -5
git add README.md
git commit -q -m "문서: README 에 세션·방문자 저장과 페이지 제목 수집을 적는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

grep 결과에 쿠키·IP·입력값 원문처럼 여전히 사실인 줄만 남아 있어야 한다.

---

### Task 8: 데모에서 확인하고 체크포인트 비용을 잰다

**Files:** 결과에 따라 `packages/sdk/src/replay/index.ts`의 `checkoutEveryNms` 주석(과 필요하면 `packages/shared/src/recording-limits.ts`의 `CHECKPOINT_INTERVAL_MS`)

- [ ] **Step 1: 빌드와 전체 확인**

```bash
npm run build
npm run typecheck
npm test 2>&1 | tail -5
```

Expected: 빌드 성공, 타입 오류 없음, 전체 PASS.

- [ ] **Step 2: 개발 서버를 새 DB 로 띄운다**

`events`에 열이 늘었으므로 DB 를 새로 만들어야 한다. 옛 DB 를 쓰면 `CREATE TABLE IF NOT EXISTS`가 옛 테이블을 그대로 두어 수집이 `no such column`으로 실패한다.

```bash
cp /Users/choimiae/workspace/trace/.env .env 2>/dev/null || cp .env.example .env
cp /Users/choimiae/workspace/trace/apps/api/.env apps/api/.env 2>/dev/null || cp apps/api/.env.example apps/api/.env
lsof -iTCP -sTCP:LISTEN -P | grep -E ':(3000|4000|5173)\b'
```

포트 3000·4000·5173을 다른 프로세스(메인 저장소의 개발 서버)가 쓰고 있으면 멈추고 사용자에게 알린다. 그 서버는 옛 번들을 내려준다.

```bash
TRACE_DB_PATH=./trace.stage2.db npm run dev:api     # 백그라운드
npm run dev:admin                                    # 백그라운드
npm run dev:demo                                     # 백그라운드
curl -s http://localhost:4000/trace.js | grep -c "trace:session"
```

Expected: 마지막 줄이 `1` 이상이다(새 번들을 내려준다).

- [ ] **Step 3: 브라우저에서 확인한다(스크린샷을 남긴다)**

1. `http://localhost:5173` → 로컬 로그인 → 프로젝트 생성(이름 `데모`, 허용 도메인 `http://localhost:3000`) → 프로젝트 설정에서 리플레이를 켠다.
2. `http://localhost:3000/?projectId=<프로젝트 ID>`를 연다. 개발자 도구 Application 탭에서 sessionStorage `trace:session`과 localStorage `trace:visitor`가 생겼는지 본다.
3. 대시보드 → 고객사 → 고객 상세로 오가며 버튼을 누르고, **새로고침(F5)을 두 번** 한다. 청구 화면의 `pushState` 버튼도 누른다. 새로고침 사이마다 10초 넘게 머문다.
4. 새 탭으로 같은 주소를 하나 더 열어 한 번 클릭한다.
5. 관리자 세션 목록: 첫 탭의 세션이 **한 줄**이고 이벤트 수가 새로고침 전후를 합친 값인지, 새 탭은 **다른 줄**인지 본다.
6. 첫 탭 세션의 재생 버튼: 새로고침 지점을 지나도 재생이 멈추지 않고 다음 페이지 화면으로 이어지는지, 오래 머문 구간을 빠르게 넘기는지 본다.

하나라도 안 되면 멈추고 보고한다.

- [ ] **Step 4: 제목과 체크포인트 비용을 DB 에서 읽는다**

읽기만 하는 스크립트다. 스크래치 디렉터리에 쓴다(저장소에 넣지 않는다).

```bash
cat > "$TMPDIR/trace-stage2-check.mjs" <<'EOF'
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";

const db = new DatabaseSync(process.argv[2], { readOnly: true });

console.table(db.prepare(
  "SELECT url_path, title_masked, COUNT(*) AS n FROM events WHERE type = 'page_view' GROUP BY url_path, title_masked ORDER BY url_path",
).all());
console.table(db.prepare(
  "SELECT session_id, anonymous_user_id, COUNT(*) AS events FROM events GROUP BY session_id",
).all());

const chunks = db.prepare("SELECT session_id, seq, bytes FROM session_recordings ORDER BY session_id, seq").all();
const snapshotBytes = [];
let totalBytes = 0;
for (const chunk of chunks) {
  totalBytes += chunk.bytes.byteLength;
  const envelope = JSON.parse(gunzipSync(chunk.bytes).toString("utf8"));
  for (const event of envelope.events) {
    if (event.type === 2) snapshotBytes.push(gzipSync(JSON.stringify(event)).byteLength);
  }
}
console.log("조각 번호:", chunks.map((c) => `${c.session_id}#${c.seq}`).join(" "));
console.log("조각 합계(gzip):", Math.round(totalBytes / 1024), "KiB");
console.log("전체 스냅샷(gzip):", snapshotBytes.map((b) => Math.round(b / 1024) + "KiB").join(", "));
const average = snapshotBytes.reduce((a, b) => a + b, 0) / Math.max(1, snapshotBytes.length);
console.log("2분 체크포인트의 시간당 비용(활성 탭 하나):", Math.round((average * 30) / 1024), "KiB");
EOF
node "$TMPDIR/trace-stage2-check.mjs" ./trace.stage2.db
```

Expected:
- `/invoices/2026-09`의 `page_view` 제목이 `청구 - Trace Demo SaaS`다(직전 화면 제목이 아니다).
- 첫 탭 세션의 조각 번호가 0부터 빠짐없이 이어진다(새로고침 지점에서 0으로 돌아가지 않는다).
- 세션마다 `anonymous_user_id`가 같다(두 탭 모두 같은 브라우저).

- [ ] **Step 5: 체크포인트 주기를 정한다**

판단 기준: 시간당 비용이 **3 MiB 이하면 2분을 유지**하고, 넘으면 `CHECKPOINT_INTERVAL_MS`를 `600_000`(10분)으로 늘린다. 근거: 이제 새로고침마다 새 전체 스냅샷이 생기고, 업로더는 실패한 조각을 재시도하므로 페이지 중간에 조각을 잃는 경우는 2 MB 초과 조각을 버릴 때와 대기열 상한(2만 이벤트)을 넘을 때뿐이다. 체크포인트는 그 드문 손실에서 재생을 이어 주는 값이다.

데모 화면은 작아서 실제 고객 화면보다 스냅샷이 작게 나온다. 측정값과 함께 이 한계를 사용자에게 보고한다.

`packages/sdk/src/replay/index.ts`의 `checkoutEveryNms` 위 주석에서 "대역폭 비용(스냅샷을 자주 올린다)은 ② 단계에서 다시 따진다." 문장을 측정 결과로 바꾼다. 예(유지하는 경우): "2026-10-01 데모 측정: 전체 스냅샷 gzip 평균 NN KiB, 2분 주기면 활성 탭 하나당 시간에 약 NNN KiB. 3 MiB 기준 아래라 유지한다."

```bash
npm test 2>&1 | tail -5
git add packages/sdk/src/replay/index.ts packages/shared/src/recording-limits.ts
git commit -q -m "리플레이: 체크포인트 주기 비용을 재고 결정을 적는다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 개발 서버를 끄고 정리한다**

```bash
rm -f trace.stage2.db trace.stage2.db-wal trace.stage2.db-shm "$TMPDIR/trace-stage2-check.mjs"
git status --short
```

Expected: 변경 없음(`.env` 류는 `.gitignore`에 있다).

---

### Task 9: 브랜치 마감

- [ ] **Step 1: 마감한다**

superpowers:finishing-a-development-branch를 따른다. 로컬 `main`으로 fast-forward 머지하고 푸시는 하지 않는다. 워크트리 안의 무시된 파일(`git -C .worktrees/collect status --porcelain --ignored | grep -v node_modules | grep -v dist | grep -v tsbuildinfo`)을 사용자에게 보고한 뒤 워크트리와 브랜치를 지운다.

- [ ] **Step 2: 메인 저장소의 옛 로컬 DB 를 확인한다**

```bash
cd /Users/choimiae/workspace/trace
ls -la apps/api/trace.db* trace.db* 2>/dev/null
```

파일이 있으면 `events`에 새 열이 없어 메인 저장소의 `dev:api`가 수집에 실패한다. 지우기 전에 사용자에게 알리고 승인을 받는다.

- [ ] **Step 3: 마감 상태를 확인한다**

```bash
npm run build && npm run typecheck && npm test 2>&1 | tail -5
git log --oneline origin/main..main
```

Expected: 모두 통과. 사용자에게 푸시가 필요하다고 알린다.
