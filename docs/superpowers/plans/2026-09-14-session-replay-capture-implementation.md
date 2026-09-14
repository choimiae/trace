# 세션 리플레이 기록·전송 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문제가 난 세션만 rrweb 으로 기록해 서버에 올리고, 그 전에는 아무것도 브라우저를 떠나지 않게 한다.

**Architecture:** SDK 를 두 번들로 나눈다 — 항상 로드되는 `trace.js` 는 설정을 받아 리플레이가 켜진 프로젝트에만 `trace-replay.js` 를 주입하고, 리플레이 번들이 rrweb 을 켜 롤링 버퍼에 담다가 트리거(분노 클릭·오류·반응 없는 클릭)가 걸리면 gzip 으로 압축해 전용 엔드포인트로 올린다. 서버는 청크를 gzip 인 채로 저장하고 rrweb 이벤트 본문은 검증하지 않는다.

**Tech Stack:** TypeScript, rrweb 2.0.0-alpha.4, esbuild(IIFE 번들), Fastify 5, better-sqlite3, zod 3, vitest 2 (SDK 는 jsdom, API 는 node)

**Spec:** `docs/superpowers/specs/2026-09-14-session-replay-capture-design.md`

## Global Constraints

- **설치는 스크립트 한 줄이다.** `<script src=".../trace.js" data-project-id="proj_xxx"></script>` 외의 설정을 요구하지 않는다.
- **기본 번들 `dist/trace.js` 는 gzip 10,240 B 미만.** `packages/sdk/src/bundle-size.test.ts` 가 강제한다. 리플레이 코드는 이 예산에 들어가면 안 된다 — 로더만 들어간다.
- **리플레이 번들은 zod 를 가져오지 않는다.** `@trace/shared` 루트 배럴을 import 하면 `events.ts` 의 zod 스키마가 딸려온다. SDK 코드는 반드시 서브패스(`@trace/shared/privacy` 등)로만 가져온다.
- **트리거 전에는 아무것도 전송되지 않는다.** 이 계획에서 가장 중요한 불변식이다.
- **설정이 도착하기 전에는 기록을 시작하지 않는다.**
- **CDN 을 쓰지 않는다.** 리플레이 번들은 trace API 가 직접 서빙한다.
- **rrweb 이벤트 본문은 스키마로 검증하지 않는다.** 봉투(메타데이터)만 검증한다.
- **두 스토어 구현(`MemoryStore`·`SqliteStore`)은 동작이 같아야 한다.** 새 메서드는 `store-contract.test.ts` 한 곳에 테스트를 쓰고 두 구현이 함께 통과해야 한다.
- **SQLite 는 `REFERENCES` 절을 쓰지 않는다.** MemoryStore 가 참조 무결성을 검사하지 않기 때문이다(`schema.sqlite.ts` 주석).
- 기존 테스트 명령: 루트에서 `npm test`. 개별 워크스페이스는 `npm test --workspace @trace/api` / `@trace/sdk` / `@trace/shared`.
- Node 경로가 필요하면 `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH` 를 앞에 붙인다.
- **`package-lock.json` 은 커밋하지 않는다.** npm install 이 건드리면 `git checkout -- package-lock.json` 으로 되돌린다(이 저장소에서 반복해서 새어 들어온 적이 있다). 단 Task 12 의 rrweb 의존성 추가는 예외 — 그때는 lock 변경이 의도한 산출물이다.

---

## File Structure

**생성**

| 파일 | 책임 |
|---|---|
| `packages/shared/src/recording-limits.ts` | zod 없는 상수와 순수 가드. SDK 번들과 서버가 함께 쓴다 |
| `packages/shared/src/recording.ts` | zod 계약 — 리플레이 설정, 청크 봉투. 서버 전용 |
| `apps/api/src/routes/project-config.ts` | `GET /v1/projects/:projectId/config` |
| `apps/api/src/routes/recording.ts` | `POST /v1/sessions/:sessionId/recording` |
| `apps/api/src/retention/recordings.ts` | 세션 기록 보존 실행 |
| `packages/sdk/src/replay-loader.ts` | **기본 번들에 들어간다.** 설정을 받아 리플레이 번들을 주입 |
| `packages/sdk/src/replay/mask.ts` | `maskTextFn`, `data:` URI 제거 |
| `packages/sdk/src/replay/buffer.ts` | 체크포인트 롤링 버퍼 |
| `packages/sdk/src/replay/triggers.ts` | 분노 클릭·오류·반응 없는 클릭 |
| `packages/sdk/src/replay/uploader.ts` | gzip + POST |
| `packages/sdk/src/replay/index.ts` | **리플레이 번들 엔트리.** rrweb 배선 |

**수정**

| 파일 | 무엇을 |
|---|---|
| `packages/shared/src/privacy.ts` | 길이 자르기 없는 `redactPatterns` 를 분리해 내보낸다 |
| `packages/shared/package.json` | `./recording-limits` 서브패스 export |
| `packages/shared/src/index.ts` | `recording.js` 재export |
| `packages/sdk/vitest.config.ts` | `@trace/shared/recording-limits` alias |
| `apps/api/vitest.config.ts` | 같은 alias |
| `apps/api/src/db/schema.sqlite.ts` | `projects.replay_config` 열, `session_recordings` 테이블 |
| `apps/api/src/store/types.ts` | `ProjectRecord.replay`, `UpdateProjectInput.replay`, 기록 메서드 3개 |
| `apps/api/src/store/memory-store.ts` | 위 구현 |
| `apps/api/src/store/sqlite-store.ts` | 위 구현 + 마이그레이션 |
| `apps/api/src/routes/admin.ts` | `projectSettingsSchema` 에 `replay` |
| `apps/api/src/routes/admin-proxy.ts` | PATCH 응답·감사 로그에 `replay` |
| `apps/api/src/routes/sdk-bundle.ts` | `/trace-replay.js` 서빙 |
| `apps/api/src/retention/config.ts` | `SESSION_RECORDING_RETENTION_DAYS` (기본 7) |
| `apps/api/src/app.ts` | 새 라우트 등록 |
| `packages/sdk/package.json` | rrweb 의존성, `build:replay` |
| `packages/sdk/src/index.ts` | 로더 호출 |
| `README.md` | 개인정보 표와 설치 안내 |

---

### Task 1: 계약 — 리플레이 설정과 청크 봉투

**Files:**
- Create: `packages/shared/src/recording-limits.ts`
- Create: `packages/shared/src/recording-limits.test.ts`
- Create: `packages/shared/src/recording.ts`
- Create: `packages/shared/src/recording.test.ts`
- Modify: `packages/shared/src/privacy.ts:67-73`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json` (`exports`)
- Modify: `tsconfig.base.json` (`paths`)
- Modify: `packages/sdk/vitest.config.ts`, `apps/api/vitest.config.ts`
- Test: `packages/shared/src/privacy.test.ts` (추가)

**Interfaces:**
- Consumes: `isSafeTraceIdentifier`, `isoDateStringSchema` (기존)
- Produces:
  - `CHECKPOINT_INTERVAL_MS: number`, `BUFFERED_CHECKPOINT_GENERATIONS: number`, `MAX_MASK_SELECTORS: number`, `MAX_MASK_SELECTOR_LENGTH: number`, `MAX_RECORDING_CHUNK_BYTES: number`, `MAX_RECORDING_DECOMPRESSED_BYTES: number`, `MAX_RECORDING_CHUNK_EVENTS: number`
  - `isSafeMaskSelector(value: string): boolean`
  - `redactPatterns(value: string): string` — 길이 자르기 없는 패턴 치환
  - `replayConfigSchema`, `type ReplayConfig = { enabled: boolean; maskSelectors: string[] }`, `DEFAULT_REPLAY_CONFIG: ReplayConfig`
  - `recordingChunkSchema`, `type RecordingChunk`

- [ ] **Step 1: 길이 자르기 없는 패턴 치환을 요구하는 테스트를 쓴다**

`packages/shared/src/privacy.test.ts` 맨 아래에 추가:

```ts
describe("redactPatterns", () => {
  it("이메일·휴대폰·9자리 이상 숫자를 지운다", () => {
    expect(redactPatterns("문의 choi@example.com 010-1234-5678 1234567890")).toBe(
      "문의 [redacted] [redacted] [redacted]",
    );
  });

  // 리플레이는 화면의 본문 텍스트를 그대로 재생한다. redactText 의 120자 자르기를
  // 그대로 쓰면 긴 문단이 조용히 잘려 재생이 원본과 달라진다.
  it("120자를 넘어도 자르지 않는다", () => {
    const long = "가".repeat(300);
    expect(redactPatterns(long)).toBe(long);
  });

  it("redactText 는 지금처럼 120자에서 자른다", () => {
    expect(redactText("가".repeat(300))).toHaveLength(120);
  });
});
```

import 줄에 `redactPatterns` 를 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/shared -- privacy`
Expected: FAIL — `redactPatterns is not a function` (또는 import 오류).

- [ ] **Step 3: privacy.ts 에서 치환과 자르기를 분리한다**

`packages/shared/src/privacy.ts:67-73` 을 바꾼다:

```ts
// 패턴 치환만 한다. 길이 자르기는 부르는 쪽이 정한다 — 리플레이는 화면 본문을
// 그대로 재생해야 해서 자르면 안 되고, 이벤트 필드는 계약 상한(120)이 있다.
export function redactPatterns(value: string): string {
  return value
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, REDACTED)
    .replace(LONG_NUMBER_PATTERN, REDACTED);
}

export function redactText(value: string): string {
  return redactPatterns(value).slice(0, 120);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/shared -- privacy`
Expected: PASS. 기존 `redactText` 테스트도 모두 통과해야 한다 — 동작은 그대로다.

- [ ] **Step 5: 상수 파일의 테스트를 쓴다**

`packages/shared/src/recording-limits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BUFFERED_CHECKPOINT_GENERATIONS,
  CHECKPOINT_INTERVAL_MS,
  isSafeMaskSelector,
  MAX_MASK_SELECTOR_LENGTH,
} from "./recording-limits.js";

describe("recording limits", () => {
  it("체크포인트 주기는 2분이다", () => {
    expect(CHECKPOINT_INTERVAL_MS).toBe(120_000);
  });

  // 세대 1개면 체크포인트 직후에 난 문제의 앞 맥락이 0초가 된다.
  it("체크포인트를 두 세대 쥔다", () => {
    expect(BUFFERED_CHECKPOINT_GENERATIONS).toBe(2);
  });

  it("평범한 CSS 셀렉터를 받는다", () => {
    expect(isSafeMaskSelector(".customer-name")).toBe(true);
    expect(isSafeMaskSelector("td.amount > span")).toBe(true);
    expect(isSafeMaskSelector('[data-pii="true"]')).toBe(true);
  });

  it("빈 값과 상한을 넘는 길이를 거절한다", () => {
    expect(isSafeMaskSelector("")).toBe(false);
    expect(isSafeMaskSelector("a".repeat(MAX_MASK_SELECTOR_LENGTH + 1))).toBe(false);
  });

  it("줄바꿈·중괄호처럼 셀렉터가 아닌 문자를 거절한다", () => {
    expect(isSafeMaskSelector("a\nb")).toBe(false);
    expect(isSafeMaskSelector("body{display:none}")).toBe(false);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm test --workspace @trace/shared -- recording-limits`
Expected: FAIL — `Failed to resolve import "./recording-limits.js"`.

- [ ] **Step 7: 상수 파일을 만든다**

`packages/shared/src/recording-limits.ts`:

```ts
// SDK 리플레이 번들과 서버가 함께 쓰는 상수·가드. zod 를 import 하지 않는다 —
// 이 파일은 esbuild 로 브라우저 번들에 들어가고, 계약 스키마(recording.ts)를
// 끌어오면 zod 가 통째로 딸려온다.

/** 전체 스냅샷을 다시 찍는 주기. 버퍼가 거슬러 보는 시간의 하한을 정한다. */
export const CHECKPOINT_INTERVAL_MS = 120_000;

/**
 * 버퍼가 쥐고 있는 체크포인트 세대 수. 1 이면 0~2분(운에 달림), 2 면 2~4분을
 * 보장한다. 스냅샷은 압축 전 약 383 KB 라 세대마다 그만큼을 더 쓴다.
 */
export const BUFFERED_CHECKPOINT_GENERATIONS = 2;

/** 프로젝트마다 지정할 수 있는 마스킹 셀렉터 개수와 길이. */
export const MAX_MASK_SELECTORS = 50;
export const MAX_MASK_SELECTOR_LENGTH = 200;

/** 청크 한 건의 압축 본문 상한. Fastify bodyLimit 으로도 같은 값을 건다. */
export const MAX_RECORDING_CHUNK_BYTES = 2 * 1024 * 1024;

/**
 * 압축 해제 후 상한. 이것이 없으면 2 MB 본문이 해제 중에 수 GB 로 부풀어
 * 서버를 넘어뜨린다(압축 폭탄).
 */
export const MAX_RECORDING_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

/** 청크 한 건에 담기는 rrweb 이벤트 개수 상한. */
export const MAX_RECORDING_CHUNK_EVENTS = 50_000;

// 셀렉터는 고객 사이트 HTML 에 이미 보이는 클래스·태그명이다. 공개 설정
// 엔드포인트로 그대로 나가므로, 값의 의미보다 "파서를 흔드는 문자가 없다" 를 본다.
const MASK_SELECTOR_PATTERN = /^[A-Za-z0-9_\-.#[\]="' :>~+*(),]+$/;

export function isSafeMaskSelector(value: string): boolean {
  if (value.length === 0 || value.length > MAX_MASK_SELECTOR_LENGTH) return false;
  return MASK_SELECTOR_PATTERN.test(value);
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm test --workspace @trace/shared -- recording-limits`
Expected: PASS.

- [ ] **Step 9: 계약 스키마 테스트를 쓴다**

`packages/shared/src/recording.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { recordingChunkSchema, replayConfigSchema } from "./recording.js";

const validChunk = {
  projectId: "proj_abc123",
  seq: 0,
  startedAt: "2026-09-14T00:00:00.000Z",
  url: "https://demo.example.com/orders",
  sdkVersion: "0.1.0",
  events: [{ type: 2, timestamp: 1 }],
};

describe("replayConfigSchema", () => {
  it("셀렉터를 생략하면 빈 목록이 된다", () => {
    expect(replayConfigSchema.parse({ enabled: true })).toEqual({
      enabled: true,
      maskSelectors: [],
    });
  });

  it("안전하지 않은 셀렉터를 거절한다", () => {
    expect(() =>
      replayConfigSchema.parse({ enabled: true, maskSelectors: ["body{x:1}"] }),
    ).toThrow();
  });
});

describe("recordingChunkSchema", () => {
  it("봉투를 검증한다", () => {
    expect(recordingChunkSchema.parse(validChunk).seq).toBe(0);
  });

  // 이벤트 본문 모양은 rrweb 버전에 묶여 있다. 계약으로 고정하면 라이브러리를
  // 올릴 때마다 서버가 멀쩡한 기록을 400 으로 떨어뜨린다.
  it("rrweb 이벤트의 내부 구조는 보지 않는다", () => {
    const parsed = recordingChunkSchema.parse({
      ...validChunk,
      events: [{ 무엇이든: "들어온다" }, 42, null],
    });
    expect(parsed.events).toHaveLength(3);
  });

  it("이벤트가 하나도 없는 청크를 거절한다", () => {
    expect(() => recordingChunkSchema.parse({ ...validChunk, events: [] })).toThrow();
  });

  it("프로젝트 식별자 모양을 검증한다", () => {
    expect(() => recordingChunkSchema.parse({ ...validChunk, projectId: "sess_abc" })).toThrow();
  });
});
```

- [ ] **Step 10: 실패를 확인한다**

Run: `npm test --workspace @trace/shared -- recording.test`
Expected: FAIL — `Failed to resolve import "./recording.js"`.

- [ ] **Step 11: 계약 스키마를 만든다**

`packages/shared/src/recording.ts`:

```ts
import { z } from "zod";
import { isoDateStringSchema } from "./events.js";
import { isSafeTraceIdentifier } from "./privacy.js";
import {
  isSafeMaskSelector,
  MAX_MASK_SELECTORS,
  MAX_RECORDING_CHUNK_EVENTS,
} from "./recording-limits.js";

export const maskSelectorSchema = z.string().trim().refine(isSafeMaskSelector);

export const replayConfigSchema = z.object({
  enabled: z.boolean(),
  maskSelectors: z.array(maskSelectorSchema).max(MAX_MASK_SELECTORS).default([]),
});

export type ReplayConfig = z.infer<typeof replayConfigSchema>;

export const DEFAULT_REPLAY_CONFIG: ReplayConfig = { enabled: false, maskSelectors: [] };

// events 는 검증하지 않는다 — 모양이 rrweb 버전에 묶여 있어 계약으로 고정하면
// 라이브러리를 올릴 수 없다. 봉투(누가·언제·몇 번째)만 본다. 크기는 바이트
// 단위로 recording.ts 바깥(라우트)에서 따로 막는다.
export const recordingChunkSchema = z.object({
  projectId: z.string().refine((value) => isSafeTraceIdentifier(value, "proj")),
  seq: z.number().int().min(0),
  startedAt: isoDateStringSchema,
  url: z.string().url(),
  sdkVersion: z.string().min(1).max(32),
  events: z.array(z.unknown()).min(1).max(MAX_RECORDING_CHUNK_EVENTS),
});

export type RecordingChunk = z.infer<typeof recordingChunkSchema>;
```

- [ ] **Step 12: 통과를 확인한다**

Run: `npm test --workspace @trace/shared -- recording.test`
Expected: PASS.

- [ ] **Step 13: 배럴과 서브패스를 연다**

`packages/shared/src/index.ts` 에 한 줄 더한다 (`recording-limits` 는 배럴에 넣지 않는다 — 배럴을 import 하면 zod 가 딸려오므로, SDK 는 서브패스로만 가져와야 한다):

```ts
export * from "./recording.js";
```

`packages/shared/package.json` 의 `exports` 에 더한다:

```json
    "./recording-limits": {
      "types": "./dist/recording-limits.d.ts",
      "default": "./dist/recording-limits.js"
    },
```

`packages/sdk/vitest.config.ts` 와 `apps/api/vitest.config.ts` 의 `alias` 배열에서 **bare `@trace/shared` 항목보다 앞에** 더한다 (앞의 것이 먼저 맞으므로 순서가 중요하다):

```ts
      {
        find: "@trace/shared/recording-limits",
        replacement: new URL("../shared/src/recording-limits.ts", import.meta.url).pathname,
      },
```

`apps/api/vitest.config.ts` 에서는 경로가 `"../../packages/shared/src/recording-limits.ts"` 다.

- [ ] **Step 14: tsconfig 의 경로 별칭을 더한다**

vitest 별칭만으로는 `npm run typecheck` 가 서브패스를 못 찾는다. `tsconfig.base.json` 의 `paths` 에 더한다 (`@trace/shared/privacy` 바로 아래):

```json
      "@trace/shared/recording-limits": ["packages/shared/src/recording-limits.ts"],
```

- [ ] **Step 15: 전체 테스트와 타입 검사**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 16: 커밋**

```bash
git add packages/shared/src/recording-limits.ts packages/shared/src/recording-limits.test.ts \
        packages/shared/src/recording.ts packages/shared/src/recording.test.ts \
        packages/shared/src/privacy.ts packages/shared/src/privacy.test.ts \
        packages/shared/src/index.ts packages/shared/package.json tsconfig.base.json \
        packages/sdk/vitest.config.ts apps/api/vitest.config.ts
git commit -m "계약: 리플레이 설정과 기록 청크 봉투를 계약에 넣는다

rrweb 이벤트 본문은 검증하지 않는다 - 모양이 rrweb 버전에 묶여 있어 계약으로
고정하면 라이브러리를 올릴 때마다 멀쩡한 기록이 400 이 된다.

redactPatterns 를 분리한 것은 리플레이가 화면 본문을 그대로 재생하기 때문이다.
redactText 의 120자 자르기를 그대로 쓰면 긴 문단이 조용히 잘린다."
```

---

### Task 2: 프로젝트 레코드가 리플레이 설정을 들고 있다

**Files:**
- Modify: `apps/api/src/store/types.ts:3-19`
- Modify: `apps/api/src/db/schema.sqlite.ts` (`projects` 테이블)
- Modify: `apps/api/src/store/memory-store.ts:40-67`
- Modify: `apps/api/src/store/sqlite-store.ts:63-115`, `migrate()`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: `ReplayConfig`, `DEFAULT_REPLAY_CONFIG`, `replayConfigSchema` (Task 1)
- Produces:
  - `ProjectRecord.replay: ReplayConfig`
  - `UpdateProjectInput.replay?: ReplayConfig` — **넘기지 않으면 기존 설정을 유지한다**

- [ ] **Step 1: 계약 테스트를 쓴다**

`apps/api/src/store/store-contract.test.ts` 의 `describeTraceStoreContract` 안, 프로젝트 관련 테스트 옆에 추가:

```ts
    it("새 프로젝트는 리플레이가 꺼진 채로 시작한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      expect(project.replay).toEqual({ enabled: false, maskSelectors: [] });
      expect((await store.getProject(project.projectId))?.replay).toEqual({
        enabled: false,
        maskSelectors: [],
      });
    });

    it("리플레이를 켜고 마스킹 셀렉터를 저장한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      const updated = await store.updateProject(project.projectId, {
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
        replay: { enabled: true, maskSelectors: [".customer-name"] },
      });

      expect(updated?.replay).toEqual({ enabled: true, maskSelectors: [".customer-name"] });
      expect((await store.getProject(project.projectId))?.replay.enabled).toBe(true);
    });

    // 관리자 화면은 아직 리플레이 항목을 보내지 않는다. 이름만 고치는 요청이
    // 리플레이를 조용히 꺼 버리면 기록이 그 순간 멈춘다.
    it("replay 를 빼고 수정하면 기존 설정이 남는다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      await store.updateProject(project.projectId, {
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
        replay: { enabled: true, maskSelectors: [".customer-name"] },
      });

      const renamed = await store.updateProject(project.projectId, {
        name: "Demo 2",
        allowedDomains: ["https://demo.example.com"],
      });

      expect(renamed?.name).toBe("Demo 2");
      expect(renamed?.replay).toEqual({ enabled: true, maskSelectors: [".customer-name"] });
    });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- store-contract`
Expected: FAIL — 여섯 건(두 스토어 × 세 테스트). `replay` 가 `undefined` 다.

- [ ] **Step 3: 타입에 리플레이 설정을 더한다**

`apps/api/src/store/types.ts` 상단 import 에 더한다:

```ts
import type { DashboardSummary, EventBatch, Issue, ReplayConfig, TraceEvent } from "@trace/shared";
```

`ProjectRecord` 와 `UpdateProjectInput` 을 바꾼다:

```ts
export interface ProjectRecord {
  projectId: string;
  name: string;
  allowedDomains: string[];
  privacyConfig: { strictMasking: true; queryRedaction: true; inputCapture: false };
  replay: ReplayConfig;
  createdAt: string;
}

export interface UpdateProjectInput {
  name: string;
  allowedDomains: string[];
  // 넘기지 않으면 기존 설정을 유지한다. 관리자 화면이 리플레이 항목을 보내지
  // 않는 동안 이름만 고친 요청이 기록을 꺼 버리지 않게 하기 위한 것이다.
  replay?: ReplayConfig;
}
```

- [ ] **Step 4: SQLite 스키마와 마이그레이션을 더한다**

`apps/api/src/db/schema.sqlite.ts` 의 `projects` 테이블에 열을 더한다:

```sql
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  allowed_domains TEXT NOT NULL,
  privacy_config TEXT NOT NULL,
  replay_config TEXT NOT NULL DEFAULT '{"enabled":false,"maskSelectors":[]}',
  created_at TEXT NOT NULL
);
```

`apps/api/src/store/sqlite-store.ts` 의 `migrate()` 맨 앞에 더한다:

```ts
    if (!hasColumn(this.db, "projects", "replay_config")) {
      this.db.exec(
        `ALTER TABLE projects ADD COLUMN replay_config TEXT NOT NULL DEFAULT '{"enabled":false,"maskSelectors":[]}'`,
      );
    }
```

- [ ] **Step 5: SqliteStore 의 읽기·쓰기를 고친다**

import 에 더한다:

```ts
import { DEFAULT_REPLAY_CONFIG, replayConfigSchema, screenContextSchema } from "@trace/shared";
import type { ReplayConfig } from "@trace/shared";
```

`createProject` 에서 `project` 객체에 `replay: DEFAULT_REPLAY_CONFIG,` 를 넣고, INSERT 를 바꾼다:

```ts
        `INSERT INTO projects (project_id, name, allowed_domains, privacy_config, replay_config, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
```

바인딩에 `JSON.stringify(project.replay),` 를 `privacy_config` 뒤에 넣는다.

행을 레코드로 바꾸는 곳(`sqlite-store.ts:96` 근처)에 더한다:

```ts
      replay: parseReplayConfig(row.replay_config),
```

파일 위쪽 `compact` 옆에 헬퍼를 둔다:

```ts
// 저장된 값이 깨졌거나 예전 형식이면 꺼진 설정으로 돌아간다. 여기서 던지면
// 프로젝트 조회가 통째로 실패해 수집까지 멈춘다 — 리플레이가 꺼지는 쪽이 낫다.
function parseReplayConfig(value: unknown): ReplayConfig {
  if (typeof value !== "string") return DEFAULT_REPLAY_CONFIG;
  try {
    const parsed = replayConfigSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : DEFAULT_REPLAY_CONFIG;
  } catch {
    return DEFAULT_REPLAY_CONFIG;
  }
}
```

`updateProject` 를 바꾼다:

```ts
  async updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined> {
    const existing = await this.getProject(projectId);
    if (!existing) return undefined;
    const allowedDomains = normalizeAllowedDomains(input.allowedDomains);
    const replay = input.replay ?? existing.replay;

    this.db
      .prepare(`UPDATE projects SET name = ?, allowed_domains = ?, replay_config = ? WHERE project_id = ?`)
      .run(input.name, JSON.stringify(allowedDomains), JSON.stringify(replay), projectId);

    return {
      ...existing,
      name: input.name,
      allowedDomains,
      replay,
    };
  }
```

- [ ] **Step 6: MemoryStore 를 고친다**

import 에 `DEFAULT_REPLAY_CONFIG` 를 더하고, `createProject` 의 레코드에 `replay: DEFAULT_REPLAY_CONFIG,` 를 넣는다. `updateProject` 를 바꾼다:

```ts
    const updated: ProjectRecord = {
      ...existing,
      name: input.name,
      allowedDomains: normalizeAllowedDomains(input.allowedDomains),
      replay: input.replay ?? existing.replay,
    };
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- store-contract`
Expected: PASS (두 스토어 모두).

- [ ] **Step 8: 이전 DB 에서도 열리는지 확인한다**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH node -e '
const Database = require("better-sqlite3");
const db = new Database("/tmp/trace-migrate-check.db");
db.exec("CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, allowed_domains TEXT NOT NULL, privacy_config TEXT NOT NULL, created_at TEXT NOT NULL)");
db.prepare("INSERT INTO projects VALUES (?,?,?,?,?)").run("proj_old","Old","[]","{}","2026-01-01T00:00:00.000Z");
db.close();
' && npx tsx -e '
import { SqliteStore } from "./apps/api/src/store/sqlite-store.js";
const store = new SqliteStore("/tmp/trace-migrate-check.db");
console.log(JSON.stringify((await store.getProject("proj_old"))?.replay));
store.close();
' ; rm -f /tmp/trace-migrate-check.db
```

Expected: `{"enabled":false,"maskSelectors":[]}`. 기존 행이 마이그레이션 뒤 꺼진 설정을 얻는다.

- [ ] **Step 9: 전체 테스트와 타입 검사**

Run: `npm test && npm run typecheck`
Expected: PASS. 실패하면 대개 `ProjectRecord` 리터럴을 직접 만드는 테스트다 — `replay` 를 더해 준다.

- [ ] **Step 10: 커밋**

```bash
git add apps/api/src/store/types.ts apps/api/src/db/schema.sqlite.ts \
        apps/api/src/store/memory-store.ts apps/api/src/store/sqlite-store.ts \
        apps/api/src/store/store-contract.test.ts
git commit -m "저장: 프로젝트마다 리플레이 설정을 들고 있게 한다

replay 를 넘기지 않은 수정은 기존 설정을 유지한다. 관리자 화면이 아직 이
항목을 보내지 않아서, 이름만 고치는 요청이 기록을 조용히 꺼 버리면 안 된다.

저장된 값이 깨져 있으면 던지지 않고 꺼진 설정으로 돌아간다 - 여기서 던지면
프로젝트 조회가 실패해 수집까지 멈춘다."
```

---

### Task 3: 관리자 설정으로 리플레이를 켠다

**Files:**
- Modify: `apps/api/src/routes/admin.ts:3-11`
- Modify: `apps/api/src/routes/admin-proxy.ts:356-404`, `toProjectSettingsResponse`
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `replayConfigSchema` (Task 1), `UpdateProjectInput.replay` (Task 2)
- Produces: PATCH `/admin/api/projects/:projectId` 가 `replay` 를 받고 응답과 감사 로그에 싣는다

- [ ] **Step 1: 라우트 테스트를 쓴다**

`apps/api/src/routes/admin.test.ts` 에 추가한다. 이 파일의 기존 PATCH 테스트를 그대로 본떠(인증 쿠키·CSRF 헤더 만드는 헬퍼 포함) 요청을 만든다:

```ts
  it("리플레이를 켜고 마스킹 셀렉터를 저장한다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers,
      payload: {
        name: project.name,
        allowedDomains: project.allowedDomains,
        replay: { enabled: true, maskSelectors: [".customer-name"] },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().replay).toEqual({ enabled: true, maskSelectors: [".customer-name"] });
    expect((await store.getProject(project.projectId))?.replay.enabled).toBe(true);
  });

  it("셀렉터가 아닌 값을 거절한다", async () => {
    const { app, project, headers } = await createAuthenticatedOwner();

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers,
      payload: {
        name: project.name,
        allowedDomains: project.allowedDomains,
        replay: { enabled: true, maskSelectors: ["body{display:none}"] },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_project_settings" });
  });

  // 감사 로그가 "누가 언제 기록을 켰나" 를 남기지 못하면 개인정보 사고를
  // 추적할 방법이 없다. 리플레이는 이 저장소에서 가장 넓게 수집하는 기능이다.
  it("리플레이 변경을 감사 로그에 남긴다", async () => {
    const { app, store, project, headers } = await createAuthenticatedOwner();

    await app.inject({
      method: "PATCH",
      url: `/admin/api/projects/${project.projectId}`,
      headers,
      payload: {
        name: project.name,
        allowedDomains: project.allowedDomains,
        replay: { enabled: true, maskSelectors: [] },
      },
    });

    const logs = await store.listAuditLogs();
    const updated = logs.find((log) => log.action === "project.updated");
    expect((updated?.metadata.before as { replay?: unknown }).replay).toEqual({
      enabled: false,
      maskSelectors: [],
    });
    expect((updated?.metadata.after as { replay?: unknown }).replay).toEqual({
      enabled: true,
      maskSelectors: [],
    });
  });
```

`createAuthenticatedOwner` 는 새로 만들지 말고, 이 파일이 이미 쓰는 인증 설정 방식을 그대로 따른다(기존 PATCH 테스트를 보고 같은 형태로 지역 헬퍼를 만든다).

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- routes/admin`
Expected: FAIL — `replay` 가 응답에 없고, 잘못된 셀렉터도 200 이 된다(스키마가 모르는 키를 그냥 버린다).

- [ ] **Step 3: 설정 스키마에 replay 를 더한다**

`apps/api/src/routes/admin.ts`:

```ts
import { replayConfigSchema } from "@trace/shared";
import { z } from "zod";

export const projectSettingsSchema = z.object({
  name: z.string().trim().min(1),
  allowedDomains: z.array(z.string().url()).min(1).transform((domains) => Array.from(new Set(
    domains.map((domain) => new URL(domain).origin),
  ))),
  // 생략 가능하다. 넘기지 않은 요청은 저장된 설정을 그대로 둔다(store 계약).
  replay: replayConfigSchema.optional(),
});
```

- [ ] **Step 4: PATCH 응답과 감사 로그에 싣는다**

`apps/api/src/routes/admin-proxy.ts` 의 `project.updated` 감사 로그에서 `before`·`after` 둘 다에 `replay` 를 더한다:

```ts
        before: {
          name: access.project.name,
          allowedDomains: access.project.allowedDomains,
          replay: access.project.replay,
        },
        after: {
          name: updated.name,
          allowedDomains: updated.allowedDomains,
          replay: updated.replay,
        },
```

`toProjectSettingsResponse` 가 돌려주는 객체에 `replay: project.replay,` 를 더한다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- routes/admin`
Expected: PASS.

- [ ] **Step 6: 전체 테스트와 타입 검사**

Run: `npm test && npm run typecheck`
Expected: PASS. `adminProjectSchema`(`packages/shared/src/events.ts:262`)를 쓰는 관리자 화면 타입이 걸리면 그 스키마에도 `replay: replayConfigSchema.optional()` 을 더한다.

- [ ] **Step 7: 커밋**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin-proxy.ts \
        apps/api/src/routes/admin.test.ts packages/shared/src/events.ts
git commit -m "관리자: 프로젝트 설정에서 리플레이를 켜고 마스킹 셀렉터를 지정한다

감사 로그의 before/after 에 리플레이 설정을 싣는다. 리플레이는 이 저장소에서
가장 넓게 수집하는 기능이라 누가 언제 켰는지가 남아야 한다."
```

---

### Task 4: 설정 엔드포인트 — 기록 시작의 전제

**Files:**
- Create: `apps/api/src/routes/project-config.ts`
- Create: `apps/api/src/routes/project-config.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `ProjectRecord.replay` (Task 2)
- Produces: `GET /v1/projects/:projectId/config` → `{ replay: boolean; maskSelectors: string[] }`
  - `registerProjectConfigRoutes(app, { store })`

- [ ] **Step 1: 테스트를 쓴다**

`apps/api/src/routes/project-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { MemoryStore } from "../store/memory-store.js";

async function createProject(store: MemoryStore) {
  return store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
}

describe("GET /v1/projects/:projectId/config", () => {
  it("리플레이가 꺼진 프로젝트는 false 를 돌려준다", async () => {
    const store = new MemoryStore();
    const project = await createProject(store);
    const app = createApp({ store });

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.projectId}/config`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ replay: false, maskSelectors: [] });
  });

  it("켜진 프로젝트는 마스킹 셀렉터를 함께 돌려준다", async () => {
    const store = new MemoryStore();
    const project = await createProject(store);
    await store.updateProject(project.projectId, {
      name: project.name,
      allowedDomains: project.allowedDomains,
      replay: { enabled: true, maskSelectors: [".customer-name", "td.amount"] },
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.projectId}/config`,
    });

    expect(response.json()).toEqual({
      replay: true,
      maskSelectors: [".customer-name", "td.amount"],
    });
  });

  // 꺼져 있는데 셀렉터가 나가면, 켤 생각이 없는 프로젝트의 내부 클래스 이름을
  // 공개 엔드포인트로 흘리는 것이 된다.
  it("꺼져 있으면 셀렉터를 내보내지 않는다", async () => {
    const store = new MemoryStore();
    const project = await createProject(store);
    await store.updateProject(project.projectId, {
      name: project.name,
      allowedDomains: project.allowedDomains,
      replay: { enabled: false, maskSelectors: [".customer-name"] },
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.projectId}/config`,
    });

    expect(response.json()).toEqual({ replay: false, maskSelectors: [] });
  });

  // 셀렉터를 지웠는데 캐시된 설정으로 기록이 계속되면, 가려야 할 자리가
  // 원문으로 담긴다. 설정은 즉시 반영돼야 한다.
  it("설정을 캐시하지 않는다", async () => {
    const store = new MemoryStore();
    const project = await createProject(store);
    const app = createApp({ store });

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.projectId}/config`,
    });

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("없는 프로젝트는 404 다", async () => {
    const app = createApp({ store: new MemoryStore() });

    const response = await app.inject({ method: "GET", url: "/v1/projects/proj_missing/config" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- project-config`
Expected: FAIL — 모두 404 (라우트가 없다).

- [ ] **Step 3: 라우트를 만든다**

`apps/api/src/routes/project-config.ts`:

```ts
import { isSafeTraceIdentifier } from "@trace/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TraceStore } from "../store/types.js";

const paramsSchema = z.object({
  projectId: z.string().refine((value) => isSafeTraceIdentifier(value, "proj")),
});

export async function registerProjectConfigRoutes(
  app: FastifyInstance,
  options: { store: TraceStore },
): Promise<void> {
  // 공개 엔드포인트다. projectId 는 이미 고객 사이트의 script 태그에 적혀 있고,
  // 나가는 값은 그 사이트가 어떤 셀렉터를 가리는지 - 그 클래스명 역시 사이트
  // HTML 에 그대로 보인다.
  app.get("/v1/projects/:projectId/config", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "project_not_found" });

    const project = await options.store.getProject(params.data.projectId);
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    // 설정이 바뀌면 즉시 반영돼야 한다. 셀렉터를 지웠는데 캐시된 설정으로
    // 기록이 이어지면 가려야 할 자리가 원문으로 담긴다.
    reply.header("cache-control", "no-store");

    // 꺼져 있으면 셀렉터를 내보내지 않는다 - 켤 생각이 없는 프로젝트의 내부
    // 클래스 이름을 공개 엔드포인트로 흘릴 이유가 없다.
    if (!project.replay.enabled) return { replay: false, maskSelectors: [] };

    return { replay: true, maskSelectors: project.replay.maskSelectors };
  });
}
```

- [ ] **Step 4: app.ts 에 등록한다**

import 를 더하고, `registerIngestionRoutes` 등록 바로 뒤에 넣는다:

```ts
  app.register(registerProjectConfigRoutes, { store: options.store });
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- project-config`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/routes/project-config.ts apps/api/src/routes/project-config.test.ts apps/api/src/app.ts
git commit -m "수집: 프로젝트 리플레이 설정을 내려주는 공개 엔드포인트를 연다

SDK 는 이 응답이 도착하기 전에는 기록을 시작하지 않는다. 마스킹 셀렉터를
모르는 채로 기록하면 가려야 할 자리가 버퍼에 원문으로 들어가고, 나중에
설정이 와도 이미 늦다.

no-store 인 이유도 같다 - 셀렉터를 지운 변경이 캐시 때문에 늦게 도착하면
그 사이 기록이 원문을 담는다."
```

---

### Task 5: 기록 청크 저장 계약

**Files:**
- Modify: `apps/api/src/db/schema.sqlite.ts`
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SessionRecordingChunk {
    sessionId: string;
    projectId: string;
    seq: number;
    startedAt: string;
    eventCount: number;
    bytes: Uint8Array;   // gzip 된 그대로. 서버는 풀어서 저장하지 않는다
  }
  saveSessionRecordingChunk(chunk: SessionRecordingChunk): Promise<void>;
  listSessionRecordingChunks(projectId: string, sessionId: string): Promise<SessionRecordingChunk[]>;
  deleteSessionRecordingsBefore(cutoff: string): Promise<number>;
  ```

- [ ] **Step 1: 계약 테스트를 쓴다**

`apps/api/src/store/store-contract.test.ts` 에 추가:

```ts
    it("세션 기록 청크를 seq 순서로 돌려준다", async () => {
      const store = open();
      const chunk = (seq: number, startedAt: string) => ({
        sessionId: "sess_1",
        projectId: "proj_1",
        seq,
        startedAt,
        eventCount: 2,
        bytes: new Uint8Array([seq, 9, 9]),
      });

      await store.saveSessionRecordingChunk(chunk(1, "2026-09-14T00:02:00.000Z"));
      await store.saveSessionRecordingChunk(chunk(0, "2026-09-14T00:00:00.000Z"));

      const stored = await store.listSessionRecordingChunks("proj_1", "sess_1");
      expect(stored.map((item) => item.seq)).toEqual([0, 1]);
      expect(Array.from(stored[0]!.bytes)).toEqual([0, 9, 9]);
      expect(stored[0]!.eventCount).toBe(2);
    });

    // 재전송은 네트워크가 불안정하면 평범하게 일어난다. 두 번 저장하면 재생할 때
    // 같은 구간이 두 번 나온다.
    it("같은 seq 를 다시 보내면 무시한다", async () => {
      const store = open();
      const chunk = {
        sessionId: "sess_1",
        projectId: "proj_1",
        seq: 0,
        startedAt: "2026-09-14T00:00:00.000Z",
        eventCount: 1,
        bytes: new Uint8Array([1, 2, 3]),
      };

      await store.saveSessionRecordingChunk(chunk);
      await store.saveSessionRecordingChunk({ ...chunk, bytes: new Uint8Array([4, 5, 6]) });

      const stored = await store.listSessionRecordingChunks("proj_1", "sess_1");
      expect(stored).toHaveLength(1);
      expect(Array.from(stored[0]!.bytes)).toEqual([1, 2, 3]);
    });

    it("다른 세션의 청크를 섞지 않는다", async () => {
      const store = open();
      const base = {
        projectId: "proj_1",
        seq: 0,
        startedAt: "2026-09-14T00:00:00.000Z",
        eventCount: 1,
        bytes: new Uint8Array([1]),
      };
      await store.saveSessionRecordingChunk({ ...base, sessionId: "sess_1" });
      await store.saveSessionRecordingChunk({ ...base, sessionId: "sess_2" });

      expect(await store.listSessionRecordingChunks("proj_1", "sess_1")).toHaveLength(1);
    });

    it("보존 기한을 넘긴 기록을 지운다", async () => {
      const store = open();
      const base = {
        projectId: "proj_1",
        sessionId: "sess_1",
        eventCount: 1,
        bytes: new Uint8Array([1]),
      };
      await store.saveSessionRecordingChunk({ ...base, seq: 0, startedAt: "2026-09-01T00:00:00.000Z" });
      await store.saveSessionRecordingChunk({ ...base, seq: 1, startedAt: "2026-09-13T00:00:00.000Z" });

      const deleted = await store.deleteSessionRecordingsBefore("2026-09-07T00:00:00.000Z");

      expect(deleted).toBe(1);
      expect(await store.listSessionRecordingChunks("proj_1", "sess_1")).toHaveLength(1);
    });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- store-contract`
Expected: FAIL — `store.saveSessionRecordingChunk is not a function`.

- [ ] **Step 3: 테이블을 더한다**

`apps/api/src/db/schema.sqlite.ts` 의 템플릿 문자열 끝에 더한다:

```sql
CREATE TABLE IF NOT EXISTS session_recordings (
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS session_recordings_project_session ON session_recordings (project_id, session_id, seq);
CREATE INDEX IF NOT EXISTS session_recordings_started ON session_recordings (started_at);
```

세션 하나를 통짜 BLOB 으로 두지 않는 이유: 트리거 뒤에도 기록이 계속 올라오므로 이어 붙일 때마다 세션 전체를 다시 써야 한다.

- [ ] **Step 4: 인터페이스를 더한다**

`apps/api/src/store/types.ts` 에 인터페이스를 더하고 `TraceStore` 에 세 메서드를 넣는다:

```ts
export interface SessionRecordingChunk {
  sessionId: string;
  projectId: string;
  seq: number;
  startedAt: string;
  eventCount: number;
  /** gzip 된 봉투 그대로. 서버는 검증을 위해 풀어 볼 뿐 풀어서 저장하지 않는다. */
  bytes: Uint8Array;
}
```

```ts
  /** 같은 (sessionId, seq) 가 이미 있으면 무시한다 — 재전송이 구간을 중복시키지 않게. */
  saveSessionRecordingChunk(chunk: SessionRecordingChunk): Promise<void>;
  /** seq 오름차순. 재생은 이 순서로 이어 붙인다. */
  listSessionRecordingChunks(projectId: string, sessionId: string): Promise<SessionRecordingChunk[]>;
  deleteSessionRecordingsBefore(cutoff: string): Promise<number>;
```

- [ ] **Step 5: SqliteStore 에 구현한다**

```ts
  async saveSessionRecordingChunk(chunk: SessionRecordingChunk): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO session_recordings
           (session_id, project_id, seq, started_at, received_at, event_count, bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chunk.sessionId,
        chunk.projectId,
        chunk.seq,
        chunk.startedAt,
        new Date().toISOString(),
        chunk.eventCount,
        Buffer.from(chunk.bytes),
      );
  }

  async listSessionRecordingChunks(projectId: string, sessionId: string): Promise<SessionRecordingChunk[]> {
    const rows = this.db
      .prepare(
        `SELECT session_id, project_id, seq, started_at, event_count, bytes
           FROM session_recordings
          WHERE project_id = ? AND session_id = ?
          ORDER BY seq ASC`,
      )
      .all(projectId, sessionId) as Row[];

    return rows.map((row) => ({
      sessionId: row.session_id as string,
      projectId: row.project_id as string,
      seq: row.seq as number,
      startedAt: row.started_at as string,
      eventCount: row.event_count as number,
      bytes: new Uint8Array(row.bytes as Buffer),
    }));
  }

  async deleteSessionRecordingsBefore(cutoff: string): Promise<number> {
    return this.db.prepare(`DELETE FROM session_recordings WHERE started_at < ?`).run(cutoff).changes;
  }
```

- [ ] **Step 6: MemoryStore 에 구현한다**

필드를 더한다: `private sessionRecordings = new Map<string, SessionRecordingChunk>();` (키는 `${sessionId}:${seq}`)

```ts
  async saveSessionRecordingChunk(chunk: SessionRecordingChunk): Promise<void> {
    const key = `${chunk.sessionId}:${chunk.seq}`;
    if (this.sessionRecordings.has(key)) return;
    this.sessionRecordings.set(key, { ...chunk, bytes: new Uint8Array(chunk.bytes) });
  }

  async listSessionRecordingChunks(projectId: string, sessionId: string): Promise<SessionRecordingChunk[]> {
    return Array.from(this.sessionRecordings.values())
      .filter((chunk) => chunk.projectId === projectId && chunk.sessionId === sessionId)
      .sort((a, b) => a.seq - b.seq);
  }

  async deleteSessionRecordingsBefore(cutoff: string): Promise<number> {
    let deleted = 0;
    for (const [key, chunk] of this.sessionRecordings) {
      if (chunk.startedAt < cutoff) {
        this.sessionRecordings.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- store-contract`
Expected: PASS (두 스토어 모두).

- [ ] **Step 8: 전체 테스트와 타입 검사**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add apps/api/src/db/schema.sqlite.ts apps/api/src/store/types.ts \
        apps/api/src/store/memory-store.ts apps/api/src/store/sqlite-store.ts \
        apps/api/src/store/store-contract.test.ts
git commit -m "저장: 세션 기록을 청크 단위로 담는다

세션 하나를 통짜 BLOB 으로 두지 않는다. 트리거 뒤에도 기록이 계속 올라오므로
이어 붙일 때마다 세션 전체를 다시 써야 한다.

같은 seq 재전송은 무시한다 - 네트워크가 불안정하면 평범하게 일어나는데,
두 번 저장하면 재생할 때 같은 구간이 두 번 나온다."
```

---

### Task 6: 보존 — 세션 기록은 기본 7일

**Files:**
- Modify: `apps/api/src/retention/config.ts`
- Create: `apps/api/src/retention/recordings.ts`
- Create: `apps/api/src/retention/recordings.test.ts`
- Modify: `apps/api/src/startup.ts`, `apps/api/src/server.ts`
- Test: `apps/api/src/retention/config.test.ts`, `apps/api/src/startup.test.ts`

**Interfaces:**
- Consumes: `deleteSessionRecordingsBefore` (Task 5)
- Produces:
  - `DEFAULT_SESSION_RECORDING_RETENTION_DAYS = 7`
  - `SessionRecordingRetentionConfig { sessionRecordingRetentionDays: number }`
  - `loadSessionRecordingRetentionConfig(env): SessionRecordingRetentionConfig`
  - `runSessionRecordingRetention(store, config, now?): Promise<number>`
  - `ServerStartupConfig.sessionRecordingRetentionConfig`

- [ ] **Step 1: 설정 테스트를 쓴다**

`apps/api/src/retention/config.test.ts` 에 추가:

```ts
describe("loadSessionRecordingRetentionConfig", () => {
  // EVENT_RETENTION_DAYS 와 일부러 다르다. 그쪽은 기본값이 없어 설정하지 않으면
  // 영원히 쌓이는데, 세션 기록은 이벤트 한 건(6 KB)의 25배(150 KB)이고
  // 개인정보 구멍의 크기가 보존 기간에 비례한다.
  it("설정하지 않으면 7일이다", () => {
    expect(loadSessionRecordingRetentionConfig({})).toEqual({ sessionRecordingRetentionDays: 7 });
  });

  it("환경 변수로 덮어쓴다", () => {
    expect(loadSessionRecordingRetentionConfig({ SESSION_RECORDING_RETENTION_DAYS: "30" })).toEqual({
      sessionRecordingRetentionDays: 30,
    });
  });

  it("양의 정수가 아니면 던진다", () => {
    expect(() => loadSessionRecordingRetentionConfig({ SESSION_RECORDING_RETENTION_DAYS: "0" })).toThrow();
    expect(() => loadSessionRecordingRetentionConfig({ SESSION_RECORDING_RETENTION_DAYS: "week" })).toThrow();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- retention/config`
Expected: FAIL — `loadSessionRecordingRetentionConfig is not a function`.

- [ ] **Step 3: 설정 로더를 더한다**

`apps/api/src/retention/config.ts` 끝에:

```ts
/**
 * EVENT_RETENTION_DAYS 와 달리 기본값을 둔다. 이벤트 한 건이 약 6 KB 인데 세션
 * 기록은 10분에 약 150 KB 로 25배고, 무엇보다 마스킹의 정본이 SDK 한 곳뿐이라
 * (서버가 재판정할 수 없다) 개인정보 구멍의 크기가 보존 기간에 그대로 비례한다.
 * 링크로 둔 CSS 때문에 오래된 기록은 어차피 스타일이 깨진다 - 길게 둘 값이 없다.
 */
export const DEFAULT_SESSION_RECORDING_RETENTION_DAYS = 7;

export interface SessionRecordingRetentionConfig {
  sessionRecordingRetentionDays: number;
}

export function loadSessionRecordingRetentionConfig(
  env: NodeJS.ProcessEnv,
): SessionRecordingRetentionConfig {
  const rawDays = env.SESSION_RECORDING_RETENTION_DAYS?.trim();
  if (!rawDays) {
    return { sessionRecordingRetentionDays: DEFAULT_SESSION_RECORDING_RETENTION_DAYS };
  }

  const sessionRecordingRetentionDays = Number(rawDays);
  if (!Number.isSafeInteger(sessionRecordingRetentionDays) || sessionRecordingRetentionDays <= 0) {
    throw new Error("SESSION_RECORDING_RETENTION_DAYS must be a positive safe integer");
  }

  return { sessionRecordingRetentionDays };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- retention/config`
Expected: PASS.

- [ ] **Step 5: 실행기 테스트를 쓴다**

`apps/api/src/retention/recordings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { runSessionRecordingRetention } from "./recordings.js";

async function storeWithChunks() {
  const store = new MemoryStore();
  const base = { projectId: "proj_1", sessionId: "sess_1", eventCount: 1, bytes: new Uint8Array([1]) };
  await store.saveSessionRecordingChunk({ ...base, seq: 0, startedAt: "2026-09-01T00:00:00.000Z" });
  await store.saveSessionRecordingChunk({ ...base, seq: 1, startedAt: "2026-09-13T00:00:00.000Z" });
  return store;
}

describe("runSessionRecordingRetention", () => {
  it("기한을 넘긴 청크만 지운다", async () => {
    const store = await storeWithChunks();

    const deleted = await runSessionRecordingRetention(
      store,
      { sessionRecordingRetentionDays: 7 },
      new Date("2026-09-14T00:00:00.000Z"),
    );

    expect(deleted).toBe(1);
    expect(await store.listSessionRecordingChunks("proj_1", "sess_1")).toHaveLength(1);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- retention/recordings`
Expected: FAIL — `Failed to resolve import "./recordings.js"`.

- [ ] **Step 7: 실행기를 만든다**

`apps/api/src/retention/recordings.ts`:

```ts
import type { TraceStore } from "../store/types.js";
import type { SessionRecordingRetentionConfig } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function sessionRecordingCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

// runEventRetention 과 달리 "설정이 없으면 아무것도 안 함" 분기가 없다.
// 세션 기록은 기본값이 있어 언제나 만료된다.
export async function runSessionRecordingRetention(
  store: TraceStore,
  config: SessionRecordingRetentionConfig,
  now: Date = new Date(),
): Promise<number> {
  return store.deleteSessionRecordingsBefore(
    sessionRecordingCutoff(now, config.sessionRecordingRetentionDays),
  );
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- retention/recordings`
Expected: PASS.

- [ ] **Step 9: 부팅에 연결한다**

`apps/api/src/startup.ts`:

```ts
import {
  loadEventRetentionConfig,
  loadSessionRecordingRetentionConfig,
  type EventRetentionConfig,
  type SessionRecordingRetentionConfig,
} from "./retention/config.js";
```

```ts
export interface ServerStartupConfig {
  authConfig?: AdminAuthConfig | undefined;
  eventRetentionConfig: EventRetentionConfig;
  sessionRecordingRetentionConfig: SessionRecordingRetentionConfig;
}
```

`prepareServerStartup` 안에서 `const sessionRecordingRetentionConfig = loadSessionRecordingRetentionConfig(input.env);` 를 만들고 반환 객체에 더한다.

`apps/api/src/server.ts` 에서 부팅 시 한 번 돌리고 `createApp` 에 넘긴다:

```ts
import { runSessionRecordingRetention } from "./retention/recordings.js";
```

```ts
await runEventRetention(store, startup.eventRetentionConfig);
await runSessionRecordingRetention(store, startup.sessionRecordingRetentionConfig);
```

```ts
const app = createApp({
  store,
  eventRetentionConfig: startup.eventRetentionConfig,
  sessionRecordingRetentionConfig: startup.sessionRecordingRetentionConfig,
  ...
});
```

`apps/api/src/app.ts` 의 `createApp` 옵션에 `sessionRecordingRetentionConfig?: SessionRecordingRetentionConfig | undefined;` 를 더한다. 아직 쓰는 라우트는 없다 — Task 7 에서 연결한다.

- [ ] **Step 10: 전체 테스트와 타입 검사**

Run: `npm test && npm run typecheck`
Expected: PASS. `startup.test.ts` 가 반환 객체를 통째로 비교하고 있으면 새 필드를 더해 준다.

- [ ] **Step 11: 커밋**

```bash
git add apps/api/src/retention/config.ts apps/api/src/retention/config.test.ts \
        apps/api/src/retention/recordings.ts apps/api/src/retention/recordings.test.ts \
        apps/api/src/startup.ts apps/api/src/startup.test.ts apps/api/src/server.ts apps/api/src/app.ts
git commit -m "보존: 세션 기록에 기본 7일 만료를 건다

EVENT_RETENTION_DAYS 와 일부러 다르다. 그쪽은 기본값이 없어 설정하지 않으면
영원히 쌓이는데, 리플레이에 같은 성질을 주면 안 된다 - 마스킹의 정본이 SDK
한 곳뿐이라 서버가 재판정할 수 없고, 구멍의 크기가 보존 기간에 비례한다."
```

---

### Task 7: 수집 엔드포인트 — POST /v1/sessions/:sessionId/recording

**Files:**
- Create: `apps/api/src/routes/recording.ts`
- Create: `apps/api/src/routes/recording.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `recordingChunkSchema` (Task 1), `saveSessionRecordingChunk` (Task 5), `runSessionRecordingRetention` (Task 6)
- Produces: `registerRecordingRoutes(app, { store, sessionRecordingRetentionConfig, now? })`
  - 요청 본문은 **gzip 된 JSON 봉투** `{ projectId, seq, startedAt, url, sdkVersion, events }`, content-type 은 `application/octet-stream`
  - 응답 202 `{ accepted: <이벤트 수> }`

- [ ] **Step 1: 테스트를 쓴다**

`apps/api/src/routes/recording.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { MemoryStore } from "../store/memory-store.js";

const ORIGIN = "https://demo.example.com";

async function replayProject(store: MemoryStore, enabled = true) {
  const project = await store.createProject({ name: "Demo", allowedDomains: [ORIGIN] });
  await store.updateProject(project.projectId, {
    name: project.name,
    allowedDomains: project.allowedDomains,
    replay: { enabled, maskSelectors: [] },
  });
  return project;
}

function chunkBody(overrides: Record<string, unknown> = {}) {
  return gzipSync(
    Buffer.from(
      JSON.stringify({
        projectId: "proj_replace_me",
        seq: 0,
        startedAt: "2026-09-14T00:00:00.000Z",
        url: `${ORIGIN}/orders?token=secret`,
        sdkVersion: "0.1.0",
        events: [{ type: 2, timestamp: 1 }, { type: 3, timestamp: 2 }],
        ...overrides,
      }),
    ),
  );
}

function post(app: ReturnType<typeof createApp>, body: Buffer, sessionId = "sess_abc123") {
  return app.inject({
    method: "POST",
    url: `/v1/sessions/${sessionId}/recording`,
    headers: { origin: ORIGIN, "content-type": "application/octet-stream" },
    payload: body,
  });
}

describe("POST /v1/sessions/:sessionId/recording", () => {
  it("gzip 청크를 받아 보낸 바이트 그대로 저장한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });
    const body = chunkBody({ projectId: project.projectId });

    const response = await post(app, body);

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 2 });
    const stored = await store.listSessionRecordingChunks(project.projectId, "sess_abc123");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.eventCount).toBe(2);
    // 풀어서 저장하지 않는다 - 보낸 gzip 바이트가 그대로 남아야 한다.
    expect(Buffer.from(stored[0]!.bytes).equals(body)).toBe(true);
  });

  // rrweb 이벤트 모양은 버전에 묶여 있다. 서버가 내부 구조를 판정하면 rrweb 을
  // 올릴 때마다 멀쩡한 기록이 400 이 된다.
  it("rrweb 이벤트의 내부 구조를 보지 않는다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });

    const response = await post(
      app,
      chunkBody({ projectId: project.projectId, events: [{ 모르는필드: true }, 7] }),
    );

    expect(response.statusCode).toBe(202);
  });

  it("리플레이가 꺼진 프로젝트의 기록을 거절한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store, false);
    const app = createApp({ store });

    const response = await post(app, chunkBody({ projectId: project.projectId }));

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "replay_disabled" });
  });

  it("허용하지 않은 도메인을 거절한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_abc123/recording",
      headers: { origin: "https://evil.example.com", "content-type": "application/octet-stream" },
      payload: chunkBody({ projectId: project.projectId }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "domain_not_allowed" });
  });

  it("없는 프로젝트는 404 다", async () => {
    const store = new MemoryStore();
    const app = createApp({ store });

    const response = await post(app, chunkBody({ projectId: "proj_missing" }));

    expect(response.statusCode).toBe(404);
  });

  it("gzip 이 아닌 본문을 400 으로 거절한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });

    const response = await post(app, Buffer.from("not gzip at all"));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_recording_chunk" });
  });

  // 압축 폭탄. 이 가드가 없으면 2 MB 본문이 해제 중에 수 GB 로 부풀어 서버가 죽는다.
  it("압축 해제 결과가 상한을 넘으면 거절한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x61));

    const response = await post(app, bomb);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_recording_chunk" });
  });

  it("세션 식별자 모양을 검증한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });

    const response = await post(app, chunkBody({ projectId: project.projectId }), "not a session");

    expect(response.statusCode).toBe(400);
  });

  it("같은 seq 재전송은 한 번만 저장된다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });
    const body = chunkBody({ projectId: project.projectId });

    await post(app, body);
    const second = await post(app, body);

    expect(second.statusCode).toBe(202);
    expect(await store.listSessionRecordingChunks(project.projectId, "sess_abc123")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- routes/recording`
Expected: FAIL — 라우트가 없어 404 다.

- [ ] **Step 3: 라우트를 만든다**

`apps/api/src/routes/recording.ts`:

```ts
import { gunzipSync } from "node:zlib";
import { isSafeTraceIdentifier, recordingChunkSchema, redactUrl } from "@trace/shared";
import {
  MAX_RECORDING_CHUNK_BYTES,
  MAX_RECORDING_DECOMPRESSED_BYTES,
} from "@trace/shared/recording-limits";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SessionRecordingRetentionConfig } from "../retention/config.js";
import { runSessionRecordingRetention } from "../retention/recordings.js";
import type { TraceStore } from "../store/types.js";

const paramsSchema = z.object({
  sessionId: z.string().refine((value) => isSafeTraceIdentifier(value, "sess")),
});

export async function registerRecordingRoutes(
  app: FastifyInstance,
  options: {
    store: TraceStore;
    sessionRecordingRetentionConfig: SessionRecordingRetentionConfig;
    now?: (() => Date) | undefined;
  },
): Promise<void> {
  // 본문은 gzip 된 JSON 봉투다. content-encoding 을 쓰지 않는 것은 의도다 -
  // 중간 프록시가 알아서 풀어 버리면 우리가 받는 것이 gzip 인지 아닌지
  // 요청마다 달라진다.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  // 이벤트 배치와 한 통에 넣지 않는다. 그쪽은 keepalive 64 KiB 한도 때문에
  // 48 KiB 로 묶여 있고, 성격이 다른 두 트래픽을 섞으면 서로를 밀어낸다.
  app.post(
    "/v1/sessions/:sessionId/recording",
    { bodyLimit: MAX_RECORDING_CHUNK_BYTES },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_session_id" });

      const body = request.body;
      if (!Buffer.isBuffer(body)) return reply.code(415).send({ error: "expected_gzip_body" });

      let envelope: unknown;
      try {
        const json = gunzipSync(body, { maxOutputLength: MAX_RECORDING_DECOMPRESSED_BYTES });
        envelope = JSON.parse(json.toString("utf8"));
      } catch {
        return reply.code(400).send({ error: "invalid_recording_chunk" });
      }

      const parsed = recordingChunkSchema.safeParse(envelope);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_recording_chunk" });
      const chunk = parsed.data;

      const project = await options.store.getProject(chunk.projectId);
      if (!project) return reply.code(404).send({ error: "project_not_found" });
      if (!project.replay.enabled) return reply.code(403).send({ error: "replay_disabled" });

      let redacted;
      try {
        redacted = redactUrl(chunk.url);
      } catch {
        return reply.code(400).send({ error: "invalid_recording_chunk" });
      }
      const origin = request.headers.origin ?? redacted.origin;
      if (!project.allowedDomains.includes(origin) || !project.allowedDomains.includes(redacted.origin)) {
        return reply.code(403).send({ error: "domain_not_allowed" });
      }

      // 받은 gzip 바이트를 그대로 넣는다. 풀어서 저장하면 12.8배로 부푼다.
      await options.store.saveSessionRecordingChunk({
        sessionId: params.data.sessionId,
        projectId: chunk.projectId,
        seq: chunk.seq,
        startedAt: chunk.startedAt,
        eventCount: chunk.events.length,
        bytes: new Uint8Array(body),
      });

      await runSessionRecordingRetention(
        options.store,
        options.sessionRecordingRetentionConfig,
        options.now?.() ?? new Date(),
      );

      return reply.code(202).send({ accepted: chunk.events.length });
    },
  );
}
```

- [ ] **Step 4: app.ts 에 등록한다**

```ts
  app.register(registerRecordingRoutes, {
    store: options.store,
    sessionRecordingRetentionConfig: options.sessionRecordingRetentionConfig ?? {
      sessionRecordingRetentionDays: DEFAULT_SESSION_RECORDING_RETENTION_DAYS,
    },
    now: options.now,
  });
```

`DEFAULT_SESSION_RECORDING_RETENTION_DAYS` 를 `./retention/config.js` 에서 import 한다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- routes/recording`
Expected: PASS. 압축 폭탄 테스트가 느리면(수 초) 그대로 둔다 — 64 MB 를 만드는 비용이다.

- [ ] **Step 6: 본문 크기 상한을 눈으로 확인한다**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx vitest run apps/api/src/routes/recording.test.ts --reporter=verbose
```

Expected: 모든 케이스 PASS. `bodyLimit` 초과(413)는 `app.inject` 로 3 MB 본문을 보내 따로 확인해도 좋다 — Fastify 가 `FST_ERR_CTP_BODY_TOO_LARGE` 로 413 을 낸다.

- [ ] **Step 7: 전체 테스트와 타입 검사**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add apps/api/src/routes/recording.ts apps/api/src/routes/recording.test.ts apps/api/src/app.ts
git commit -m "수집: 세션 기록 청크를 받는 전용 엔드포인트를 연다

이벤트 배치와 한 통에 넣지 않는다. 그쪽은 브라우저 keepalive 64 KiB 한도
때문에 48 KiB 로 묶여 있고, 성격이 다른 두 트래픽을 섞으면 서로를 밀어낸다.

받은 gzip 바이트를 그대로 저장한다. 풀어서 저장하면 12.8배로 부푼다.
압축 해제에는 상한을 건다 - 없으면 2 MB 본문이 해제 중에 수 GB 가 된다."
```

---

### Task 8: /trace-replay.js 를 서빙한다

**Files:**
- Modify: `apps/api/src/routes/sdk-bundle.ts`
- Test: `apps/api/src/routes/sdk-bundle.test.ts`

**Interfaces:**
- Produces: `registerSdkBundleRoutes(app, { bundlePath?, replayBundlePath? })` — `/trace.js` 와 `/trace-replay.js`

- [ ] **Step 1: 테스트를 쓴다**

`apps/api/src/routes/sdk-bundle.test.ts` 의 `createBundleFile` 을 파일명을 받도록 고치고(`createBundleFile(contents, name = "trace.js")`), 아래를 더한다:

```ts
describe("GET /trace-replay.js", () => {
  it("리플레이 번들을 JavaScript content type 으로 내려준다", async () => {
    const replayBundlePath = await createBundleFile("window.__replay=1;", "trace-replay.js");
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, { replayBundlePath });

    const response = await app.inject({ method: "GET", url: "/trace-replay.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/javascript");
    expect(response.body).toBe("window.__replay=1;");
    await app.close();
  });

  it("번들이 없으면 404 와 빌드 안내 코드를 반환한다", async () => {
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, {
      replayBundlePath: path.join(tmpdir(), "trace-missing", "trace-replay.js"),
    });

    const response = await app.inject({ method: "GET", url: "/trace-replay.js" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "replay_bundle_not_built" });
    await app.close();
  });

  // CDN 을 쓰지 않는 이유가 여기 걸려 있다. 리플레이 번들이 trace.js 와 같은
  // 출처에서 오므로 고객의 CSP 에 새로 추가할 항목이 없다.
  it("기본 번들과 같은 출처에서 서빙한다", async () => {
    const bundlePath = await createBundleFile("window.trace={};");
    const replayBundlePath = await createBundleFile("window.__replay=1;", "trace-replay.js");
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, { bundlePath, replayBundlePath });

    expect((await app.inject({ method: "GET", url: "/trace.js" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/trace-replay.js" })).statusCode).toBe(200);
    await app.close();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/api -- sdk-bundle`
Expected: FAIL — `/trace-replay.js` 가 404 이고 본문이 `{"message":"Route GET:/trace-replay.js not found"...}` 다.

- [ ] **Step 3: 라우트를 일반화한다**

`apps/api/src/routes/sdk-bundle.ts` 를 바꾼다:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

// src/routes와 dist/routes의 깊이가 같으므로 하나의 상대 경로가 개발과 빌드 양쪽에서 동작한다.
const DEFAULT_BUNDLE_PATH = fileURLToPath(
  new URL("../../../../packages/sdk/dist/trace.js", import.meta.url),
);
const DEFAULT_REPLAY_BUNDLE_PATH = fileURLToPath(
  new URL("../../../../packages/sdk/dist/trace-replay.js", import.meta.url),
);

export async function registerSdkBundleRoutes(
  app: FastifyInstance,
  options: { bundlePath?: string; replayBundlePath?: string },
): Promise<void> {
  // 리플레이 번들도 우리가 직접 서빙한다. CDN 을 쓰면 self-hosted 제품이 외부
  // 의존을 갖게 되고, 고객마다 CSP script-src 에 항목을 넣어야 하며, 안 넣으면
  // 조용히 실패한다. 같은 출처면 추가할 것이 없다.
  const bundles: Array<{ route: string; path: string; missingError: string }> = [
    { route: "/trace.js", path: options.bundlePath ?? DEFAULT_BUNDLE_PATH, missingError: "sdk_bundle_not_built" },
    {
      route: "/trace-replay.js",
      path: options.replayBundlePath ?? DEFAULT_REPLAY_BUNDLE_PATH,
      missingError: "replay_bundle_not_built",
    },
  ];

  for (const bundle of bundles) {
    app.get(bundle.route, async (_request, reply) => {
      let contents: Buffer;

      try {
        contents = await readFile(bundle.path);
      } catch {
        return reply.code(404).send({ error: bundle.missingError });
      }

      return reply
        .header("content-type", "application/javascript; charset=utf-8")
        .header("cache-control", "no-store")
        .send(contents);
    });
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/api -- sdk-bundle`
Expected: PASS (기존 세 건 포함).

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/routes/sdk-bundle.ts apps/api/src/routes/sdk-bundle.test.ts
git commit -m "번들: 리플레이 스크립트를 trace.js 와 같은 출처에서 서빙한다

CDN 을 쓰지 않는다. self-hosted 제품이 외부 의존을 갖게 되고, 고객마다 CSP
script-src 에 항목을 넣어야 하며 안 넣으면 조용히 실패한다."
```

---

### Task 9: SDK 마스킹 — 패턴 치환과 data: URI 제거

**Files:**
- Create: `packages/sdk/src/replay/mask.ts`
- Create: `packages/sdk/src/replay/mask.test.ts`

**Interfaces:**
- Consumes: `redactPatterns` from `@trace/shared/privacy` (Task 1)
- Produces:
  - `maskText(text: string): string`
  - `stripDataUris(value: unknown): void` — 제자리에서 바꾼다

- [ ] **Step 1: 테스트를 쓴다**

`packages/sdk/src/replay/mask.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { maskText, stripDataUris, TRANSPARENT_PLACEHOLDER } from "./mask.js";

describe("maskText", () => {
  it("이메일·휴대폰·9자리 이상 숫자를 지운다", () => {
    expect(maskText("문의 choi@example.com / 010-1234-5678")).toBe("문의 [redacted] / [redacted]");
  });

  // 재생은 화면 본문을 그대로 보여준다. 자르면 원본과 다른 화면이 된다.
  it("긴 본문을 자르지 않는다", () => {
    const long = "가".repeat(400);
    expect(maskText(long)).toBe(long);
  });

  // 정직하게 남는 구멍이다. 패턴이 없는 이름은 운영자가 셀렉터로 지정해야 가려진다.
  it("패턴 없는 사람 이름은 통과한다 — 운영자 셀렉터의 몫이다", () => {
    expect(maskText("최미애")).toBe("최미애");
  });
});

describe("stripDataUris", () => {
  it("스냅샷 트리 안쪽의 data: 이미지를 자리표시자로 바꾼다", () => {
    const snapshot = {
      type: 2,
      data: {
        node: {
          childNodes: [
            { tagName: "img", attributes: { src: "data:image/png;base64,AAAA", alt: "로고" } },
            { tagName: "img", attributes: { src: "/static/logo.png" } },
          ],
        },
      },
    };

    stripDataUris(snapshot);

    const nodes = snapshot.data.node.childNodes;
    expect(nodes[0]!.attributes.src).toBe(TRANSPARENT_PLACEHOLDER);
    expect(nodes[0]!.attributes.alt).toBe("로고");
    expect(nodes[1]!.attributes.src).toBe("/static/logo.png");
  });

  // 스냅샷만 훑으면 새어 나간다. 페이지가 나중에 붙이는 노드도 같은 base64 를 싣는다.
  it("mutation 으로 추가되는 노드도 훑는다", () => {
    const mutation = {
      type: 3,
      data: { source: 0, adds: [{ node: { tagName: "img", attributes: { srcset: "data:image/gif;base64,BBBB 2x" } } }] },
    };

    stripDataUris(mutation);

    expect(mutation.data.adds[0]!.node.attributes.srcset).toBe(TRANSPARENT_PLACEHOLDER);
  });

  it("data: href 는 빈 값으로 만든다", () => {
    const event = { data: { node: { tagName: "link", attributes: { href: "data:text/css,body{}" } } } };

    stripDataUris(event);

    expect(event.data.node.attributes.href).toBe("");
  });

  it("null 과 원시값에서 터지지 않는다", () => {
    expect(() => stripDataUris(null)).not.toThrow();
    expect(() => stripDataUris(42)).not.toThrow();
    expect(() => stripDataUris([null, { attributes: null }])).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- mask`
Expected: FAIL — `Failed to resolve import "./mask.js"`.

- [ ] **Step 3: 구현한다**

`packages/sdk/src/replay/mask.ts`:

```ts
import { redactPatterns } from "@trace/shared/privacy";

/**
 * 1x1 투명 GIF. 빈 문자열로 두면 브라우저가 깨진 이미지 아이콘을 그려 재생
 * 화면이 원본과 달라진다.
 */
export const TRANSPARENT_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * rrweb 의 maskTextFn. 구조(maskAllInputs·maskTextSelector)가 놓친 것을 패턴으로
 * 한 번 더 거른다. redactText 가 아니라 redactPatterns 를 쓰는 것은 의도다 -
 * 120자 자르기가 화면 본문을 조용히 잘라 재생이 원본과 달라진다.
 */
export function maskText(text: string): string {
  return redactPatterns(text);
}

const DATA_URI_PATTERN = /^\s*data:/i;
const STRIPPED_ATTRIBUTES = ["src", "srcset", "href"] as const;

/**
 * rrweb 이벤트에서 data: URI 를 걷어낸다. 이 버전의 rrweb 에는 maskAttributeFn 이
 * 없어서(번들 grep 0회) 우리가 직접 훑는다.
 *
 * 스냅샷만 훑으면 새어 나간다 - 페이지가 나중에 붙이는 노드도 같은 base64 를
 * 싣고 오므로 mutation 이벤트까지 같은 함수로 훑는다. 그래서 rrweb 의 특정
 * 구조를 가정하지 않고 객체 트리 전체를 돈다.
 *
 * 실측 근거: 대상 앱 스냅샷 5,285,916 B 의 95%가 base64 이미지 145개였고,
 * 걷어내면 30,016 B 가 된다(187배).
 */
export function stripDataUris(value: unknown): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) stripDataUris(item);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const name of STRIPPED_ATTRIBUTES) {
    const attribute = record[name];
    if (typeof attribute === "string" && DATA_URI_PATTERN.test(attribute)) {
      record[name] = name === "href" ? "" : TRANSPARENT_PLACEHOLDER;
    }
  }

  for (const nested of Object.values(record)) stripDataUris(nested);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- mask`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/sdk/src/replay/mask.ts packages/sdk/src/replay/mask.test.ts
git commit -m "리플레이: 텍스트 패턴을 가리고 data: URI 를 걷어낸다

이 버전의 rrweb 에는 maskAttributeFn 이 없어 우리가 직접 훑는다. 스냅샷만
훑으면 새어 나간다 - 페이지가 나중에 붙이는 노드도 같은 base64 를 싣는다.

실측: 스냅샷 5,285,916 B 의 95%가 base64 이미지 145개였고 걷어내면 30,016 B 다."
```

---

### Task 10: 롤링 버퍼 — 체크포인트를 한 세대 늦춰 버린다

**Files:**
- Create: `packages/sdk/src/replay/buffer.ts`
- Create: `packages/sdk/src/replay/buffer.test.ts`

**Interfaces:**
- Consumes: `BUFFERED_CHECKPOINT_GENERATIONS` from `@trace/shared/recording-limits` (Task 1)
- Produces:
  ```ts
  export interface RecordedEvent { type: number; timestamp: number; [key: string]: unknown }
  export class CheckpointBuffer {
    constructor(maxGenerations?: number);
    push(event: RecordedEvent, isCheckout?: boolean): void;
    drain(): RecordedEvent[];
    stopDiscarding(): void;
    readonly size: number;
  }
  ```

- [ ] **Step 1: 테스트를 쓴다**

`packages/sdk/src/replay/buffer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CheckpointBuffer, type RecordedEvent } from "./buffer.js";

const event = (timestamp: number): RecordedEvent => ({ type: 3, timestamp });
const snapshot = (timestamp: number): RecordedEvent => ({ type: 2, timestamp });

describe("CheckpointBuffer", () => {
  it("담은 순서대로 돌려준다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.push(event(2));
    buffer.push(event(3));

    expect(buffer.drain().map((item) => item.timestamp)).toEqual([1, 2, 3]);
  });

  // 세대 하나만 쥐면 체크포인트 직후에 난 문제는 앞 맥락이 0초가 된다.
  // 두 세대면 최소 2분, 최대 4분이 보장된다.
  it("두 세대를 쥐고 그 이전 세대를 버린다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.push(event(2));
    buffer.push(snapshot(3), true);
    buffer.push(event(4));
    buffer.push(snapshot(5), true);
    buffer.push(event(6));

    expect(buffer.drain().map((item) => item.timestamp)).toEqual([3, 4, 5, 6]);
  });

  it("drain 뒤에는 비어 있다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.drain();

    expect(buffer.size).toBe(0);
    expect(buffer.drain()).toEqual([]);
  });

  // 트리거 뒤에는 계속 이어 올린다. 이때도 세대를 버리면 아직 올리지 못한
  // 구간이 사라져 재생에 구멍이 생긴다.
  it("stopDiscarding 뒤에는 아무 세대도 버리지 않는다", () => {
    const buffer = new CheckpointBuffer();
    buffer.stopDiscarding();
    buffer.push(snapshot(1), true);
    buffer.push(snapshot(2), true);
    buffer.push(snapshot(3), true);

    expect(buffer.drain().map((item) => item.timestamp)).toEqual([1, 2, 3]);
  });

  it("size 는 모든 세대의 합이다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.push(event(2));
    buffer.push(snapshot(3), true);

    expect(buffer.size).toBe(3);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- buffer`
Expected: FAIL — `Failed to resolve import "./buffer.js"`.

- [ ] **Step 3: 구현한다**

`packages/sdk/src/replay/buffer.ts`:

```ts
import { BUFFERED_CHECKPOINT_GENERATIONS } from "@trace/shared/recording-limits";

export interface RecordedEvent {
  type: number;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * rrweb 이벤트를 체크포인트 세대로 나눠 담는다. 세대는 `isCheckout` 이 붙은
 * 전체 스냅샷에서 시작하므로 세대 하나만으로도 그 자체로 재생 가능하다.
 *
 * 세대를 두 개 쥐는 것이 이 클래스의 요점이다. 하나만 쥐면 체크포인트 직후에
 * 난 문제는 앞 맥락이 거의 0초가 되어, 같은 종류의 문제인데 어떤 건 앞이
 * 통째로 없다. 두 개면 2~4분이 보장된다.
 *
 * 메모리: 스냅샷은 압축 전 약 383 KB, 변경분은 209 B/s(4분에 50 KB)다.
 * 세대마다 스냅샷을 하나씩 들고 있으므로 약 816 KB 를 예상한다 - 실제 값은
 * Task 13 의 브라우저 확인에서 잰다.
 */
export class CheckpointBuffer {
  private generations: RecordedEvent[][] = [[]];
  private discarding = true;

  constructor(private readonly maxGenerations: number = BUFFERED_CHECKPOINT_GENERATIONS) {}

  push(event: RecordedEvent, isCheckout = false): void {
    if (isCheckout) {
      this.generations.push([]);
      while (this.discarding && this.generations.length > this.maxGenerations) {
        this.generations.shift();
      }
    }

    this.generations[this.generations.length - 1]!.push(event);
  }

  /**
   * 트리거가 걸린 뒤 호출한다. 그 뒤로는 계속 이어 올리므로, 세대를 버리면
   * 아직 올리지 못한 구간이 사라져 재생에 구멍이 생긴다.
   */
  stopDiscarding(): void {
    this.discarding = false;
  }

  drain(): RecordedEvent[] {
    const events = this.generations.flat();
    this.generations = [[]];
    return events;
  }

  get size(): number {
    let total = 0;
    for (const generation of this.generations) total += generation.length;
    return total;
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- buffer`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/sdk/src/replay/buffer.ts packages/sdk/src/replay/buffer.test.ts
git commit -m "리플레이: 체크포인트를 한 세대 늦춰 버리는 롤링 버퍼를 만든다

세대 하나만 쥐면 체크포인트 직후에 난 문제는 앞 맥락이 거의 0초가 된다.
같은 종류의 문제인데 어떤 건 앞이 통째로 없는 상태가 된다.

트리거 뒤에는 버리지 않는다 - 그때부터는 계속 이어 올리므로 아직 올리지
못한 구간이 사라지면 재생에 구멍이 생긴다."
```

---

### Task 11: 트리거 — 무엇이 업로드를 촉발하는가

**Files:**
- Create: `packages/sdk/src/replay/triggers.ts`
- Create: `packages/sdk/src/replay/triggers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TriggerReason = "rage_click" | "js_error" | "dead_click";
  export interface TriggerHandle { notifyMutation(): void; dispose(): void }
  export function installTriggers(
    target: Window,
    options: { onTrigger: (reason: TriggerReason) => void; now?: () => number },
  ): TriggerHandle;
  export const RAGE_CLICK_COUNT: number;
  export const RAGE_CLICK_WINDOW_MS: number;
  export const DEAD_CLICK_TIMEOUT_MS: number;
  ```

- [ ] **Step 1: 테스트를 쓴다**

`packages/sdk/src/replay/triggers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTriggers, type TriggerReason } from "./triggers.js";

function setup() {
  const reasons: TriggerReason[] = [];
  const handle = installTriggers(window, { onTrigger: (reason) => reasons.push(reason) });
  return { reasons, handle };
}

function clickOn(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("installTriggers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("같은 요소를 3초 안에 세 번 누르면 분노 클릭이다", () => {
    const { reasons, handle } = setup();
    const button = document.querySelector("#a")!;

    clickOn(button);
    handle.notifyMutation();
    clickOn(button);
    handle.notifyMutation();
    clickOn(button);
    handle.notifyMutation();

    expect(reasons).toContain("rage_click");
    handle.dispose();
  });

  it("3초를 넘겨 누르면 분노 클릭이 아니다", () => {
    const { reasons, handle } = setup();
    const button = document.querySelector("#a")!;

    clickOn(button);
    handle.notifyMutation();
    vi.advanceTimersByTime(4000);
    clickOn(button);
    handle.notifyMutation();
    vi.advanceTimersByTime(4000);
    clickOn(button);
    handle.notifyMutation();

    expect(reasons).not.toContain("rage_click");
    handle.dispose();
  });

  it("다른 요소를 누르면 연속 횟수가 초기화된다", () => {
    const { reasons, handle } = setup();

    clickOn(document.querySelector("#a")!);
    handle.notifyMutation();
    clickOn(document.querySelector("#a")!);
    handle.notifyMutation();
    clickOn(document.querySelector("#b")!);
    handle.notifyMutation();
    clickOn(document.querySelector("#a")!);
    handle.notifyMutation();

    expect(reasons).not.toContain("rage_click");
    handle.dispose();
  });

  it("클릭 뒤 2초간 DOM 변경이 없으면 반응 없는 클릭이다", () => {
    const { reasons, handle } = setup();

    clickOn(document.querySelector("#a")!);
    vi.advanceTimersByTime(2000);

    expect(reasons).toEqual(["dead_click"]);
    handle.dispose();
  });

  it("2초 안에 DOM 이 바뀌면 반응 없는 클릭이 아니다", () => {
    const { reasons, handle } = setup();

    clickOn(document.querySelector("#a")!);
    vi.advanceTimersByTime(500);
    handle.notifyMutation();
    vi.advanceTimersByTime(2000);

    expect(reasons).not.toContain("dead_click");
    handle.dispose();
  });

  it("오류가 나면 바로 트리거한다", () => {
    const { reasons, handle } = setup();

    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));

    expect(reasons).toEqual(["js_error"]);
    handle.dispose();
  });

  it("dispose 뒤에는 아무것도 트리거하지 않는다", () => {
    const { reasons, handle } = setup();
    handle.dispose();

    clickOn(document.querySelector("#a")!);
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));

    expect(reasons).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- triggers`
Expected: FAIL — `Failed to resolve import "./triggers.js"`.

- [ ] **Step 3: 구현한다**

`packages/sdk/src/replay/triggers.ts`:

```ts
export type TriggerReason = "rage_click" | "js_error" | "dead_click";

export const RAGE_CLICK_COUNT = 3;
export const RAGE_CLICK_WINDOW_MS = 3000;
export const DEAD_CLICK_TIMEOUT_MS = 2000;

export interface TriggerHandle {
  /** rrweb 이 DOM 변경 이벤트를 낼 때마다 부른다. 반응 없는 클릭 판정에 쓴다. */
  notifyMutation(): void;
  dispose(): void;
}

/**
 * "이 세션을 올릴까?" 를 묻는 느슨한 필터다. 서버의 이슈 탐지(detect.ts)와
 * 일부러 다르다 - 서버는 "이게 이슈인가?" 를 정확히 판정하는 정본이고, 여기는
 * 놓치는 것보다 더 올리는 쪽이 낫다. 틀렸을 때의 대가도 다르다: 여기가 틀리면
 * 리플레이 몇 개가 더 저장될 뿐이고, 서버가 틀리면 이슈 판정이 틀린다.
 *
 * 특히 반응 없는 클릭의 기준이 다르다 - 서버는 "2초 안에 같은 세션의 다른
 * 이벤트가 없음", 여기는 "2초 안에 DOM 변경이 없음" 이다. 같게 만들려 하지
 * 않는다. 이 저장소는 상수 하나를 두 벌로 갈라 뒀다가 조용히 깨진 전례가
 * 있고(계약 20 / 수집 API 12), 여기서 어긋나면 실패가 더 조용하다 -
 * 리플레이가 그냥 안 올라온다.
 */
export function installTriggers(
  target: Window,
  options: { onTrigger: (reason: TriggerReason) => void; now?: () => number },
): TriggerHandle {
  const now = options.now ?? (() => Date.now());

  let lastTarget: EventTarget | null = null;
  let clickTimes: number[] = [];
  let deadClickTimer: ReturnType<typeof setTimeout> | undefined;
  let mutatedSinceClick = false;
  let disposed = false;

  const clearDeadClickTimer = () => {
    if (deadClickTimer !== undefined) {
      clearTimeout(deadClickTimer);
      deadClickTimer = undefined;
    }
  };

  const onClick = (event: Event) => {
    if (disposed) return;
    const at = now();

    if (event.target !== lastTarget) {
      lastTarget = event.target;
      clickTimes = [];
    }
    clickTimes = clickTimes.filter((time) => at - time < RAGE_CLICK_WINDOW_MS);
    clickTimes.push(at);
    if (clickTimes.length >= RAGE_CLICK_COUNT) {
      clickTimes = [];
      options.onTrigger("rage_click");
    }

    mutatedSinceClick = false;
    clearDeadClickTimer();
    deadClickTimer = setTimeout(() => {
      deadClickTimer = undefined;
      if (!disposed && !mutatedSinceClick) options.onTrigger("dead_click");
    }, DEAD_CLICK_TIMEOUT_MS);
  };

  const onError = () => {
    if (!disposed) options.onTrigger("js_error");
  };

  // 캡처 단계에서 듣는다. 고객 사이트가 stopPropagation 을 부르면 버블 단계
  // 리스너에는 클릭이 오지 않는다.
  target.addEventListener("click", onClick, true);
  target.addEventListener("error", onError);

  return {
    notifyMutation() {
      mutatedSinceClick = true;
    },
    dispose() {
      disposed = true;
      clearDeadClickTimer();
      target.removeEventListener("click", onClick, true);
      target.removeEventListener("error", onError);
    },
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- triggers`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/sdk/src/replay/triggers.ts packages/sdk/src/replay/triggers.test.ts
git commit -m "리플레이: 업로드를 촉발하는 트리거 셋을 만든다

서버 이슈 탐지의 사본이 아니다. 서버는 '이게 이슈인가' 를 판정하는 정본이고
여기는 '이 세션을 올릴까' 를 묻는 느슨한 필터라, 놓치는 것보다 더 올리는
쪽이 낫다. 반응 없는 클릭의 기준을 일부러 다르게 뒀다 - 서버는 다른 이벤트의
부재, 여기는 DOM 변경의 부재를 본다."
```

---

### Task 12: 업로더 — 트리거 전에는 아무것도 나가지 않는다

**Files:**
- Create: `packages/sdk/src/replay/uploader.ts`
- Create: `packages/sdk/src/replay/uploader.test.ts`

**Interfaces:**
- Consumes: `RecordedEvent` (Task 10)
- Produces:
  ```ts
  export function gzip(bytes: Uint8Array): Promise<Uint8Array>;
  export class RecordingUploader {
    constructor(options: {
      endpoint: string;
      projectId: string;
      sdkVersion: string;
      compress?: (bytes: Uint8Array) => Promise<Uint8Array>;
      fetcher?: (input: string, init?: RequestInit) => Promise<{ ok: boolean; status?: number }>;
      currentUrl?: () => string;
    });
    enqueue(events: RecordedEvent[]): void;
    flush(options?: { keepalive?: boolean }): Promise<boolean>;
    readonly pendingCount: number;
  }
  ```

- [ ] **Step 1: 테스트를 쓴다**

`packages/sdk/src/replay/uploader.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { RecordedEvent } from "./buffer.js";
import { RecordingUploader } from "./uploader.js";

const identity = async (bytes: Uint8Array) => bytes;

function createUploader(fetcher: ReturnType<typeof vi.fn>) {
  return new RecordingUploader({
    endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
    projectId: "proj_1",
    sdkVersion: "0.1.0",
    compress: identity,
    fetcher: fetcher as never,
    currentUrl: () => "https://demo.example.com/orders",
  });
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as { body: Uint8Array };
  return JSON.parse(new TextDecoder().decode(init.body)) as Record<string, unknown>;
}

const event = (timestamp: number): RecordedEvent => ({ type: 3, timestamp });

describe("RecordingUploader", () => {
  // 이 계획에서 가장 중요한 불변식이다. 트리거가 없으면 아무것도 브라우저를
  // 떠나지 않는다.
  it("대기열이 비어 있으면 아무것도 보내지 않는다", async () => {
    const fetcher = vi.fn();
    const uploader = createUploader(fetcher);

    await uploader.flush();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("봉투에 프로젝트·순번·시작 시각·이벤트를 싣는다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1757808000000), event(1757808001000)]);

    await uploader.flush();

    const body = bodyOf(fetcher.mock.calls[0]!);
    expect(body.projectId).toBe("proj_1");
    expect(body.seq).toBe(0);
    expect(body.startedAt).toBe(new Date(1757808000000).toISOString());
    expect(body.url).toBe("https://demo.example.com/orders");
    expect(body.events).toHaveLength(2);
  });

  it("순번은 성공할 때만 올라간다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    await uploader.flush();
    uploader.enqueue([event(2)]);
    await uploader.flush();

    expect(bodyOf(fetcher.mock.calls[0]!).seq).toBe(0);
    expect(bodyOf(fetcher.mock.calls[1]!).seq).toBe(1);
  });

  // 실패한 구간을 버리면 재생에 구멍이 생긴다.
  it("실패하면 같은 순번으로 다음 flush 에서 다시 보낸다", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, status: 202 });
    const uploader = createUploader(fetcher);

    uploader.enqueue([event(1)]);
    expect(await uploader.flush()).toBe(false);
    expect(uploader.pendingCount).toBe(1);

    expect(await uploader.flush()).toBe(true);
    expect(bodyOf(fetcher.mock.calls[1]!).seq).toBe(0);
  });

  it("네트워크가 던져도 고객 사이트로 오류를 흘리지 않는다", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    await expect(uploader.flush()).resolves.toBe(false);
    expect(uploader.pendingCount).toBe(1);
  });

  // keepalive 는 64 KiB 한도가 있다. 기록 청크는 그보다 훨씬 크므로 평상시에
  // 쓰면 네트워크 오류로 거절되어 영원히 재시도한다.
  it("평상시에는 keepalive 를 쓰지 않는다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    await uploader.flush();

    expect((fetcher.mock.calls[0]![1] as RequestInit).keepalive).toBeFalsy();
  });

  it("페이지를 떠날 때의 마지막 꼬리만 keepalive 로 보낸다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    await uploader.flush({ keepalive: true });

    expect((fetcher.mock.calls[0]![1] as RequestInit).keepalive).toBe(true);
  });

  it("content-type 은 octet-stream 이다", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 202 }));
    const uploader = createUploader(fetcher);
    uploader.enqueue([event(1)]);

    await uploader.flush();

    const headers = (fetcher.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers["content-type"]).toBe("application/octet-stream");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- uploader`
Expected: FAIL — `Failed to resolve import "./uploader.js"`.

- [ ] **Step 3: 구현한다**

`packages/sdk/src/replay/uploader.ts`:

```ts
import type { RecordedEvent } from "./buffer.js";

type Fetcher = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status?: number }>;

/**
 * 재시도가 계속 실패할 때 대기열이 무한히 자라지 않게 하는 상한. 넘으면 가장
 * 오래된 쪽을 버린다 - 최근 구간이 문제에 더 가깝다.
 */
const MAX_PENDING_EVENTS = 20_000;

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class RecordingUploader {
  private pending: RecordedEvent[] = [];
  private seq = 0;
  private readonly compress: (bytes: Uint8Array) => Promise<Uint8Array>;
  private readonly fetcher: Fetcher;
  private readonly currentUrl: () => string;

  constructor(
    private readonly options: {
      endpoint: string;
      projectId: string;
      sdkVersion: string;
      compress?: (bytes: Uint8Array) => Promise<Uint8Array>;
      fetcher?: Fetcher;
      currentUrl?: () => string;
    },
  ) {
    this.compress = options.compress ?? gzip;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.currentUrl = options.currentUrl ?? (() => window.location.href);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(events: RecordedEvent[]): void {
    if (events.length === 0) return;
    this.pending.push(...events);
    if (this.pending.length > MAX_PENDING_EVENTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_EVENTS);
    }
  }

  async flush(options: { keepalive?: boolean } = {}): Promise<boolean> {
    if (this.pending.length === 0) return true;

    const events = this.pending;
    this.pending = [];

    const body = JSON.stringify({
      projectId: this.options.projectId,
      seq: this.seq,
      startedAt: startedAt(events[0]!),
      url: this.currentUrl(),
      sdkVersion: this.options.sdkVersion,
      events,
    });

    try {
      const compressed = await this.compress(new TextEncoder().encode(body));
      const response = await this.fetcher(this.options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: compressed as BodyInit,
        // keepalive 는 64 KiB 한도가 있다. 기록 청크는 그보다 크므로 평상시에
        // 쓰면 네트워크 오류로 거절되어 영원히 재시도한다. 페이지를 떠나는
        // 마지막 한 번만 쓴다 - 그때는 보내지 못하는 것보다 잘리는 쪽이 낫다.
        ...(options.keepalive ? { keepalive: true } : {}),
      });

      if (!response.ok) {
        this.requeue(events);
        return false;
      }

      this.seq += 1;
      return true;
    } catch {
      // 네트워크 실패가 고객 사이트 사용자 경험에 영향을 주지 않아야 한다.
      this.requeue(events);
      return false;
    }
  }

  private requeue(events: RecordedEvent[]): void {
    this.pending = events.concat(this.pending);
    if (this.pending.length > MAX_PENDING_EVENTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_EVENTS);
    }
  }
}

function startedAt(event: RecordedEvent): string {
  const at = new Date(event.timestamp);
  return Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- uploader`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add packages/sdk/src/replay/uploader.ts packages/sdk/src/replay/uploader.test.ts
git commit -m "리플레이: 기록 청크를 gzip 으로 압축해 올린다

대기열이 비어 있으면 아무것도 보내지 않는다 - 트리거 전 무전송이 이 기능의
가장 중요한 불변식이다.

평상시에는 keepalive 를 쓰지 않는다. 64 KiB 한도가 있어 기록 청크에 쓰면
네트워크 오류로 거절되고 영원히 재시도한다. 페이지를 떠나는 마지막 꼬리만
예외다."
```

---

### Task 13: 리플레이 엔트리 — rrweb 을 켠다

**Files:**
- Create: `packages/sdk/src/replay/index.ts`
- Create: `packages/sdk/src/replay/index.test.ts`
- Modify: `packages/sdk/package.json`

**Interfaces:**
- Consumes: Task 9·10·11·12 전부, `CHECKPOINT_INTERVAL_MS` (Task 1)
- Produces:
  ```ts
  export interface ReplayBootConfig {
    projectId: string;
    sessionId: string;
    endpoint: string;      // 기록 수집 엔드포인트(전체 URL)
    maskSelectors: string[];
  }
  export interface UploadSink {
    enqueue(events: RecordedEvent[]): void;
    flush(options?: { keepalive?: boolean }): Promise<boolean>;
  }
  export function startReplay(
    config: ReplayBootConfig,
    overrides?: { uploader?: UploadSink },
  ): () => void;
  // window.__traceReplay 가 있으면 모듈 로드 시 자동 시작한다
  ```
  - **세션당 트리거는 한 번만 걸린다.** 그 뒤로는 타이머로 이어 올리기만 한다. 스펙 §2 가 "구현 중 실측으로 정한다" 고 남긴 업로드 상한을 이렇게 정한다 — 분노 클릭이 반복돼도 업로드가 배로 늘지 않는다.

- [ ] **Step 1: rrweb 을 의존성에 더한다**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm install --workspace @trace/sdk rrweb@2.0.0-alpha.4
```

`packages/sdk/package.json` 의 `scripts` 를 바꾼다:

```json
    "build": "tsc -b --force tsconfig.json && npm run build:bundle && npm run build:replay",
    "build:bundle": "esbuild src/index.ts --bundle --format=iife --minify --platform=browser --outfile=dist/trace.js",
    "build:replay": "esbuild src/replay/index.ts --bundle --format=iife --minify --platform=browser --outfile=dist/trace-replay.js",
```

이 태스크에서는 `package-lock.json` 변경이 의도한 산출물이므로 함께 커밋한다.

- [ ] **Step 2: 테스트를 쓴다**

`packages/sdk/src/replay/index.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKPOINT_INTERVAL_MS } from "@trace/shared/recording-limits";

const record = vi.fn(() => () => {});
vi.mock("rrweb", () => ({ record: (...args: unknown[]) => record(...(args as [])) }));

const { startReplay: start } = await import("./index.js");

// startReplay 는 window 에 리스너를 단다. 테스트마다 정리하지 않으면 앞 테스트의
// 트리거가 뒤 테스트의 클릭에 같이 반응해 진단이 어려워진다.
const stops: Array<() => void> = [];
const startReplay: typeof start = (...args) => {
  const stop = start(...args);
  stops.push(stop);
  return stop;
};

describe("startReplay", () => {
  beforeEach(() => {
    record.mockClear();
  });

  afterEach(() => {
    while (stops.length > 0) stops.pop()!();
    document.body.innerHTML = "";
  });

  const config = {
    projectId: "proj_1",
    sessionId: "sess_1",
    endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
    maskSelectors: [".customer-name", "td.amount"],
  };

  it("운영자 셀렉터를 maskTextSelector 로 넘긴다", () => {
    startReplay(config);

    const options = record.mock.calls[0]![0] as { maskTextSelector?: string };
    expect(options.maskTextSelector).toBe(".customer-name,td.amount");
  });

  // 빈 문자열 셀렉터는 rrweb 안에서 querySelectorAll 을 던지게 만든다.
  it("셀렉터가 없으면 maskTextSelector 를 넘기지 않는다", () => {
    startReplay({ ...config, maskSelectors: [] });

    const options = record.mock.calls[0]![0] as { maskTextSelector?: string };
    expect(options.maskTextSelector).toBeUndefined();
  });

  it("비용이 큰 수집을 모두 끈다", () => {
    startReplay(config);

    expect(record.mock.calls[0]![0]).toMatchObject({
      maskAllInputs: true,
      inlineStylesheet: false,
      recordCanvas: false,
      collectFonts: false,
      inlineImages: false,
      checkoutEveryNms: CHECKPOINT_INTERVAL_MS,
    });
  });

  it("emit 이 data: URI 를 걷어낸다", () => {
    startReplay(config);
    const emit = (record.mock.calls[0]![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;

    const snapshot = {
      type: 2,
      timestamp: 1,
      data: { node: { tagName: "img", attributes: { src: "data:image/png;base64,AAAA" } } },
    };
    emit(snapshot, true);

    expect(snapshot.data.node.attributes.src).not.toContain("base64,AAAA");
  });

  // 스펙 §6 이 "가장 중요하다" 고 적은 항목이다. 업로더 단위 테스트는 대기열이
  // 비었을 때를 보고, 여기서는 엔트리가 트리거 전에 대기열을 채우지 않는지 본다.
  it("트리거 전에는 업로더에 아무것도 넣지 않는다", () => {
    const uploader = { enqueue: vi.fn(), flush: vi.fn(async () => true) };
    startReplay(config, { uploader });
    const emit = (record.mock.calls[0]![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;

    emit({ type: 2, timestamp: 1, data: {} }, true);
    emit({ type: 3, timestamp: 2, data: { source: 0 } });
    document.body.innerHTML = '<button id="a">A</button>';
    document.querySelector("#a")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(uploader.enqueue).not.toHaveBeenCalled();
    expect(uploader.flush).not.toHaveBeenCalled();
  });

  it("분노 클릭이 걸리면 버퍼를 비워 올린다", () => {
    const uploader = { enqueue: vi.fn(), flush: vi.fn(async () => true) };
    startReplay(config, { uploader });
    const emit = (record.mock.calls[0]![0] as { emit: (event: unknown, isCheckout?: boolean) => void }).emit;
    emit({ type: 2, timestamp: 1, data: {} }, true);

    document.body.innerHTML = '<button id="a">A</button>';
    const button = document.querySelector("#a")!;
    for (let index = 0; index < 3; index += 1) {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }

    expect(uploader.enqueue).toHaveBeenCalledTimes(1);
    expect(uploader.enqueue.mock.calls[0]![0]).toHaveLength(1);
    expect(uploader.flush).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- replay/index`
Expected: FAIL — `Failed to resolve import "./index.js"`.

- [ ] **Step 4: 구현한다**

`packages/sdk/src/replay/index.ts`:

```ts
import { CHECKPOINT_INTERVAL_MS } from "@trace/shared/recording-limits";
import { record } from "rrweb";
import { CheckpointBuffer, type RecordedEvent } from "./buffer.js";
import { maskText, stripDataUris } from "./mask.js";
import { installTriggers } from "./triggers.js";
import { RecordingUploader } from "./uploader.js";

const SDK_VERSION = "0.1.0";
const UPLOAD_INTERVAL_MS = 10_000;

// rrweb 의 이벤트 종류. 숫자를 그대로 쓰는 것은 enum 을 import 하면 번들에
// 런타임 객체가 하나 더 들어가기 때문이다.
const INCREMENTAL_SNAPSHOT = 3;
const MUTATION_SOURCE = 0;

export interface ReplayBootConfig {
  projectId: string;
  sessionId: string;
  endpoint: string;
  maskSelectors: string[];
}

export interface UploadSink {
  enqueue(events: RecordedEvent[]): void;
  flush(options?: { keepalive?: boolean }): Promise<boolean>;
}

export function startReplay(
  config: ReplayBootConfig,
  overrides: { uploader?: UploadSink } = {},
): () => void {
  const buffer = new CheckpointBuffer();
  // 주입 지점을 둔 이유는 "트리거 전에는 아무것도 전송되지 않는다" 를 단위
  // 테스트로 못박기 위해서다. 실제 실행에서는 언제나 아래 기본값이 쓰인다.
  const uploader: UploadSink =
    overrides.uploader ??
    new RecordingUploader({
      endpoint: config.endpoint,
      projectId: config.projectId,
      sdkVersion: SDK_VERSION,
    });

  let triggered = false;
  let uploadTimer: ReturnType<typeof setInterval> | undefined;

  const triggers = installTriggers(window, {
    onTrigger: () => {
      // 세션당 한 번만 걸린다. 분노 클릭이 반복돼도 업로드가 배로 늘지 않고,
      // 그 뒤로는 아래 타이머가 이어 올린다.
      if (triggered) return;
      triggered = true;
      // 트리거 뒤에는 계속 이어 올린다. 문제가 난 뒤에 무슨 일이 있었는지가
      // 종종 더 중요하다.
      buffer.stopDiscarding();
      uploader.enqueue(buffer.drain());
      void uploader.flush();
      uploadTimer = setInterval(() => {
        uploader.enqueue(buffer.drain());
        void uploader.flush();
      }, UPLOAD_INTERVAL_MS);
    },
  });

  const stopRecording = record({
    emit(event: unknown, isCheckout?: boolean) {
      const recorded = event as RecordedEvent;
      // 스냅샷이든 mutation 이든 같은 함수로 훑는다 - 페이지가 나중에 붙이는
      // 노드도 base64 를 싣고 온다.
      stripDataUris(recorded);
      buffer.push(recorded, isCheckout === true);

      const data = recorded.data as { source?: number } | undefined;
      if (recorded.type === INCREMENTAL_SNAPSHOT && data?.source === MUTATION_SOURCE) {
        triggers.notifyMutation();
      }
    },
    checkoutEveryNms: CHECKPOINT_INTERVAL_MS,
    maskAllInputs: true,
    maskTextFn: maskText,
    // 빈 문자열을 넘기면 rrweb 안에서 querySelectorAll 이 던진다.
    ...(config.maskSelectors.length > 0
      ? { maskTextSelector: config.maskSelectors.join(",") }
      : {}),
    inlineStylesheet: false,
    recordCanvas: false,
    collectFonts: false,
    inlineImages: false,
    slimDOMOptions: {
      script: true,
      comment: true,
      headFavicon: true,
      headWhitespace: true,
      headMetaSocial: true,
      headMetaRobots: true,
      headMetaHttpEquiv: true,
      headMetaVerification: true,
    },
  } as Parameters<typeof record>[0]);

  const onPageHide = () => {
    if (!triggered) return;
    uploader.enqueue(buffer.drain());
    // 페이지를 떠나는 마지막 한 번만 keepalive 다.
    void uploader.flush({ keepalive: true });
  };
  window.addEventListener("pagehide", onPageHide);

  return () => {
    stopRecording?.();
    triggers.dispose();
    window.removeEventListener("pagehide", onPageHide);
    if (uploadTimer !== undefined) clearInterval(uploadTimer);
  };
}

declare global {
  interface Window {
    __traceReplay?: ReplayBootConfig;
  }
}

if (typeof window !== "undefined" && window.__traceReplay) {
  startReplay(window.__traceReplay);
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk -- replay/index`
Expected: PASS.

- [ ] **Step 6: 리플레이 번들을 빌드하고 크기를 잰다**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build --workspace @trace/sdk \
  && gzip -c packages/sdk/dist/trace-replay.js | wc -c \
  && gzip -c packages/sdk/dist/trace.js | wc -c
```

Expected: 리플레이 번들은 gzip 45,000 B 근처(실측 `rrweb.min.js` 단독이 43,782 B). 기본 번들은 10,240 미만을 유지해야 한다 — **이 시점에는 아직 로더가 없으므로 4,854 B 근처여야 한다.** 리플레이 코드가 기본 번들로 새어 들어갔다는 뜻이므로, 커지면 멈추고 import 사슬을 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add packages/sdk/src/replay/index.ts packages/sdk/src/replay/index.test.ts \
        packages/sdk/package.json package-lock.json
git commit -m "리플레이: rrweb 을 켜고 버퍼·트리거·업로더를 배선한다

이미지와 CSS 인라인을 끈다. 실측으로 이미지 제외가 187배, CSS 링크가 12배를
줄여 초기 스냅샷이 5,622,285 B 에서 30,016 B 가 된다.

트리거는 한 번만 걸린다. 그 뒤로는 버퍼를 버리지 않고 계속 이어 올린다 -
문제가 난 뒤에 무슨 일이 있었는지가 종종 더 중요하다."
```

---

### Task 14: 로더 — 설치는 여전히 한 줄이다

**Files:**
- Create: `packages/sdk/src/replay-config.ts`
- Create: `packages/sdk/src/replay-loader.ts`
- Create: `packages/sdk/src/replay-loader.test.ts`
- Modify: `packages/sdk/src/replay/index.ts` (전역 선언을 옮긴다)
- Modify: `packages/sdk/src/client.ts` (`sessionId` 공개)
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/bundle-size.test.ts` (그대로 통과해야 한다)

**Interfaces:**
- Consumes: `GET /v1/projects/:projectId/config` (Task 4), `ReplayBootConfig` (Task 13)
- Produces:
  ```ts
  export function loadReplay(options: {
    projectId: string;
    sessionId: string;
    endpoint: string;
    fetcher?: (input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
    documentRef?: Document;
  }): Promise<boolean>;
  ```
  - `TraceClient.sessionId` 가 public readonly 가 된다

- [ ] **Step 1: 테스트를 쓴다**

`packages/sdk/src/replay-loader.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadReplay } from "./replay-loader.js";

const ENDPOINT = "https://trace.example.com/v1/events/batch";

function configResponse(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }));
}

function replayScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll("script[src]"));
}

describe("loadReplay", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    delete window.__traceReplay;
  });

  it("리플레이가 켜져 있으면 설정을 심고 스크립트를 붙인다", async () => {
    const fetcher = configResponse({ replay: true, maskSelectors: [".customer-name"] });

    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      fetcher,
    });

    expect(started).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("https://trace.example.com/v1/projects/proj_1/config");
    expect(window.__traceReplay).toEqual({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
      maskSelectors: [".customer-name"],
    });
    expect(replayScripts()[0]!.src).toBe("https://trace.example.com/trace-replay.js");
  });

  // 켜지 않은 프로젝트는 rrweb 44 KB 를 내려받을 이유가 없다.
  it("꺼져 있으면 리플레이 번들을 내려받지 않는다", async () => {
    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      fetcher: configResponse({ replay: false, maskSelectors: [] }),
    });

    expect(started).toBe(false);
    expect(replayScripts()).toHaveLength(0);
    expect(window.__traceReplay).toBeUndefined();
  });

  // 설정을 못 받았는데 기록을 시작하면 가려야 할 자리가 원문으로 담긴다.
  // 번들 자체를 내려받지 않으므로 구조적으로 시작될 수 없다.
  it("설정을 못 받으면 아무것도 시작하지 않는다", async () => {
    const started = await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      fetcher: configResponse({}, false),
    });

    expect(started).toBe(false);
    expect(replayScripts()).toHaveLength(0);
  });

  it("네트워크가 던져도 고객 사이트로 오류를 흘리지 않는다", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(
      loadReplay({ projectId: "proj_1", sessionId: "sess_1", endpoint: ENDPOINT, fetcher: fetcher as never }),
    ).resolves.toBe(false);
  });

  it("셀렉터가 배열이 아니면 빈 목록으로 둔다", async () => {
    await loadReplay({
      projectId: "proj_1",
      sessionId: "sess_1",
      endpoint: ENDPOINT,
      fetcher: configResponse({ replay: true, maskSelectors: "전부" }),
    });

    expect(window.__traceReplay?.maskSelectors).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test --workspace @trace/sdk -- replay-loader`
Expected: FAIL — `Failed to resolve import "./replay-loader.js"`.

- [ ] **Step 3: 전역 선언을 옮긴다**

`packages/sdk/src/replay-config.ts` 를 만든다. 타입과 전역 선언뿐이라 번들에 아무 것도 더하지 않는다:

```ts
export interface ReplayBootConfig {
  projectId: string;
  sessionId: string;
  /** 기록 수집 엔드포인트(전체 URL). */
  endpoint: string;
  maskSelectors: string[];
}

declare global {
  interface Window {
    __traceReplay?: ReplayBootConfig;
  }
}
```

`packages/sdk/src/replay/index.ts` 에서 `ReplayBootConfig` 인터페이스 정의와 `declare global` 블록을 지우고, 대신 맨 위에서 가져온다:

```ts
import type { ReplayBootConfig } from "../replay-config.js";
```

그리고 `export type { ReplayBootConfig };` 를 파일 끝에 둔다(기존 export 를 쓰는 곳이 깨지지 않게).

> 왜 옮기나: 로더는 **기본 번들**에 들어가는데 `replay/index.ts` 를 import 하면 rrweb 44 KB 가 통째로 딸려와 10,240 B 예산을 21배 넘긴다. 타입만 있는 파일을 따로 두면 값 import 없이 같은 타입을 쓴다.

- [ ] **Step 4: 로더를 만든다**

`packages/sdk/src/replay-loader.ts`:

```ts
import type { ReplayBootConfig } from "./replay-config.js";

interface ConfigResponse {
  ok: boolean;
  json: () => Promise<unknown>;
}

/**
 * 설정을 받아, 리플레이가 켜진 프로젝트에만 리플레이 번들을 주입한다.
 *
 * "설정이 도착하기 전에는 기록을 시작하지 않는다" 가 여기서 구조적으로
 * 보장된다 - 설정이 오기 전에는 번들 자체를 내려받지 않으므로 시작될 수가
 * 없다. 마스킹 셀렉터를 모르는 채로 기록하면 가려야 할 자리가 버퍼에 원문으로
 * 들어가고, 나중에 설정이 와도 이미 늦다.
 */
export async function loadReplay(options: {
  projectId: string;
  sessionId: string;
  endpoint: string;
  fetcher?: (input: string) => Promise<ConfigResponse>;
  documentRef?: Document;
}): Promise<boolean> {
  const doc = options.documentRef ?? document;
  const fetcher = options.fetcher ?? ((input: string) => fetch(input));

  let config: { replay?: unknown; maskSelectors?: unknown };
  try {
    const response = await fetcher(resolve(`/v1/projects/${options.projectId}/config`, options.endpoint));
    if (!response.ok) return false;
    config = (await response.json()) as typeof config;
  } catch {
    // 수집 서버가 죽어 있어도 고객 사이트는 멀쩡해야 한다.
    return false;
  }

  if (config?.replay !== true) return false;

  const boot: ReplayBootConfig = {
    projectId: options.projectId,
    sessionId: options.sessionId,
    endpoint: resolve(`/v1/sessions/${options.sessionId}/recording`, options.endpoint),
    maskSelectors: Array.isArray(config.maskSelectors) ? (config.maskSelectors as string[]) : [],
  };
  window.__traceReplay = boot;

  const script = doc.createElement("script");
  // trace.js 와 같은 출처다 - 고객 CSP 에 새로 추가할 항목이 없다.
  script.src = resolve("/trace-replay.js", options.endpoint);
  script.async = true;
  doc.head.appendChild(script);
  return true;
}

// endpoint 가 상대 경로로 떨어진 경우(install.ts 의 inferEndpoint 폴백)에는
// new URL 이 던진다. 그때는 같은 출처의 상대 경로를 그대로 쓴다.
function resolve(path: string, base: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}
```

- [ ] **Step 5: 세션 식별자를 공개하고 init 에 연결한다**

`packages/sdk/src/client.ts` 에서 한 단어만 고친다:

```ts
  readonly sessionId = `sess_${nanoid(10)}`;
```

(`private readonly sessionId` 였다. 로더가 기록 엔드포인트 경로를 만들려면 이 값이 필요하다.)

`packages/sdk/src/index.ts` 의 `init` 을 바꾼다:

```ts
import { loadReplay } from "./replay-loader.js";

export function init(options: { projectId: string; endpoint?: string; consent?: Consent }) {
  const endpoint = options.endpoint ?? "/v1/events/batch";
  client = new TraceClient({
    projectId: options.projectId,
    endpoint,
    consent: options.consent ?? "granted",
  });
  installCollectors(client);
  // 리플레이는 켜진 프로젝트에서만 켜진다. 실패해도 수집은 계속돼야 하므로
  // 기다리지 않고, loadReplay 는 절대 던지지 않는다.
  void loadReplay({ projectId: options.projectId, sessionId: client.sessionId, endpoint });
  return client;
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npm test --workspace @trace/sdk`
Expected: PASS (기존 `install.test.ts`·`client.test.ts` 포함).

- [ ] **Step 7: 기본 번들이 예산 안에 있는지 확인한다**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build --workspace @trace/sdk \
  && gzip -c packages/sdk/dist/trace.js | wc -c
```

Expected: 10,240 미만. 직전 기준 4,854 B 였으므로 로더를 더해도 5,500 B 근처여야 한다. **크게 늘었다면 rrweb 이 기본 번들로 새어 들어간 것이다** — `replay-loader.ts` 가 `./replay/index.js` 를 값으로 import 하고 있지 않은지 확인한다.

Run: `npm test --workspace @trace/sdk -- bundle-size`
Expected: PASS.

- [ ] **Step 8: 전체 테스트와 타입 검사**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add packages/sdk/src/replay-config.ts packages/sdk/src/replay-loader.ts \
        packages/sdk/src/replay-loader.test.ts packages/sdk/src/replay/index.ts \
        packages/sdk/src/client.ts packages/sdk/src/index.ts
git commit -m "설치: 스크립트 한 줄로 리플레이까지 켜지게 한다

trace.js 가 설정을 받아 켜진 프로젝트에만 trace-replay.js 를 주입한다.
설정이 오기 전에는 번들 자체를 내려받지 않으므로 '설정 전 기록 없음' 이
구조적으로 보장된다.

전역 선언을 replay-config.ts 로 뺀 이유: 로더가 replay/index.ts 를 값으로
import 하면 rrweb 44 KB 가 기본 번들에 딸려와 예산을 21배 넘긴다."
```

---

### Task 15: 실제 앱에서 확인하고 문서를 고친다

**Files:**
- Modify: `README.md`
- Test: 수동 확인(브라우저)

**Interfaces:**
- Consumes: Task 1~14 전부

- [ ] **Step 1: 서버와 관리자 화면을 띄운다**

Run: `npm run dev:api` (별도 터미널에서 `npm run dev:admin`)
Expected: API 가 4000, 관리자 화면이 5173 에서 뜬다.

- [ ] **Step 2: 프로젝트에 리플레이를 켠다**

관리자 화면의 프로젝트 설정에서 켜거나, 관리자 UI 가 아직 이 항목을 그리지 않으면 스토어를 직접 고친다:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx tsx -e '
import { SqliteStore } from "./apps/api/src/store/sqlite-store.js";
const store = new SqliteStore("./apps/api/trace.db");
const projectId = process.argv[1];
const project = await store.getProject(projectId);
await store.updateProject(projectId, {
  name: project.name,
  allowedDomains: project.allowedDomains,
  replay: { enabled: true, maskSelectors: [] },
});
console.log(JSON.stringify((await store.getProject(projectId)).replay));
store.close();
' <프로젝트 ID>
```

Expected: `{"enabled":true,"maskSelectors":[]}`

- [ ] **Step 3: 설정 엔드포인트를 확인한다**

Run: `curl -s http://localhost:4000/v1/projects/<프로젝트 ID>/config`
Expected: `{"replay":true,"maskSelectors":[]}`

- [ ] **Step 4: 대상 앱에 SDK 를 넣고 기록을 확인한다**

`localhost:3000` 의 앱 페이지에서 개발자 도구 콘솔에 스크립트 태그를 넣는다(**앱 소스는 고치지 않는다** — 이 페이지는 사용자의 것이다):

```js
const s = document.createElement("script");
s.src = "http://localhost:4000/trace.js";
s.dataset.projectId = "<프로젝트 ID>";
document.head.appendChild(s);
```

확인할 것:
1. 네트워크 탭에 `/v1/projects/<id>/config` → 200, 이어서 `/trace-replay.js` → 200 이 보인다.
2. **아무 데도 누르지 않은 상태에서 `/recording` 요청이 0건이다.** ← 가장 중요한 확인이다.
3. 같은 버튼을 빠르게 세 번 누르면 그때 `/recording` 이 202 로 나간다.

- [ ] **Step 5: 저장된 크기와 메모리를 잰다**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx tsx -e '
import { SqliteStore } from "./apps/api/src/store/sqlite-store.js";
const store = new SqliteStore("./apps/api/trace.db");
const chunks = await store.listSessionRecordingChunks(process.argv[1], process.argv[2]);
console.log(chunks.length, "청크", chunks.reduce((sum, c) => sum + c.bytes.length, 0), "바이트(gzip)");
store.close();
' <프로젝트 ID> <세션 ID>
```

Expected: 스펙의 10분 약 156 KB 와 같은 자릿수. 크게 다르면 숫자를 스펙에 반영한다.

브라우저 콘솔에서 버퍼 메모리를 확인한다:

```js
performance.memory && console.log(performance.memory.usedJSHeapSize);
```

Expected: 스펙 §2 의 표가 예상한 값(세대 두 개 = 약 816 KB)과 비교해 적는다. 다르면 **스펙의 표를 실측으로 고친다** — 스펙이 그렇게 하라고 적어 뒀다.

- [ ] **Step 6: 만든 테스트 데이터를 지운다**

Run:

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npx tsx -e '
import Database from "better-sqlite3";
const db = new Database("./apps/api/trace.db");
console.log(db.prepare("DELETE FROM session_recordings WHERE session_id = ?").run(process.argv[1]).changes, "청크 삭제");
db.close();
' <세션 ID>
```

Expected: 방금 만든 청크만 지워진다. 2026-09-04 기준선(이벤트 9건 / 이슈 3건)은 건드리지 않는다.

- [ ] **Step 7: README 를 고친다**

개인정보 표에 세션 리플레이 행을 더하고, 무엇보다 **서버가 재판정하지 않는다**는 사실을 적는다:

```markdown
| 세션 리플레이 | 트리거가 걸린 세션만. 입력값은 전부 마스킹(`maskAllInputs`), 화면 텍스트는 이메일·한국 휴대폰·9자리 이상 숫자를 치환. 운영자가 지정한 셀렉터는 통째로 마스킹 | 기본 7일 (`SESSION_RECORDING_RETENTION_DAYS`) |
```

그리고 표 아래에 남긴다:

> **리플레이 마스킹의 정본은 SDK 한 곳이다.** 다른 필드와 달리 서버가 다시 판정하지 않는다 — rrweb 이벤트 안의 텍스트가 가려졌는지 서버가 확인하려면 DOM 트리를 해석해야 하고, 그것은 서버에 rrweb 을 다시 구현하는 일이다. 패턴이 없는 개인정보(사람 이름 등)는 **운영자가 마스킹 셀렉터로 지정해야** 가려진다.

설치 안내에는 스크립트 태그가 그대로임을 밝힌다:

> 리플레이를 켜도 설치는 같은 한 줄이다. `trace.js` 가 프로젝트 설정을 받아 켜진 경우에만 `trace-replay.js` 를 스스로 불러온다. 둘 다 trace API 가 직접 서빙하므로 CSP 에 추가할 항목이 없다.

- [ ] **Step 8: 커밋**

```bash
git add README.md
git commit -m "문서: 세션 리플레이의 수집 범위와 마스킹 한계를 적는다

리플레이 마스킹의 정본이 SDK 한 곳이라는 사실을 숨기지 않는다. 다른 필드와
달리 서버가 재판정하지 않으며, 패턴 없는 개인정보는 운영자가 셀렉터로
지정해야 가려진다."
```

---

## 실행 뒤 남는 것

이 계획이 끝나도 **"리플레이가 된다" 고 말할 수 없다.** 스펙 §6 이 적은 대로, 다음은 하위 프로젝트 `B`(재생 UI)가 있어야 확인된다:

- 리플레이가 실제로 흐름으로 읽히는가 — 와이어프레임이 정확히 여기서 실패했다
- CSS 를 링크로 뒀을 때 관리자 화면에서 스타일이 붙는가
- 마스킹 후에도 흐름을 이해할 수 있는가

그 뒤에 `C`(와이어프레임 걷어내기)가 온다. **A+B 를 확인하기 전에는 `dom.ts` 의 힌트 수집을 지우지 않는다** — 먼저 지우면 되돌릴 곳이 없다.
