# Trace Self-hosted 설치 경험 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 낯선 사용자가 저장소를 clone해서 `npm install` 후 서버를 띄우고, 관리자 화면에서 프로젝트를 만들어 스크립트 한 줄을 자기 사이트에 붙이고, 첫 이벤트 도착을 화면에서 확인할 수 있게 만든다.

**Architecture:** 세 축을 순서대로 얹는다. `better-sqlite3` 기반 `SqliteStore`를 `TraceStore` 구현체로 추가해 기본 저장소로 승격한다. SDK를 esbuild IIFE 단일 번들로 만들고 API 서버가 `GET /trace.js`로 서빙해, 스크립트 `src` origin에서 수집 엔드포인트를 유추한다. Admin UI에 프로젝트 생성과 설치 안내 화면을 추가해 브라우저 콘솔 절차를 없앤다.

**Tech Stack:** TypeScript, Node 22, Fastify 5, `better-sqlite3`, esbuild, Zod, Vitest, React 18, Vite, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-self-hosted-install-design.md`

---

## 진행 상태

이어받는 사람이 이 절만 읽으면 현재 위치를 알 수 있게 유지한다. 태스크를 끝낼 때마다 갱신한다.

| 항목 | 값 |
| --- | --- |
| 브랜치 | `design/self-hosted-install` (base: `main`) |
| 완료 | Task 0 ~ Task 10 |
| 다음 | 최종 커밋/브랜치 마무리 |
| 최종 갱신 | 2026-08-26 |

검증 게이트 최근 실측값이다. 태스크마다 셋 다 통과해야 다음으로 넘어간다.

| 명령 | 상태 |
| --- | --- |
| `npm test` | 23 파일 166 건 통과 |
| `npm run typecheck` | 통과 |
| `npm run build` | 통과 |

### 실행 환경

- **Node 22 이상이 필수다.** Node 16 에서는 Vite 가 `crypto.getRandomValues` 오류로 기동하지 못해 `npm test` 가 시작조차 하지 못한다. 저장소에 `.nvmrc`(`22`)와 `engines`(`>=22.5.0`)가 있으므로 `nvm use` 로 맞춘다.
- nvm 은 전역 npm 패키지를 Node 버전별로 따로 둔다. 다른 버전에 설치해 둔 전역 CLI 는 이 저장소에서 보이지 않으므로 필요하면 Node 22 쪽에 다시 설치한다.

### 계획 작성 이후 확정한 사항

- **Task 0 을 Task 1 앞에 추가했다.** 계획 작성 시점에는 기준선이 초록이었으나 이후 날짜가 바뀌면서 `admin.test.ts` 4 건이 깨졌다. 아래 Task 0 절을 참고한다.
- **Task 1 Step 1(`.nvmrc`)은 Task 0 커밋에 포함됐다.** Task 1 은 Step 2 부터 수행했다.
- **Task 3 `SqliteStore`의 `totalEventsCount`는 `COUNT(*)`를 유지한다.** Global Constraints의 "집계는 SQL이 아니라 JS에서 한다"는 friction score, issue type distribution, top targets 같은 제품 집계 로직을 뜻한다. `totalEventsCount`는 온보딩 상태 확인용 단순 row count이고 Task 3 Step 5가 구체적으로 `COUNT`를 지시하므로 SQL count를 허용한다.
- **로컬 기동에는 `NODE_ENV=development` 가 필요하다.** `auth/config.ts` 의 `assertDeployableAdminAuthConfig` 가 `COOKIE_SECURE=false` 를 `NODE_ENV` 가 `development` 나 `test` 일 때만 허용한다. `tsx watch` 는 `NODE_ENV` 를 설정하지 않으므로 지정하지 않으면 기동이 거부된다. Task 7 Step 9 의 수동 확인 블록과 Task 10 의 README 초안에 이 변수가 빠져 있어 채웠다. 현재 `README.md` 에도 같은 누락이 있으나 Task 10 이 전체를 다시 쓰므로 그때 해소된다.
- **jsdom 의 `localStorage` 에는 인스턴스 스파이가 걸리지 않는다.** Proxy 라서 `vi.spyOn(window.localStorage, ...)` 이 `defineProperty` 트랩에 삼켜져 조용히 무시된다. 원래 코드는 아무것도 가로채지 못한 채 통과했다. Task 8 Step 1 의 테스트를 `Storage.prototype` 에 거는 방식으로 고쳤다.
- **`<label>` 이 힌트까지 감싸면 `getByLabelText` 로 조회할 수 없다.** 접근 가능한 이름에 힌트 문구가 이어붙기 때문이다. Task 9 의 허용 도메인 필드를 `htmlFor` 와 `aria-describedby` 로 나눴다.
- **최종 검증 체크리스트 12 항목 중 실제 Google 로그인이 필요한 항목은 수동으로 확인했다.** Google Cloud Console OAuth 클라이언트를 만들고 `http://localhost:4000/auth/google/callback` 을 redirect URI 로 등록해 실제 로그인, 프로젝트 생성, 데모 이벤트 수집을 확인했다.
- **로컬 `.env` 자동 로딩을 추가했다.** Task 10 진행 중 Google OAuth 값을 매번 명령 앞에 붙이는 마찰이 확인되어 루트 `.env` 와 `apps/api/.env` 를 서버 시작 시 읽게 했다. 터미널 환경변수는 파일 값보다 우선한다.
- **허용 도메인은 origin 으로 정규화한다.** Task 10 smoke 중 `http://localhost:5174/` 처럼 trailing slash 가 포함된 입력이 ingestion 의 `origin` 비교와 맞지 않아 403 이 나는 결함을 발견했다. `createProjectSchema` 에서 `new URL(value).origin` 으로 저장하도록 고쳤다.

---

## Task 0: 기준선 테스트 복구

> 계획 작성 이후 추가한 태스크다. 완료됐다.

**Files:**
- Modify: `apps/api/src/routes/admin.test.ts`

`admin.test.ts` 의 `signedInStore()` 가 세션을 `2026-08-25T00:00:00.000Z` 로 고정 발급하는데 `sessionTtlSeconds` 가 28800(8 시간)이고, 만료 판정은 라우트 핸들러가 실제 시계로 한다(`auth/session.ts` 의 `requireAdminSession`). `app.inject()` 경로에는 `now` 를 주입할 수 없으므로 그 날이 지나는 순간부터 4 건이 모두 401 을 받았다. 작성 당일에만 통과하는 테스트였다.

이후 모든 태스크가 `npm test` 통과를 완료 게이트로 쓰므로 기준선이 먼저 초록이어야 한다.

- [x] **Step 1: 시계 의존 제거**

세션을 실제 시각으로 발급하게 바꿨다. 프로덕션 경로인 `routes/auth.ts` 가 `now` 없이 호출하는 것과 같아진다. 단언은 하나도 바꾸지 않았다. 픽스처의 고정 날짜는 저장값일 뿐 시계와 비교되지 않으므로 그대로 뒀다.

- [x] **Step 2: 같은 결함이 더 있는지 확인**

`auth/session.test.ts` 도 날짜를 고정하지만 `createAdminSessionForUser` 와 `requireAdminSession` 양쪽에 `now` 를 넘겨 자기완결적이다. 이슈와 이벤트에 "최근 N 일" 같은 시간 창 필터가 없고, 시계와 비교하는 곳은 세션 만료·OAuth state 만료·레이트리밋 셋뿐이며 모두 `now` 주입이 되거나 자기 상대적이다. 추가 시한폭탄은 없다.

- [x] **Step 3: Commit**

커밋 `12b5ac6`. `.nvmrc` 를 함께 넣었다.

---

## Global Constraints

- 기본 언어는 한국어다. 프로젝트 논의, 스펙, 구현 요약, 커밋 메시지는 한국어로 작성한다. 코드 식별자, 명령어, 파일 경로, 패키지명, API 이름은 원문 언어를 유지한다.
- Trace는 self-hosted 제품이다. 사용자가 별도 데이터베이스, CDN, 정적 호스팅을 준비하지 않아야 한다.
- 성공 기준은 브라우저 개발자 도구 콘솔을 열거나 환경변수를 편집하지 않고 설치를 완료하는 것이다.
- SDK 번들은 gzip 10KB를 초과하면 테스트가 실패한다.
- SDK 번들에 zod를 포함하지 않는다. 런타임 값은 `@trace/shared/privacy`에서, 타입은 `@trace/shared`에서 `import type`으로 가져온다.
- 개인정보 마스킹(`redactUrl`, `redactMetadata`, `redactText`, `isSensitiveField`)은 SDK 번들에 유지한다. 서버 검증으로 대체하지 않는다.
- 네트워크 실패가 고객 사이트 사용자 경험에 영향을 주지 않아야 한다. SDK 전송 경로의 예외는 호출부로 전파하지 않는다.
- 사내 도메인, 서버 주소, 사내 제품명, 내부 URL 패턴을 코드, 설정, 테스트 픽스처, 문서에 커밋하지 않는다. 저장소를 나중에 public으로 전환하면 커밋 히스토리도 공개된다.
- 환경별 값은 런타임 환경변수로만 주입한다.
- 새로 추가하는 환경변수는 `TRACE_DB_PATH` 하나이며 기본값은 `./trace.db`다.
- 제거하는 환경변수는 `VITE_PROJECT_ID` 하나다.
- 기존 인증 관련 환경변수 14개는 변경하지 않는다.
- 모든 명령은 Node 22 이상에서 실행한다. Node 16에서는 Vite가 `crypto.getRandomValues` 오류로 기동하지 못한다.
- `MemoryStore`는 삭제하지 않고 테스트 전용으로 남긴다.
- 마이그레이션 버전 관리는 도입하지 않는다. `CREATE TABLE IF NOT EXISTS`로 충분하다.
- 집계는 SQL이 아니라 JS에서 한다.

---

## File Structure

### Create

- `.nvmrc`: 요구 Node 버전.
- `apps/api/src/db/schema.sqlite.ts`: SQLite 스키마 문자열 상수. `tsc`가 `.sql`을 `dist`로 복사하지 않으므로 TS 모듈로 둔다.
- `apps/api/src/store/sqlite-store.ts`: `better-sqlite3` 기반 `TraceStore` 구현체.
- `apps/api/src/store/dashboard-summary.ts`: 두 store 가 공유하는 대시보드 집계 함수.
- `apps/api/src/store/store-contract.test.ts`: `MemoryStore`와 `SqliteStore`에 같은 검증을 실행하는 공유 계약 테스트.
- `apps/api/src/routes/sdk-bundle.ts`: `GET /trace.js` 라우트.
- `apps/api/src/routes/sdk-bundle.test.ts`: 번들 서빙 테스트.
- `packages/sdk/src/install.ts`: `document.currentScript`의 `data-*` 속성 파싱과 자동 `init`.
- `packages/sdk/src/install.test.ts`: 속성 파싱과 엔드포인트 유추 테스트.
- `packages/sdk/src/transport.ts`: 주기 타이머, 큐 임계치, 화면 가려짐, 페이지 이탈 전송 트리거.
- `packages/sdk/src/transport.test.ts`: 자동 전송 트리거 테스트.
- `packages/sdk/src/bundle-size.test.ts`: 번들 gzip 크기 예산 테스트.
- `apps/admin/src/config.ts`: `API_BASE_URL` 단일 선언. 현재 `api.ts` 와 `App.tsx` 에 중복되어 있다.
- `apps/admin/src/storage.ts`: 선택한 프로젝트를 `localStorage` 에 기억한다.
- `apps/admin/src/storage.test.ts`: 저장 및 접근 실패 처리 테스트.
- `apps/admin/src/pages/CreateProjectPage.tsx`: 프로젝트 생성 폼.
- `apps/admin/src/pages/InstallPage.tsx`: 설치 스니펫과 첫 이벤트 대기 화면.

### Modify

- `package.json`: `engines` 필드 추가.
- `.gitignore`: SQLite 파일 무시 규칙 추가.
- `tsconfig.base.json`: `paths` 에 `@trace/shared/privacy` 추가.
- `packages/sdk/vitest.config.ts`: `alias` 에 `@trace/shared/privacy` 추가.
- `packages/shared/package.json`: `exports` 맵 추가로 `@trace/shared/privacy` 서브패스 노출.
- `packages/shared/src/events.ts:197-206`: `dashboardSummarySchema`에 `totalEventsCount` 추가.
- `apps/api/src/store/memory-store.ts`: `getDashboardSummary`에 `totalEventsCount` 채우기.
- `apps/api/src/store/admin-auth-store.test.ts`: 계약 테스트로 이관 후 삭제.
- `apps/api/src/server.ts`: `MemoryStore` 하드코딩을 `SqliteStore`로 교체.
- `apps/api/src/app.ts`: `registerSdkBundleRoutes` 등록.
- `apps/api/package.json`: `better-sqlite3` 의존성 추가.
- `packages/sdk/package.json`: esbuild 번들 빌드 스크립트 추가.
- `packages/sdk/src/client.ts`: `eventBatchSchema.parse` 제거, import 경계 정리, 전송 실패 격리.
- `packages/sdk/src/collectors.ts`: import 경계 정리, 전송 트리거 설치.
- `packages/sdk/src/dom.ts`: import 경계 정리.
- `packages/sdk/src/index.ts`: 자동 설치 진입점 연결, `consent` 기본값 변경.
- `apps/admin/src/api.ts`: `createProject` 추가, `VITE_PROJECT_ID` 제거.
- `apps/admin/src/App.tsx`: 온보딩 상태 추가, `localStorage` 프로젝트 선택, `VITE_PROJECT_ID` 제거.
- `apps/admin/src/App.test.tsx`: 온보딩 상태 테스트 추가, summary 픽스처에 `totalEventsCount` 추가.
- `apps/admin/src/pages/DashboardPage.tsx`: 헤더에 "설치 안내" 링크 추가.
- `apps/admin/src/styles.css`: 온보딩 화면 스타일.
- `examples/demo-site/index.html`: 소스 직접 import를 script 태그 방식으로 전환.
- `README.md`: 설치 절차 재작성.

---

## Interfaces

These interfaces are shared across tasks and must keep these exact names.

```ts
// apps/api/src/db/schema.sqlite.ts
export const SQLITE_SCHEMA: string;

// apps/api/src/store/sqlite-store.ts
export class SqliteStore implements TraceStore {
  readonly isDurable: true;
  constructor(filePath: string);
  close(): void;
}

// apps/api/src/routes/sdk-bundle.ts
export async function registerSdkBundleRoutes(
  app: FastifyInstance,
  options: { bundlePath?: string },
): Promise<void>;

// apps/api/src/store/dashboard-summary.ts
// Task 2 에서 buildDashboardSummary(issues) 로 만들고 Task 3 에서 인자를 하나 추가한다.
export function buildDashboardSummary(issues: Issue[], totalEventsCount: number): DashboardSummary;

// packages/sdk/src/install.ts
export type Consent = "granted" | "denied" | "pending";
export interface InstallOptions {
  projectId: string;
  endpoint: string;
  consent: Consent;
}
export function readInstallOptions(script: HTMLOrSVGScriptElement | null): InstallOptions | undefined;
export function autoInstall(
  script: HTMLOrSVGScriptElement | null,
  start: (options: InstallOptions) => unknown,
): void;

// packages/sdk/src/transport.ts
export function installTransport(
  client: TraceClient,
  options?: { intervalMs?: number; queueThreshold?: number },
): () => void;

// packages/sdk/src/client.ts — TraceClient 추가 멤버
// get queueLength(): number
// onEnqueue(listener: () => void): void

// packages/shared/src/events.ts — dashboardSummarySchema 추가 필드
// totalEventsCount: z.number().int().nonnegative()

// apps/admin/src/config.ts
export const API_BASE_URL: string;

// apps/admin/src/storage.ts
export function readSelectedProjectId(): string | undefined;
export function writeSelectedProjectId(projectId: string): void;

// apps/admin/src/api.ts
export async function createProject(
  input: { name: string; allowedDomains: string[] },
  csrfToken: string,
): Promise<{ projectId: string }>;
```

---

## Task 1: Node 버전 고정과 Store 계약 테스트 추출

**Files:**
- Create: `.nvmrc`
- Create: `apps/api/src/store/store-contract.test.ts`
- Modify: `package.json`
- Delete: `apps/api/src/store/admin-auth-store.test.ts`

**Interfaces:**
- Consumes: 없음. 첫 태스크다.
- Produces: `describeTraceStoreContract(name: string, createStore: () => TraceStore)` — 같은 파일 안의 로컬 함수로 두고, Task 2가 `SqliteStore`를 인자로 넘겨 재사용한다.

이 태스크는 기능을 바꾸지 않는다. 이후 모든 태스크의 검증이 안정적으로 돌게 만드는 준비 작업이다. 현재 셸 기본 Node가 v16이면 `npm test`가 시작조차 하지 못한다.

- [x] **Step 1: Node 버전 파일 추가** — Task 0 커밋(`12b5ac6`)에 포함됐다.

Create `.nvmrc`:

```
22
```

- [x] **Step 2: `engines` 필드 추가**

Modify `package.json` — `"private": true` 아래에 추가한다:

```json
  "engines": {
    "node": ">=22.5.0"
  },
```

- [x] **Step 3: 현재 테스트가 통과하는 것을 확인**

Run:

```bash
node -v
npm test
```

Expected: `node -v`가 `v22.x` 이상. 테스트 17개 파일 121개 통과.

`v16`이 나오면 Node 22로 전환한 뒤 다시 실행한다. `nvm`을 쓰면 `nvm use`가 `.nvmrc`를 읽는다.

- [x] **Step 4: 계약 테스트 파일 작성**

Create `apps/api/src/store/store-contract.test.ts`. 기존 `admin-auth-store.test.ts`의 6개 검증을 store 팩토리를 받는 함수로 감싼다. `assertDeployableTraceStore` 검증은 store마다 기대값이 다르므로 팩토리와 함께 `expectedDurable`을 받는다:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store.js";
import { assertDeployableTraceStore, type TraceStore } from "./types.js";

interface StoreUnderTest {
  store: TraceStore;
  dispose?: () => void;
}

function describeTraceStoreContract(
  name: string,
  createStore: () => StoreUnderTest,
  expectedDurable: boolean,
) {
  describe(`${name} TraceStore 계약`, () => {
    let current: StoreUnderTest | undefined;

    const open = () => {
      current = createStore();
      return current.store;
    };

    afterEach(() => {
      current?.dispose?.();
      current = undefined;
    });

    it("googleSub 기준으로 사용자를 upsert하고 마지막 로그인 정보를 갱신한다", async () => {
      const store = open();
      const first = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_1",
        email: "admin@example.com",
        emailVerified: true,
        name: "Admin",
        pictureUrl: "https://example.com/avatar.png",
        now: "2026-08-25T00:00:00.000Z",
      });
      const second = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_1",
        email: "admin@example.com",
        emailVerified: true,
        name: "Admin Two",
        now: "2026-08-25T01:00:00.000Z",
      });

      expect(second.adminUserId).toBe(first.adminUserId);
      expect(second.name).toBe("Admin Two");
      expect(second.lastLoginAt).toBe("2026-08-25T01:00:00.000Z");
    });

    it("정규화한 이메일이 중복되면 거부한다", async () => {
      const store = open();
      const first = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_1",
        email: "Admin@Example.com",
        emailVerified: true,
        now: "2026-08-25T00:00:00.000Z",
      });

      expect(first.email).toBe("admin@example.com");
      await expect(
        store.upsertAdminUserFromGoogle({
          googleSub: "google_sub_2",
          email: "ADMIN@example.com",
          emailVerified: true,
          now: "2026-08-25T01:00:00.000Z",
        }),
      ).rejects.toThrow("admin_email_conflict");
    });

    it("배포 가능 여부를 isDurable로 판정한다", () => {
      const store = open();

      expect(store.isDurable).toBe(expectedDurable);
      if (expectedDurable) {
        expect(() => assertDeployableTraceStore(store, { NODE_ENV: "production" })).not.toThrow();
      } else {
        expect(() => assertDeployableTraceStore(store, { NODE_ENV: "production" })).toThrow(
          "DURABLE_TRACE_STORE_REQUIRED",
        );
      }
      expect(() => assertDeployableTraceStore(store, { NODE_ENV: "development" })).not.toThrow();
    });

    it("세션을 저장하고 폐기하며 프로젝트 멤버십을 조회한다", async () => {
      const store = open();
      const user = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_1",
        email: "admin@example.com",
        emailVerified: true,
        now: "2026-08-25T00:00:00.000Z",
      });
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: user.adminUserId,
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      });
      await store.createAdminSession({
        sessionIdHash: "hash_1",
        adminUserId: user.adminUserId,
        createdAt: "2026-08-25T00:00:00.000Z",
        expiresAt: "2026-08-25T08:00:00.000Z",
        lastSeenAt: "2026-08-25T00:00:00.000Z",
      });

      expect(await store.getProjectMembership(project.projectId, user.adminUserId)).toMatchObject({
        role: "owner",
      });
      expect(await store.listProjectMembershipsForUser(user.adminUserId)).toHaveLength(1);
      await store.revokeAdminSession("hash_1", "2026-08-25T00:10:00.000Z");
      expect((await store.getAdminSession("hash_1"))?.revokedAt).toBe("2026-08-25T00:10:00.000Z");
    });

    it("세션 활동 시각을 갱신한다", async () => {
      const store = open();
      await store.createAdminSession({
        sessionIdHash: "hash_1",
        adminUserId: "admin_1",
        createdAt: "2026-08-25T00:00:00.000Z",
        expiresAt: "2026-08-25T08:00:00.000Z",
        lastSeenAt: "2026-08-25T00:00:00.000Z",
      });

      await store.touchAdminSession("hash_1", "2026-08-25T00:05:00.000Z");

      expect((await store.getAdminSession("hash_1"))?.lastSeenAt).toBe("2026-08-25T00:05:00.000Z");
    });

    it("감사 로그를 기록하고 조회한다", async () => {
      const store = open();

      await store.createAuditLog({
        adminUserId: "admin_1",
        action: "project.created",
        projectId: "proj_1",
        createdAt: "2026-08-25T00:00:00.000Z",
        metadata: { source: "test" },
      });

      const auditLogs = await store.listAuditLogs();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]).toMatchObject({
        adminUserId: "admin_1",
        action: "project.created",
        projectId: "proj_1",
        metadata: { source: "test" },
      });
      expect(auditLogs[0]?.auditLogId).toMatch(/^audit_[A-Za-z0-9_-]{10}$/);
    });

    it("이벤트를 저장하고 eventId 중복을 무시한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const event = {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-08-25T00:00:00.000Z",
        type: "click" as const,
        urlPath: "/settings",
        metadata: {},
      };

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-25T00:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [event],
      });
      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-25T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [event],
      });

      expect(await store.listEvents(project.projectId)).toHaveLength(1);
      expect(await store.getSessionTimeline(project.projectId, "sess_1")).toHaveLength(1);
    });
  });
}

describeTraceStoreContract("MemoryStore", () => ({ store: new MemoryStore() }), false);
```

- [x] **Step 5: 계약 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: PASS. 7개 테스트 통과.

기존 `admin-auth-store.test.ts`의 6개 검증이 모두 옮겨졌고, `saveBatch` 중복 무시 검증 1개가 추가되었다.

- [x] **Step 6: 이관 완료한 기존 테스트 삭제**

Run:

```bash
rm apps/api/src/store/admin-auth-store.test.ts
npm test
```

Expected: 17개 파일 122개 통과. 파일 수는 같고(삭제 1, 추가 1) 테스트 수가 1개 늘어난다.

- [x] **Step 7: Commit** — 커밋 `7a14ace`. `.nvmrc` 는 이미 커밋돼 있어 `git add` 대상에서 뺐다.

```bash
git add .nvmrc package.json apps/api/src/store/store-contract.test.ts
git add -u apps/api/src/store/admin-auth-store.test.ts
git commit -m "$(cat <<'MSG'
준비: Node 버전 고정과 store 계약 테스트 추출

요구 Node 버전을 .nvmrc 와 engines 로 명시한다. Node 16 에서는
Vite 가 crypto.getRandomValues 오류로 기동하지 못해 테스트를
실행할 수 없다.

admin-auth-store.test.ts 를 store 팩토리를 받는 계약 테스트로
바꾼다. 다음 단계에서 SqliteStore 를 같은 검증에 통과시켜 두
구현체가 동일하게 동작함을 보장한다.
MSG
)"
```

---

## Task 2: SqliteStore와 기본 저장소 승격

**Files:**
- Create: `apps/api/src/db/schema.sqlite.ts`
- Create: `apps/api/src/store/dashboard-summary.ts`
- Create: `apps/api/src/store/sqlite-store.ts`
- Modify: `apps/api/src/store/store-contract.test.ts`
- Modify: `apps/api/src/store/memory-store.ts:152-186`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `describeTraceStoreContract` (Task 1, 같은 테스트 파일 안의 로컬 함수)
- Produces: `export const SQLITE_SCHEMA: string`
- Produces: `export class SqliteStore implements TraceStore` — `constructor(filePath: string)`, `readonly isDurable = true`, `close(): void`
- Produces: `export function buildDashboardSummary(issues: Issue[]): DashboardSummary`

**중요 — 외래 키를 활성화하지 않는다.** SQLite는 `PRAGMA foreign_keys = ON` 없이는 `REFERENCES`를 강제하지 않는다. `MemoryStore`도 참조 무결성을 검사하지 않고, 계약 테스트가 존재하지 않는 `admin_1`로 세션과 감사 로그를 만든다. 두 구현체의 동작을 같게 유지하려면 SQLite 스키마에서 `REFERENCES` 절을 넣지 않고 pragma도 켜지 않는다.

- [x] **Step 1: 의존성 추가**

Run:

```bash
npm install better-sqlite3 --workspace @trace/api
npm install -D @types/better-sqlite3 --workspace @trace/api
```

- [x] **Step 2: 계약 테스트에 SqliteStore 추가**

Modify `apps/api/src/store/store-contract.test.ts` — 파일 맨 위 import에 추가:

```ts
import { SqliteStore } from "./sqlite-store.js";
```

파일 맨 아래 `describeTraceStoreContract("MemoryStore", ...)` 다음 줄에 추가:

```ts
describeTraceStoreContract(
  "SqliteStore",
  () => {
    const store = new SqliteStore(":memory:");
    return { store, dispose: () => store.close() };
  },
  true,
);
```

- [x] **Step 3: 테스트를 실행해 실패 확인**

Run:

```bash
npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: FAIL. `Failed to resolve import "./sqlite-store.js"`.

- [x] **Step 4: SQLite 스키마 작성**

Create `apps/api/src/db/schema.sqlite.ts`:

```ts
// SQLite 스키마. tsc 가 .sql 파일을 dist 로 복사하지 않으므로 문자열 상수로 둔다.
// REFERENCES 절을 넣지 않는다. MemoryStore 가 참조 무결성을 검사하지 않으므로
// 두 구현체의 동작을 같게 유지하려면 SQLite 도 강제하지 않아야 한다.
export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  allowed_domains TEXT NOT NULL,
  privacy_config TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  url_path TEXT NOT NULL,
  url_query_redacted TEXT,
  title_masked TEXT,
  element_selector_hash TEXT,
  element_role TEXT,
  element_text_masked_or_limited TEXT,
  x REAL,
  y REAL,
  viewport_x INTEGER,
  viewport_y INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS events_project_timestamp ON events (project_id, timestamp);
CREATE INDEX IF NOT EXISTS events_project_session ON events (project_id, session_id);

CREATE TABLE IF NOT EXISTS issues (
  issue_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  affected_sessions_count INTEGER NOT NULL,
  affected_users_count INTEGER NOT NULL,
  severity_score INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  trend TEXT NOT NULL,
  related_url_path TEXT,
  related_feature_id TEXT,
  example_session_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS issues_project_severity ON issues (project_id, severity_score DESC);

CREATE TABLE IF NOT EXISTS admin_users (
  admin_user_id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL,
  name TEXT,
  picture_url TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_memberships (
  project_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, admin_user_id)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id_hash TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent_hash TEXT,
  ip_hash TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_log_id TEXT PRIMARY KEY,
  admin_user_id TEXT,
  action TEXT NOT NULL,
  project_id TEXT,
  created_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
`;
```

- [x] **Step 5: 대시보드 집계를 공용 함수로 추출**

Create `apps/api/src/store/dashboard-summary.ts`. `memory-store.ts:152-186`의 집계 로직을 그대로 옮긴다. 두 store가 같은 함수를 쓰므로 집계 규칙이 갈라지지 않는다:

```ts
import type { DashboardSummary, Issue } from "@trace/shared";

export function buildDashboardSummary(issues: Issue[]): DashboardSummary {
  const activeIssues = issues.filter((issue) => issue.status === "new" || issue.status === "reviewing");
  const frictionScore =
    activeIssues.length === 0 ? 0 : Math.max(...activeIssues.map((issue) => issue.severityScore));

  return {
    frictionScore,
    affectedSessionsCount: activeIssues.reduce((sum, issue) => sum + issue.affectedSessionsCount, 0),
    newIssuesCount: issues.filter((issue) => issue.status === "new").length,
    resolvedOrIgnoredIssuesCount: issues.filter(
      (issue) => issue.status === "resolved" || issue.status === "ignored",
    ).length,
    insight: activeIssues[0]
      ? `${activeIssues[0].relatedUrlPath ?? "알 수 없는 화면"}에서 ${activeIssues[0].issueType} 문제가 가장 크게 나타났습니다.`
      : "아직 감지된 사용자 막힘이 없습니다.",
    trend: [{ date: new Date().toISOString().slice(0, 10), score: frictionScore }],
    issueTypeDistribution: Object.entries(
      activeIssues.reduce<Record<string, number>>((acc, issue) => {
        acc[issue.issueType] = (acc[issue.issueType] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([issueType, count]) => ({ issueType: issueType as never, count })),
    topTargets: activeIssues.slice(0, 5).map((issue) => ({
      label: issue.relatedUrlPath ?? issue.title,
      count: issue.affectedSessionsCount,
    })),
  };
}
```

- [x] **Step 6: MemoryStore가 공용 함수를 쓰도록 변경**

Modify `apps/api/src/store/memory-store.ts`. import에 추가:

```ts
import { buildDashboardSummary } from "./dashboard-summary.js";
```

`getDashboardSummary` 메서드 전체를 다음으로 교체한다:

```ts
  async getDashboardSummary(projectId: string): Promise<DashboardSummary> {
    return buildDashboardSummary(await this.listIssues(projectId));
  }
```

- [x] **Step 7: SqliteStore 구현**

Create `apps/api/src/store/sqlite-store.ts`:

```ts
import type { DashboardSummary, EventBatch, Issue, TraceEvent } from "@trace/shared";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { SQLITE_SCHEMA } from "../db/schema.sqlite.js";
import { buildDashboardSummary } from "./dashboard-summary.js";
import type {
  AddProjectMembershipInput,
  AdminRole,
  AdminSessionRecord,
  AdminUserRecord,
  AuditLogRecord,
  CreateAdminSessionInput,
  CreateAuditLogInput,
  CreateProjectInput,
  ProjectMembershipRecord,
  ProjectRecord,
  TraceStore,
  UpsertAdminUserFromGoogleInput,
} from "./types.js";

type Row = Record<string, unknown>;

// SQLite 는 없는 값을 null 로 돌려주지만 TraceStore 타입은 optional property 를 쓴다.
// null 인 키를 제거해 두 구현체의 반환 형태를 같게 맞춘다.
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as T;
}

export class SqliteStore implements TraceStore {
  readonly isDurable = true;
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    if (filePath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.exec(SQLITE_SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project: ProjectRecord = {
      projectId: `proj_${nanoid(10)}`,
      name: input.name,
      allowedDomains: input.allowedDomains,
      privacyConfig: { strictMasking: true, queryRedaction: true, inputCapture: false },
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO projects (project_id, name, allowed_domains, privacy_config, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        project.projectId,
        project.name,
        JSON.stringify(project.allowedDomains),
        JSON.stringify(project.privacyConfig),
        project.createdAt,
      );

    return project;
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM projects WHERE project_id = ?`).get(projectId) as Row | undefined;
    if (!row) return undefined;

    return {
      projectId: row.project_id as string,
      name: row.name as string,
      allowedDomains: JSON.parse(row.allowed_domains as string) as string[],
      privacyConfig: JSON.parse(row.privacy_config as string) as ProjectRecord["privacyConfig"],
      createdAt: row.created_at as string,
    };
  }

  async upsertAdminUserFromGoogle(input: UpsertAdminUserFromGoogleInput): Promise<AdminUserRecord> {
    const email = input.email.toLowerCase();
    const byEmail = this.db.prepare(`SELECT google_sub FROM admin_users WHERE email = ?`).get(email) as
      | Row
      | undefined;
    if (byEmail && byEmail.google_sub !== input.googleSub) throw new Error("admin_email_conflict");

    const existing = this.db.prepare(`SELECT * FROM admin_users WHERE google_sub = ?`).get(input.googleSub) as
      | Row
      | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE admin_users
              SET email = ?, email_verified = ?, name = COALESCE(?, name),
                  picture_url = COALESCE(?, picture_url), last_login_at = ?
            WHERE google_sub = ?`,
        )
        .run(
          email,
          input.emailVerified ? 1 : 0,
          input.name ?? null,
          input.pictureUrl ?? null,
          input.now,
          input.googleSub,
        );

      return (await this.getAdminUser(existing.admin_user_id as string))!;
    }

    const adminUserId = `admin_${nanoid(10)}`;
    this.db
      .prepare(
        `INSERT INTO admin_users
           (admin_user_id, google_sub, email, email_verified, name, picture_url, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        adminUserId,
        input.googleSub,
        email,
        input.emailVerified ? 1 : 0,
        input.name ?? null,
        input.pictureUrl ?? null,
        input.now,
        input.now,
      );

    return (await this.getAdminUser(adminUserId))!;
  }

  async getAdminUser(adminUserId: string): Promise<AdminUserRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM admin_users WHERE admin_user_id = ?`).get(adminUserId) as
      | Row
      | undefined;
    if (!row) return undefined;

    return compact({
      adminUserId: row.admin_user_id as string,
      googleSub: row.google_sub as string,
      email: row.email as string,
      emailVerified: row.email_verified === 1,
      name: row.name as string | null,
      pictureUrl: row.picture_url as string | null,
      createdAt: row.created_at as string,
      lastLoginAt: row.last_login_at as string,
    }) as AdminUserRecord;
  }

  async createAdminSession(input: CreateAdminSessionInput): Promise<AdminSessionRecord> {
    this.db
      .prepare(
        `INSERT INTO admin_sessions
           (session_id_hash, admin_user_id, created_at, expires_at, last_seen_at, revoked_at, user_agent_hash, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionIdHash,
        input.adminUserId,
        input.createdAt,
        input.expiresAt,
        input.lastSeenAt,
        input.revokedAt ?? null,
        input.userAgentHash ?? null,
        input.ipHash ?? null,
      );

    return input;
  }

  async getAdminSession(sessionIdHash: string): Promise<AdminSessionRecord | undefined> {
    const row = this.db.prepare(`SELECT * FROM admin_sessions WHERE session_id_hash = ?`).get(sessionIdHash) as
      | Row
      | undefined;
    if (!row) return undefined;

    return compact({
      sessionIdHash: row.session_id_hash as string,
      adminUserId: row.admin_user_id as string,
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string,
      lastSeenAt: row.last_seen_at as string,
      revokedAt: row.revoked_at as string | null,
      userAgentHash: row.user_agent_hash as string | null,
      ipHash: row.ip_hash as string | null,
    }) as AdminSessionRecord;
  }

  async revokeAdminSession(sessionIdHash: string, revokedAt: string): Promise<void> {
    this.db
      .prepare(`UPDATE admin_sessions SET revoked_at = ? WHERE session_id_hash = ?`)
      .run(revokedAt, sessionIdHash);
  }

  async touchAdminSession(sessionIdHash: string, lastSeenAt: string): Promise<void> {
    this.db
      .prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE session_id_hash = ?`)
      .run(lastSeenAt, sessionIdHash);
  }

  async addProjectMembership(input: AddProjectMembershipInput): Promise<ProjectMembershipRecord> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO project_memberships (project_id, admin_user_id, role, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.projectId, input.adminUserId, input.role, input.createdAt);

    return input;
  }

  async getProjectMembership(
    projectId: string,
    adminUserId: string,
  ): Promise<ProjectMembershipRecord | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM project_memberships WHERE project_id = ? AND admin_user_id = ?`)
      .get(projectId, adminUserId) as Row | undefined;

    return row ? this.toMembership(row) : undefined;
  }

  async listProjectMembershipsForUser(adminUserId: string): Promise<ProjectMembershipRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM project_memberships WHERE admin_user_id = ?`)
      .all(adminUserId) as Row[];

    return rows.map((row) => this.toMembership(row));
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audit_logs (audit_log_id, admin_user_id, action, project_id, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `audit_${nanoid(10)}`,
        input.adminUserId ?? null,
        input.action,
        input.projectId ?? null,
        input.createdAt,
        JSON.stringify(input.metadata ?? {}),
      );
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    const rows = this.db.prepare(`SELECT * FROM audit_logs ORDER BY created_at`).all() as Row[];

    return rows.map((row) =>
      compact({
        auditLogId: row.audit_log_id as string,
        adminUserId: row.admin_user_id as string | null,
        action: row.action as string,
        projectId: row.project_id as string | null,
        createdAt: row.created_at as string,
        metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
      }) as AuditLogRecord,
    );
  }

  async saveBatch(batch: EventBatch): Promise<void> {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO events
         (event_id, project_id, session_id, page_id, timestamp, type, url_path, url_query_redacted,
          title_masked, element_selector_hash, element_role, element_text_masked_or_limited,
          x, y, viewport_x, viewport_y, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertAll = this.db.transaction((events: TraceEvent[]) => {
      for (const event of events) {
        insert.run(
          event.eventId,
          batch.projectId,
          event.sessionId,
          event.pageId,
          event.timestamp,
          event.type,
          event.urlPath,
          event.urlQueryRedacted ?? null,
          event.titleMasked ?? null,
          event.elementSelectorHash ?? null,
          event.elementRole ?? null,
          event.elementTextMaskedOrLimited ?? null,
          event.x ?? null,
          event.y ?? null,
          event.viewportX ?? null,
          event.viewportY ?? null,
          JSON.stringify(event.metadata ?? {}),
        );
      }
    });

    insertAll(batch.events);
  }

  async listEvents(projectId: string): Promise<TraceEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE project_id = ? ORDER BY timestamp`)
      .all(projectId) as Row[];

    return rows.map((row) => this.toEvent(row));
  }

  async upsertIssues(projectId: string, issues: Issue[]): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT OR REPLACE INTO issues
         (issue_id, project_id, issue_type, title, summary, affected_sessions_count, affected_users_count,
          severity_score, first_seen_at, last_seen_at, trend, related_url_path, related_feature_id,
          example_session_ids, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const upsertAll = this.db.transaction((records: Issue[]) => {
      for (const issue of records) {
        if (issue.projectId !== projectId) continue;
        upsert.run(
          issue.issueId,
          issue.projectId,
          issue.issueType,
          issue.title,
          issue.summary,
          issue.affectedSessionsCount,
          issue.affectedUsersCount,
          issue.severityScore,
          issue.firstSeenAt,
          issue.lastSeenAt,
          issue.trend,
          issue.relatedUrlPath ?? null,
          issue.relatedFeatureId ?? null,
          JSON.stringify(issue.exampleSessionIds ?? []),
          issue.status,
        );
      }
    });

    upsertAll(issues);
  }

  async listIssues(projectId: string): Promise<Issue[]> {
    const rows = this.db
      .prepare(`SELECT * FROM issues WHERE project_id = ? ORDER BY severity_score DESC`)
      .all(projectId) as Row[];

    return rows.map((row) => this.toIssue(row));
  }

  async getIssue(issueId: string): Promise<Issue | undefined> {
    const row = this.db.prepare(`SELECT * FROM issues WHERE issue_id = ?`).get(issueId) as Row | undefined;

    return row ? this.toIssue(row) : undefined;
  }

  async getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE project_id = ? AND session_id = ? ORDER BY timestamp`)
      .all(projectId, sessionId) as Row[];

    return rows.map((row) => this.toEvent(row));
  }

  async getDashboardSummary(projectId: string): Promise<DashboardSummary> {
    return buildDashboardSummary(await this.listIssues(projectId));
  }

  private toMembership(row: Row): ProjectMembershipRecord {
    return {
      projectId: row.project_id as string,
      adminUserId: row.admin_user_id as string,
      role: row.role as AdminRole,
      createdAt: row.created_at as string,
    };
  }

  private toEvent(row: Row): TraceEvent {
    return compact({
      eventId: row.event_id as string,
      sessionId: row.session_id as string,
      pageId: row.page_id as string,
      timestamp: row.timestamp as string,
      type: row.type as TraceEvent["type"],
      urlPath: row.url_path as string,
      urlQueryRedacted: row.url_query_redacted as string | null,
      titleMasked: row.title_masked as string | null,
      elementSelectorHash: row.element_selector_hash as string | null,
      elementRole: row.element_role as string | null,
      elementTextMaskedOrLimited: row.element_text_masked_or_limited as string | null,
      x: row.x as number | null,
      y: row.y as number | null,
      viewportX: row.viewport_x as number | null,
      viewportY: row.viewport_y as number | null,
      metadata: JSON.parse(row.metadata as string) as TraceEvent["metadata"],
    }) as TraceEvent;
  }

  private toIssue(row: Row): Issue {
    return compact({
      issueId: row.issue_id as string,
      projectId: row.project_id as string,
      issueType: row.issue_type as Issue["issueType"],
      title: row.title as string,
      summary: row.summary as string,
      affectedSessionsCount: row.affected_sessions_count as number,
      affectedUsersCount: row.affected_users_count as number,
      severityScore: row.severity_score as number,
      firstSeenAt: row.first_seen_at as string,
      lastSeenAt: row.last_seen_at as string,
      trend: row.trend as Issue["trend"],
      relatedUrlPath: row.related_url_path as string | null,
      relatedFeatureId: row.related_feature_id as string | null,
      exampleSessionIds: JSON.parse(row.example_session_ids as string) as string[],
      status: row.status as Issue["status"],
    }) as Issue;
  }
}
```

- [x] **Step 8: 계약 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: PASS. 14개 테스트 통과 (`MemoryStore` 7개 + `SqliteStore` 7개).

실패하면 `compact()`가 제거하는 null 키와 optional property 기대값을 먼저 확인한다.

- [x] **Step 9: 서버가 SqliteStore를 기본으로 쓰도록 변경**

Modify `apps/api/src/server.ts` 전체를 다음으로 교체한다:

```ts
import { createApp } from "./app.js";
import { createGoogleOAuthClient } from "./auth/google.js";
import { SqliteStore } from "./store/sqlite-store.js";
import { prepareServerStartup } from "./startup.js";

const port = Number(process.env.PORT ?? 4000);
const store = new SqliteStore(process.env.TRACE_DB_PATH ?? "./trace.db");
const authConfig = prepareServerStartup({ store, env: process.env });

const app = createApp({
  store,
  ...(authConfig ? { authConfig, googleOAuthClient: createGoogleOAuthClient(authConfig) } : {}),
});

await app.listen({ port, host: "0.0.0.0" });
```

- [x] **Step 10: SQLite 파일을 git에서 제외**

Modify `.gitignore` — 파일 끝에 추가한다:

```
trace.db
*.db-wal
*.db-shm
```

- [x] **Step 11: 전체 검증**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 전부 통과. 테스트는 17개 파일 129개.

- [x] **Step 12: Commit**

```bash
git add apps/api/src/db/schema.sqlite.ts apps/api/src/store/sqlite-store.ts \
        apps/api/src/store/dashboard-summary.ts apps/api/src/store/store-contract.test.ts \
        apps/api/src/store/memory-store.ts apps/api/src/server.ts \
        apps/api/package.json package.json package-lock.json .gitignore
git commit -m "$(cat <<'MSG'
저장소: SQLite durable store 를 기본값으로 승격

better-sqlite3 기반 SqliteStore 를 추가하고 server.ts 가 이를
기본 저장소로 쓰게 한다. TRACE_DB_PATH 로 경로를 지정하고
기본값은 ./trace.db 다. 사용자가 아무 설정을 하지 않아도 데이터가
재시작 후 남는다.

계약 테스트를 두 구현체에 같이 실행해 동작이 갈라지지 않게 한다.
대시보드 집계는 buildDashboardSummary 로 추출해 공유한다.

외래 키는 활성화하지 않는다. MemoryStore 가 참조 무결성을 검사하지
않으므로 두 구현체의 동작을 같게 유지해야 한다.
MSG
)"
```

---

## Task 3: 이벤트 총 개수를 대시보드 요약에 추가

**Files:**
- Modify: `packages/shared/src/events.ts:197-206`
- Modify: `apps/api/src/store/dashboard-summary.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Modify: `apps/api/src/store/store-contract.test.ts`
- Modify: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes: `buildDashboardSummary(issues: Issue[]): DashboardSummary` (Task 2)
- Produces: `buildDashboardSummary(issues: Issue[], totalEventsCount: number): DashboardSummary` — 두 번째 인자가 추가된다
- Produces: `DashboardSummary["totalEventsCount"]: number`

온보딩의 첫 이벤트 도착 확인이 이 값에 의존한다. `DashboardSummary`가 issue 기반이라 이벤트가 정상적으로 들어와도 감지 조건을 만족하는 문제가 없으면 모든 수치가 0이고, 설치 성공과 실패가 화면에서 구분되지 않는다.

- [x] **Step 1: 실패하는 계약 테스트 추가**

Modify `apps/api/src/store/store-contract.test.ts` — `describeTraceStoreContract` 안의 마지막 `it` 블록 뒤에 추가한다:

```ts
    it("대시보드 요약에 이벤트 총 개수를 담는다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      expect((await store.getDashboardSummary(project.projectId)).totalEventsCount).toBe(0);

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-25T00:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-25T00:00:00.000Z",
            type: "page_view",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      });

      expect((await store.getDashboardSummary(project.projectId)).totalEventsCount).toBe(1);
    });
```

- [x] **Step 2: 테스트를 실행해 실패 확인**

Run:

```bash
npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: FAIL. `expected undefined to be 0`.

- [x] **Step 3: shared 스키마에 필드 추가**

Modify `packages/shared/src/events.ts` — `dashboardSummarySchema`의 `resolvedOrIgnoredIssuesCount` 줄 다음에 추가한다:

```ts
  totalEventsCount: z.number().int().nonnegative(),
```

- [x] **Step 4: 집계 함수가 값을 받도록 변경**

Modify `apps/api/src/store/dashboard-summary.ts` — 시그니처와 반환 객체를 수정한다:

```ts
export function buildDashboardSummary(issues: Issue[], totalEventsCount: number): DashboardSummary {
```

반환 객체의 `frictionScore` 줄 앞에 추가한다:

```ts
    totalEventsCount,
```

- [x] **Step 5: 두 store가 이벤트 개수를 넘기도록 변경**

Modify `apps/api/src/store/memory-store.ts` — `getDashboardSummary`를 수정한다:

```ts
  async getDashboardSummary(projectId: string): Promise<DashboardSummary> {
    const [issues, events] = await Promise.all([this.listIssues(projectId), this.listEvents(projectId)]);
    return buildDashboardSummary(issues, events.length);
  }
```

Modify `apps/api/src/store/sqlite-store.ts` — `getDashboardSummary`를 수정한다. 개수만 필요하므로 전체 행을 읽지 않고 `COUNT`로 센다:

```ts
  async getDashboardSummary(projectId: string): Promise<DashboardSummary> {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM events WHERE project_id = ?`)
      .get(projectId) as { total: number };

    return buildDashboardSummary(await this.listIssues(projectId), row.total);
  }
```

- [x] **Step 6: 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: PASS. 16개 테스트 통과.

- [x] **Step 7: Admin UI 테스트 픽스처 갱신**

Modify `apps/admin/src/App.test.tsx` — `beforeEach`의 `api.getDashboardData.mockResolvedValue` 안 `summary` 객체에서 `resolvedOrIgnoredIssuesCount: 6,` 다음 줄에 추가한다:

```ts
      totalEventsCount: 128,
```

- [x] **Step 8: 전체 검증**

Run:

```bash
npm test
npm run typecheck
```

Expected: 전부 통과. `typecheck`가 실패하면 `DashboardSummary` 리터럴을 만드는 다른 지점이 남아 있다는 뜻이므로, 오류가 가리키는 파일에 `totalEventsCount`를 추가한다.

- [x] **Step 9: Commit**

```bash
git add packages/shared/src/events.ts apps/api/src/store apps/admin/src/App.test.tsx
git commit -m "$(cat <<'MSG'
대시보드: 이벤트 총 개수를 요약에 추가

DashboardSummary 가 issue 기반이라 이벤트가 정상적으로 수집되어도
감지된 문제가 없으면 모든 수치가 0 이었다. 설치 성공과 실패를
구분할 수 없어 온보딩에서 첫 이벤트 도착을 확인할 방법이 없다.

totalEventsCount 를 추가하고 두 store 가 같은 값을 채운다.
SqliteStore 는 전체 행을 읽지 않고 COUNT 로 센다.
MSG
)"
```

---

## Task 4: SDK import 경계 정리와 번들 크기 예산

**Files:**
- Create: `packages/sdk/src/bundle-size.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `packages/sdk/vitest.config.ts`
- Modify: `packages/shared/package.json`
- Modify: `packages/sdk/package.json`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/collectors.ts`
- Modify: `packages/sdk/src/dom.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `@trace/shared/privacy` 서브패스 — `redactUrl`, `redactMetadata`, `redactText`, `isSensitiveField`, `normalizePath`, `isSafeTraceIdentifier`, `isSafeElementSelectorHash`, `isSafeElementRole`를 zod 없이 제공한다

번들의 84%가 zod다. `client.ts`가 전송 직전에 `eventBatchSchema.parse()`를 호출하는데, 서버가 `ingestion.ts:50`의 `rawEventBatchSchema.parse(request.body)`로 이미 검증하므로 중복이다.

측정값:

| 상태 | minified | gzip |
| --- | --- | --- |
| 현재 | 70,450 B | 17,867 B |
| zod 제거 | 6,060 B | 2,645 B |

**모듈 해석 경로가 세 곳이다.** 이 저장소는 `@trace/shared`를 `dist`가 아니라 소스로 해석한다. 새 서브패스가 동작하려면 세 곳을 모두 고쳐야 한다.

| 경로 | 파일 | 쓰는 도구 |
| --- | --- | --- |
| tsconfig `paths` | `tsconfig.base.json` | `tsc`, esbuild |
| vitest `alias` | `packages/sdk/vitest.config.ts` | Vitest |
| package `exports` | `packages/shared/package.json` | Node 런타임 |

- [x] **Step 1: 번들러를 SDK 개발 의존성으로 선언**

Run:

```bash
npm install -D esbuild --workspace @trace/sdk
```

루트에 이미 esbuild가 있지만 SDK 테스트가 직접 쓰므로 명시적으로 선언한다.

- [x] **Step 2: 실패하는 번들 크기 테스트 작성**

Create `packages/sdk/src/bundle-size.test.ts`:

```ts
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GZIP_BUDGET_BYTES = 10 * 1024;

describe("SDK 번들 크기", () => {
  it("gzip 10KB 예산 안에 들어간다", async () => {
    const entryPoint = fileURLToPath(new URL("./index.ts", import.meta.url));
    const result = await build({
      entryPoints: [entryPoint],
      bundle: true,
      format: "iife",
      minify: true,
      write: false,
      platform: "browser",
    });

    const output = result.outputFiles[0];
    expect(output).toBeDefined();

    const gzipBytes = gzipSync(output!.contents).byteLength;
    expect(gzipBytes).toBeLessThan(GZIP_BUDGET_BYTES);
  });
});
```

- [x] **Step 3: 테스트를 실행해 실패 확인**

Run:

```bash
npm run test --workspace @trace/sdk -- src/bundle-size.test.ts
```

Expected: FAIL. `expected 17867 to be less than 10240` 근처의 값이 나온다. 정확한 숫자는 zod 버전에 따라 다를 수 있다.

- [x] **Step 4: tsconfig paths에 서브패스 추가**

Modify `tsconfig.base.json` — `paths`를 다음으로 교체한다:

```json
    "paths": {
      "@trace/shared": ["packages/shared/src/index.ts"],
      "@trace/shared/privacy": ["packages/shared/src/privacy.ts"],
      "@trace/sdk": ["packages/sdk/src/index.ts"]
    }
```

- [x] **Step 5: vitest alias에 서브패스 추가**

Modify `packages/sdk/vitest.config.ts` 전체를 다음으로 교체한다. **`@trace/shared/privacy`를 먼저 둔다.** Vite alias는 앞에서부터 부분 일치로 치환하므로 `@trace/shared`가 먼저 오면 서브패스가 잘못 치환된다:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@trace/shared/privacy",
        replacement: new URL("../shared/src/privacy.ts", import.meta.url).pathname,
      },
      {
        find: "@trace/shared",
        replacement: new URL("../shared/src/index.ts", import.meta.url).pathname,
      },
    ],
  },
  test: {
    environment: "jsdom",
  },
});
```

- [x] **Step 6: package exports 추가**

Modify `packages/shared/package.json` — `"types"` 줄 다음에 추가한다:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./privacy": {
      "types": "./dist/privacy.d.ts",
      "default": "./dist/privacy.js"
    }
  },
```

`main`과 `types`는 지우지 않는다. 구형 해석기가 참조한다.

- [x] **Step 7: client.ts에서 zod 제거**

Modify `packages/sdk/src/client.ts` — 첫 두 줄의 import를 다음으로 교체한다:

```ts
import { redactMetadata, redactUrl } from "@trace/shared/privacy";
import type { EventBatch, TraceEvent } from "@trace/shared";
```

`flush()` 안의 batch 생성부를 다음으로 교체한다. `eventBatchSchema.parse()` 호출만 제거하고 객체 구조는 그대로 둔다:

```ts
    const batch: EventBatch = {
      projectId: this.projectId,
      anonymousUserId: this.anonymousUserId,
      sessionId: this.sessionId,
      sentAt: new Date().toISOString(),
      sdkVersion: "0.1.0",
      url: `${redactedUrl.origin}${redactedUrl.urlPath}${redactedUrl.urlQueryRedacted}`,
      events,
    };
```

- [x] **Step 8: collectors.ts와 dom.ts의 import 경계 정리**

Modify `packages/sdk/src/collectors.ts` — `redactUrl` import를 교체한다:

```ts
import { redactUrl } from "@trace/shared/privacy";
```

Modify `packages/sdk/src/dom.ts` — 첫 줄 import를 교체한다:

```ts
import { isSensitiveField, redactText } from "@trace/shared/privacy";
```

- [x] **Step 9: 번들 크기 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/sdk -- src/bundle-size.test.ts
```

Expected: PASS. gzip 3KB 미만.

- [x] **Step 10: 기존 SDK 테스트가 그대로 통과하는지 확인**

Run:

```bash
npm run test --workspace @trace/sdk
```

Expected: PASS. `client.test.ts` 3개, `dom.test.ts` 2개, `bundle-size.test.ts` 1개.

`client.test.ts`의 세 테스트는 zod 검증에 의존하지 않고 전송된 payload 내용만 확인하므로 수정이 필요 없다.

- [x] **Step 11: 전체 검증**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 전부 통과.

- [x] **Step 12: Commit**

```bash
git add tsconfig.base.json packages/shared/package.json packages/sdk/package.json \
        packages/sdk/vitest.config.ts packages/sdk/src package-lock.json
git commit -m "$(cat <<'MSG'
SDK: zod 를 번들에서 제거하고 크기 예산을 도입

번들의 84% 가 zod 였다. client.ts 가 전송 직전에 eventBatchSchema
로 검증했는데 서버가 ingestion 라우트에서 이미 같은 검증을 한다.
고객 사이트 브라우저에서 48KB 검증기를 돌려 얻는 것이 없다.

런타임 값은 @trace/shared/privacy 서브패스에서, 타입은
@trace/shared 에서 import type 으로 가져온다. privacy.ts 는 zod 를
쓰지 않으므로 트리 셰이킹에 의존하지 않고 경계로 보장한다.

gzip 17,867 B 에서 2,645 B 로 줄었다. gzip 10KB 를 넘으면 실패하는
테스트로 회귀를 막는다.
MSG
)"
```

---

## Task 5: SDK 자동 전송

**Files:**
- Create: `packages/sdk/src/transport.ts`
- Create: `packages/sdk/src/transport.test.ts`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/collectors.ts`

**Interfaces:**
- Consumes: `TraceClient` (기존)
- Produces: `TraceClient.queueLength: number` — getter
- Produces: `TraceClient.onEnqueue(listener: () => void): void`
- Produces: `installTransport(client: TraceClient, options?: { intervalMs?: number; queueThreshold?: number }): () => void` — 반환값은 teardown 함수다

**현재 SDK는 이벤트를 서버로 전송하지 않는다.** `flush()`가 프로덕션 코드에서 호출되지 않고 `client.test.ts`에서만 호출된다. 타이머, `visibilitychange`, `pagehide` 핸들러가 없다. 번들만 만들어도 "붙였는데 아무 일도 안 일어나는" 상태가 된다.

- [x] **Step 1: 실패하는 전송 테스트 작성**

Create `packages/sdk/src/transport.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceClient } from "./client.js";
import { installTransport } from "./transport.js";

function createClient(fetcher: ReturnType<typeof vi.fn>) {
  return new TraceClient({
    projectId: "proj_1",
    endpoint: "https://trace.example.com/v1/events/batch",
    fetcher,
    consent: "granted",
  });
}

function enqueueOne(client: TraceClient, eventId: string) {
  client.enqueue(
    client.createEvent({
      eventId,
      type: "click",
      urlPath: "/settings",
      metadata: {},
    }),
  );
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("installTransport", () => {
  let teardown: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    vi.useRealTimers();
  });

  it("주기 타이머가 큐를 전송한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000 });

    enqueueOne(client, "evt_1");
    expect(fetcher).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.queueLength).toBe(0);
  });

  it("큐가 비어 있으면 타이머가 전송하지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000 });

    await vi.advanceTimersByTimeAsync(15000);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("큐 임계치에 도달하면 즉시 전송한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000, queueThreshold: 3 });

    enqueueOne(client, "evt_1");
    enqueueOne(client, "evt_2");
    expect(fetcher).not.toHaveBeenCalled();

    enqueueOne(client, "evt_3");
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("화면이 가려지면 전송한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000 });

    enqueueOne(client, "evt_1");
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("페이지를 떠날 때 전송한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    teardown = installTransport(client, { intervalMs: 5000 });

    enqueueOne(client, "evt_1");
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("teardown 이후에는 전송하지 않는다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createClient(fetcher);
    const stop = installTransport(client, { intervalMs: 5000 });

    enqueueOne(client, "evt_1");
    stop();
    await vi.advanceTimersByTimeAsync(15000);
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("TraceClient 전송 실패 격리", () => {
  it("네트워크 예외를 호출부로 전파하지 않고 큐를 복원한다", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));
    const client = createClient(fetcher);

    enqueueOne(client, "evt_1");
    await expect(client.flush()).resolves.toBeUndefined();
    expect(client.queueLength).toBe(1);
  });

  it("응답이 실패면 큐를 복원한다", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    const client = createClient(fetcher);

    enqueueOne(client, "evt_1");
    await client.flush();

    expect(client.queueLength).toBe(1);
  });
});
```

- [x] **Step 2: 테스트를 실행해 실패 확인**

Run:

```bash
npm run test --workspace @trace/sdk -- src/transport.test.ts
```

Expected: FAIL. `Failed to resolve import "./transport.js"`.

- [x] **Step 3: TraceClient에 큐 관측 수단과 실패 격리 추가**

Modify `packages/sdk/src/client.ts`.

클래스 필드 `private queue: TraceEvent[] = [];` 다음 줄에 추가한다:

```ts
  private enqueueListeners: Array<() => void> = [];

  get queueLength(): number {
    return this.queue.length;
  }

  onEnqueue(listener: () => void): void {
    this.enqueueListeners.push(listener);
  }
```

`enqueue` 메서드를 다음으로 교체한다:

```ts
  enqueue(event: TraceEvent) {
    if (this.consent !== "granted") return;
    this.queue.push(event);
    for (const listener of this.enqueueListeners) listener();
  }
```

`flush` 메서드의 전송부(`const response = await this.fetcher(...)` 부터 메서드 끝까지)를 다음으로 교체한다:

```ts
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
        keepalive: true,
      });

      if (!response.ok) this.queue.unshift(...batch.events);
    } catch {
      // 네트워크 실패가 고객 사이트 사용자 경험에 영향을 주지 않아야 한다.
      this.queue.unshift(...batch.events);
    }
```

- [x] **Step 4: transport 구현**

Create `packages/sdk/src/transport.ts`:

```ts
import type { TraceClient } from "./client.js";

export interface TransportOptions {
  intervalMs?: number;
  queueThreshold?: number;
}

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_QUEUE_THRESHOLD = 20;

export function installTransport(client: TraceClient, options: TransportOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const queueThreshold = options.queueThreshold ?? DEFAULT_QUEUE_THRESHOLD;
  let stopped = false;

  const send = () => {
    if (stopped || client.queueLength === 0) return;
    void client.flush();
  };

  const timer = setInterval(send, intervalMs);

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") send();
  };
  const onPageHide = () => send();
  const onEnqueue = () => {
    if (client.queueLength >= queueThreshold) send();
  };

  client.onEnqueue(onEnqueue);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
  };
}
```

`onEnqueue` 리스너는 제거하지 않는다. `stopped` 플래그가 `send`를 무력화하므로 teardown 후 전송이 발생하지 않는다.

- [x] **Step 5: collectors가 transport를 설치하도록 변경**

Modify `packages/sdk/src/collectors.ts` — import에 추가한다:

```ts
import { installTransport } from "./transport.js";
```

`installCollectors` 함수의 마지막 `window.addEventListener("error", ...)` 블록 다음, 함수가 닫히기 전에 추가한다:

```ts
  installTransport(client);
```

- [x] **Step 6: 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/sdk
```

Expected: PASS. `transport.test.ts` 8개 포함 전체 통과.

`client.test.ts`의 "sends collector events with sanitized dynamic URL paths" 테스트가 `installCollectors`를 호출하므로 이제 타이머가 함께 설치된다. 그 테스트는 `flush()`를 직접 호출하고 fake timer를 쓰지 않으므로 영향받지 않는다.

- [x] **Step 7: 전체 검증**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 전부 통과.

- [x] **Step 8: Commit**

```bash
git add packages/sdk/src
git commit -m "$(cat <<'MSG'
SDK: 자동 전송을 구현

flush() 가 프로덕션 코드에서 호출되지 않아 수집한 이벤트가 큐에만
쌓이고 서버로 전송되지 않았다. 데모 사이트를 띄워도 이벤트가
도착하지 않는 상태였다.

전송 트리거 네 개를 설치한다. 주기 타이머 5 초, 큐 길이 20, 화면
가려짐, 페이지 이탈이다. fetch 의 keepalive 가 이미 있어 이탈
시점 전송에 적합하다.

전송 실패를 격리한다. 네트워크 예외를 호출부로 전파하지 않고
큐를 복원한다. 고객 사이트 사용자 경험에 영향을 주지 않아야 한다.
MSG
)"
```

---

## Task 6: SDK 설치 인터페이스와 consent 기본값

**Files:**
- Create: `packages/sdk/src/install.ts`
- Create: `packages/sdk/src/install.test.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/client.ts`

**Interfaces:**
- Consumes: `init(options)` (기존 `index.ts`)
- Produces: `export interface InstallOptions { projectId: string; endpoint: string; consent: "granted" | "denied" | "pending" }`
- Produces: `export function readInstallOptions(script: HTMLOrSVGScriptElement | null): InstallOptions | undefined`
- Produces: `export function autoInstall(script: HTMLOrSVGScriptElement | null, start: (options: InstallOptions) => unknown): void`

`autoInstall`이 `init`을 인자로 받는 이유는 순환 import를 피하기 위함이다. `index.ts`가 `install.ts`를 가져오므로 `install.ts`가 `index.ts`를 가져올 수 없다.

| 속성 | 필수 | 기본값 |
| --- | --- | --- |
| `data-project-id` | 필수 | 없음. 없으면 아무것도 하지 않고 콘솔 경고 1회 |
| `data-endpoint` | 선택 | 스크립트 `src`의 origin + `/v1/events/batch` |
| `data-consent` | 선택 | `granted` |

- [x] **Step 1: 실패하는 설치 테스트 작성**

Create `packages/sdk/src/install.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { autoInstall, readInstallOptions } from "./install.js";

function createScript(attributes: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  return script;
}

describe("readInstallOptions", () => {
  it("스크립트 src origin 에서 수집 엔드포인트를 유추한다", () => {
    const script = createScript({
      src: "https://trace.example.com/trace.js",
      "data-project-id": "proj_abc",
    });

    expect(readInstallOptions(script)).toEqual({
      projectId: "proj_abc",
      endpoint: "https://trace.example.com/v1/events/batch",
      consent: "granted",
    });
  });

  it("경로가 있는 src 에서도 origin 기준으로 엔드포인트를 만든다", () => {
    const script = createScript({
      src: "https://trace.example.com/static/js/trace.js",
      "data-project-id": "proj_abc",
    });

    expect(readInstallOptions(script)?.endpoint).toBe("https://trace.example.com/v1/events/batch");
  });

  it("data-endpoint 가 있으면 유추값을 덮어쓴다", () => {
    const script = createScript({
      src: "https://cdn.example.com/trace.js",
      "data-project-id": "proj_abc",
      "data-endpoint": "https://collector.example.com/v1/events/batch",
    });

    expect(readInstallOptions(script)?.endpoint).toBe("https://collector.example.com/v1/events/batch");
  });

  it("data-consent 로 수집을 보류할 수 있다", () => {
    const script = createScript({
      src: "https://trace.example.com/trace.js",
      "data-project-id": "proj_abc",
      "data-consent": "pending",
    });

    expect(readInstallOptions(script)?.consent).toBe("pending");
  });

  it("알 수 없는 data-consent 값은 granted 로 처리한다", () => {
    const script = createScript({
      src: "https://trace.example.com/trace.js",
      "data-project-id": "proj_abc",
      "data-consent": "maybe",
    });

    expect(readInstallOptions(script)?.consent).toBe("granted");
  });

  it("data-project-id 가 없으면 undefined 를 반환한다", () => {
    const script = createScript({ src: "https://trace.example.com/trace.js" });

    expect(readInstallOptions(script)).toBeUndefined();
  });

  it("script 요소가 없으면 undefined 를 반환한다", () => {
    expect(readInstallOptions(null)).toBeUndefined();
  });
});

describe("autoInstall", () => {
  it("옵션이 유효하면 start 를 호출한다", () => {
    const start = vi.fn();
    const script = createScript({
      src: "https://trace.example.com/trace.js",
      "data-project-id": "proj_abc",
    });

    autoInstall(script, start);

    expect(start).toHaveBeenCalledWith({
      projectId: "proj_abc",
      endpoint: "https://trace.example.com/v1/events/batch",
      consent: "granted",
    });
  });

  it("data-project-id 가 없으면 start 를 부르지 않고 경고를 남긴다", () => {
    const start = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const script = createScript({ src: "https://trace.example.com/trace.js" });

    autoInstall(script, start);

    expect(start).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("script 요소가 없으면 경고 없이 아무것도 하지 않는다", () => {
    const start = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    autoInstall(null, start);

    expect(start).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [x] **Step 2: 테스트를 실행해 실패 확인**

Run:

```bash
npm run test --workspace @trace/sdk -- src/install.test.ts
```

Expected: FAIL. `Failed to resolve import "./install.js"`.

- [x] **Step 3: install 구현**

Create `packages/sdk/src/install.ts`:

```ts
export type Consent = "granted" | "denied" | "pending";

export interface InstallOptions {
  projectId: string;
  endpoint: string;
  consent: Consent;
}

const EVENTS_PATH = "/v1/events/batch";

export function readInstallOptions(script: HTMLOrSVGScriptElement | null): InstallOptions | undefined {
  if (!script) return undefined;

  const projectId = script.dataset.projectId;
  if (!projectId) return undefined;

  const src = script instanceof HTMLScriptElement ? script.src : "";

  return {
    projectId,
    endpoint: script.dataset.endpoint ?? inferEndpoint(src),
    consent: normalizeConsent(script.dataset.consent),
  };
}

export function autoInstall(
  script: HTMLOrSVGScriptElement | null,
  start: (options: InstallOptions) => unknown,
): void {
  if (!script) return;

  const options = readInstallOptions(script);
  if (!options) {
    console.warn("[trace] data-project-id 가 없어 수집을 시작하지 않습니다.");
    return;
  }

  start(options);
}

function inferEndpoint(src: string): string {
  try {
    return new URL(EVENTS_PATH, src).toString();
  } catch {
    return EVENTS_PATH;
  }
}

function normalizeConsent(value: string | undefined): Consent {
  return value === "denied" || value === "pending" ? value : "granted";
}
```

- [x] **Step 4: 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/sdk -- src/install.test.ts
```

Expected: PASS. 10개 통과.

- [x] **Step 5: index.ts에서 자동 설치를 연결하고 consent 기본값 변경**

Modify `packages/sdk/src/index.ts` 전체를 다음으로 교체한다:

```ts
import { TraceClient } from "./client.js";
import { installCollectors } from "./collectors.js";
import { autoInstall, type Consent, type InstallOptions } from "./install.js";

let client: TraceClient | undefined;

export function init(options: { projectId: string; endpoint?: string; consent?: Consent }) {
  client = new TraceClient({
    projectId: options.projectId,
    endpoint: options.endpoint ?? "/v1/events/batch",
    consent: options.consent ?? "granted",
  });
  installCollectors(client);
  return client;
}

export function track(name: string, metadata?: Record<string, unknown>) {
  client?.track(name, metadata);
}

export const consent = {
  grant() {
    client?.grantConsent();
  },
  deny() {
    client?.denyConsent();
  },
};

declare global {
  interface Window {
    trace?: { init: typeof init; track: typeof track; consent: typeof consent };
  }
}

if (typeof window !== "undefined") {
  window.trace = { init, track, consent };

  if (typeof document !== "undefined") {
    autoInstall(document.currentScript, (options: InstallOptions) => init(options));
  }
}

export { TraceClient };
export type { Consent, InstallOptions };
```

- [x] **Step 6: TraceClient의 consent 기본값도 맞춘다**

Modify `packages/sdk/src/client.ts` — 두 곳을 수정한다. 기본값이 두 군데서 달라지면 안 된다.

`type Consent = "granted" | "denied" | "pending";` 선언을 제거하고 대신 import한다:

```ts
import type { Consent } from "./install.js";
```

constructor 안의 다음 줄을 교체한다:

```ts
    this.consent = options.consent ?? "granted";
```

`TraceClientOptions`의 `consent?: Consent;`는 그대로 둔다.

- [x] **Step 7: SDK 테스트 전체 실행**

Run:

```bash
npm run test --workspace @trace/sdk
```

Expected: PASS. `client.test.ts` 3개, `dom.test.ts` 2개, `transport.test.ts` 8개, `install.test.ts` 10개, `bundle-size.test.ts` 1개.

`client.test.ts`의 세 테스트는 모두 `consent`를 명시적으로 넘기므로 기본값 변경에 영향받지 않는다.

- [x] **Step 8: 번들 크기가 예산 안에 있는지 재확인**

Run:

```bash
npm run test --workspace @trace/sdk -- src/bundle-size.test.ts
```

Expected: PASS. `install.ts`와 `transport.ts`가 늘었지만 두 파일 모두 작아 여유가 크다.

- [x] **Step 9: 전체 검증**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 전부 통과.

- [x] **Step 10: Commit**

```bash
git add packages/sdk/src
git commit -m "$(cat <<'MSG'
SDK: script 태그 한 줄 설치를 지원

document.currentScript 의 data-* 속성을 읽어 자동으로 init 한다.
수집 엔드포인트는 스크립트 src 의 origin 에서 유추하므로 사용자가
서버 주소를 두 번 적을 필요가 없다. data-endpoint 로 덮어쓸 수
있다.

기존 기본 엔드포인트가 상대경로여서 남의 사이트에 붙으면 그
사이트로 요청이 가는 결함도 함께 해소한다.

consent 기본값을 granted 로 바꾼다. pending 이 기본이면 스크립트만
붙였을 때 enqueue 가 모든 이벤트를 버려 아무 일도 일어나지 않는다.
동의 관리가 필요하면 data-consent="pending" 으로 보류한다.
MSG
)"
```

---

## Task 7: 번들 빌드, API 서버 서빙, 데모 사이트 전환

**Files:**
- Create: `apps/api/src/routes/sdk-bundle.ts`
- Create: `apps/api/src/routes/sdk-bundle.test.ts`
- Modify: `packages/sdk/package.json`
- Modify: `apps/api/src/app.ts`
- Modify: `examples/demo-site/index.html`

**Interfaces:**
- Consumes: `autoInstall`, `readInstallOptions` (Task 6)
- Produces: `export async function registerSdkBundleRoutes(app: FastifyInstance, options: { bundlePath?: string }): Promise<void>`
- Produces: `packages/sdk/dist/trace.js` — esbuild IIFE 번들
- Produces: `GET /trace.js` — self-hosted 사용자가 붙이는 스크립트

self-hosted 모델에서 이미 실행 중인 API 서버가 번들을 서빙하면 사용자가 CDN이나 정적 호스팅을 준비할 필요가 없다. 그리고 스크립트 `src` origin이 곧 수집 엔드포인트 origin이 되므로 Task 6의 엔드포인트 유추가 항상 옳게 동작한다.

CORS는 현재 설정으로 이미 통과한다. `app.ts`의 delegator가 `/auth/`와 `/admin/api/`만 origin을 제한하고 나머지는 `origin: true`다.

- [x] **Step 1: SDK 번들 빌드 스크립트 추가**

Modify `packages/sdk/package.json` — `scripts`를 다음으로 교체한다:

```json
  "scripts": {
    "build": "tsc -b --force tsconfig.json && npm run build:bundle",
    "build:bundle": "esbuild src/index.ts --bundle --format=iife --minify --platform=browser --outfile=dist/trace.js",
    "test": "vitest run"
  },
```

- [x] **Step 2: 번들이 생성되는지 확인**

Run:

```bash
npm run build --workspace @trace/sdk
ls -l packages/sdk/dist/trace.js
gzip -c packages/sdk/dist/trace.js | wc -c
```

Expected: `dist/trace.js`가 생성되고 gzip 크기가 10,240 미만이다.

- [x] **Step 3: 실패하는 번들 서빙 테스트 작성**

Create `apps/api/src/routes/sdk-bundle.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerSdkBundleRoutes } from "./sdk-bundle.js";

async function createBundleFile(contents: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "trace-bundle-"));
  const bundlePath = path.join(directory, "trace.js");
  await writeFile(bundlePath, contents, "utf8");
  return bundlePath;
}

describe("GET /trace.js", () => {
  it("번들을 JavaScript content type 으로 내려준다", async () => {
    const bundlePath = await createBundleFile("window.trace={};");
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, { bundlePath });

    const response = await app.inject({ method: "GET", url: "/trace.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/javascript");
    expect(response.body).toBe("window.trace={};");
    await app.close();
  });

  it("캐시 수명을 짧게 설정한다", async () => {
    const bundlePath = await createBundleFile("window.trace={};");
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, { bundlePath });

    const response = await app.inject({ method: "GET", url: "/trace.js" });

    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    await app.close();
  });

  it("번들이 없으면 404 와 빌드 안내 코드를 반환한다", async () => {
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, {
      bundlePath: path.join(tmpdir(), "trace-missing", "trace.js"),
    });

    const response = await app.inject({ method: "GET", url: "/trace.js" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "sdk_bundle_not_built" });
    await app.close();
  });
});
```

- [x] **Step 4: 테스트를 실행해 실패 확인**

Run:

```bash
npm run test --workspace @trace/api -- src/routes/sdk-bundle.test.ts
```

Expected: FAIL. `Failed to resolve import "./sdk-bundle.js"`.

- [x] **Step 5: 번들 서빙 라우트 구현**

Create `apps/api/src/routes/sdk-bundle.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

// src/routes 와 dist/routes 의 깊이가 같으므로 하나의 상대 경로가 개발과 빌드 양쪽에서 동작한다.
const DEFAULT_BUNDLE_PATH = fileURLToPath(
  new URL("../../../../packages/sdk/dist/trace.js", import.meta.url),
);

export async function registerSdkBundleRoutes(
  app: FastifyInstance,
  options: { bundlePath?: string },
): Promise<void> {
  const bundlePath = options.bundlePath ?? DEFAULT_BUNDLE_PATH;

  app.get("/trace.js", async (_request, reply) => {
    let contents: Buffer;

    try {
      contents = await readFile(bundlePath);
    } catch {
      return reply.code(404).send({ error: "sdk_bundle_not_built" });
    }

    return reply
      .header("content-type", "application/javascript; charset=utf-8")
      .header("cache-control", "public, max-age=300")
      .send(contents);
  });
}
```

- [x] **Step 6: 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/api -- src/routes/sdk-bundle.test.ts
```

Expected: PASS. 3개 통과.

- [x] **Step 7: 라우트를 앱에 등록**

Modify `apps/api/src/app.ts` — import에 추가한다:

```ts
import { registerSdkBundleRoutes } from "./routes/sdk-bundle.js";
```

`app.register(registerIngestionRoutes, { store: options.store });` 다음 줄에 추가한다:

```ts
  app.register(registerSdkBundleRoutes, {});
```

- [x] **Step 8: 데모 사이트를 script 태그 방식으로 전환**

Modify `examples/demo-site/index.html` — `<script type="module">` 블록 전체를 다음으로 교체한다:

```html
    <script>
      // query string 에서 projectId 를 읽어야 하므로 정적 script 태그로는 속성을 채울 수 없다.
      // 동적으로 삽입한 classic script 도 실행 중에는 document.currentScript 가
      // 자기 요소를 가리키므로 data-* 파싱 경로가 동일하게 동작한다.
      const projectId = new URLSearchParams(window.location.search).get("projectId") ?? "proj_demo";
      const script = document.createElement("script");
      script.src = "http://localhost:4000/trace.js";
      script.dataset.projectId = projectId;
      document.head.appendChild(script);
    </script>
```

`window.trace?.track('report_export_clicked')`를 쓰는 버튼은 그대로 둔다. `index.ts`가 `window.trace`를 계속 설정한다.

- [x] **Step 9: 수동 확인**

터미널 두 개를 쓴다.

```bash
# 터미널 1
npm run build --workspace @trace/shared
npm run build --workspace @trace/sdk
NODE_ENV=development \
GOOGLE_CLIENT_ID=dummy \
GOOGLE_CLIENT_SECRET=dummy \
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback \
SESSION_SECRET=0123456789abcdef0123456789abcdef \
ADMIN_APP_ORIGIN=http://localhost:5173 \
ADMIN_ALLOWED_EMAILS=admin@example.com \
COOKIE_SECURE=false \
npm run dev:api
```

```bash
# 터미널 2
curl -sI http://localhost:4000/trace.js | head -5
```

Expected: `200`과 `content-type: application/javascript; charset=utf-8`.

- [x] **Step 10: 전체 검증**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 전부 통과.

- [x] **Step 11: Commit**

```bash
git add packages/sdk/package.json apps/api/src/routes/sdk-bundle.ts \
        apps/api/src/routes/sdk-bundle.test.ts apps/api/src/app.ts \
        examples/demo-site/index.html
git commit -m "$(cat <<'MSG'
SDK: API 서버가 설치용 번들을 서빙

esbuild IIFE 번들을 dist/trace.js 로 빌드하고 API 서버가
GET /trace.js 로 내려준다. self-hosted 사용자가 CDN 이나 별도
정적 호스팅을 준비할 필요가 없다.

스크립트 src origin 이 곧 수집 엔드포인트 origin 이 되므로 설치
스니펫에 서버 주소를 한 번만 적으면 된다.

데모 사이트를 소스 직접 import 에서 script 태그 방식으로 바꾼다.
개발자가 검증하는 경로와 사용자가 겪는 경로를 같게 만든다.
MSG
)"
```

---

## Task 8: Admin 설정 모듈과 프로젝트 선택 저장

**Files:**
- Create: `apps/admin/src/config.ts`
- Create: `apps/admin/src/storage.ts`
- Create: `apps/admin/src/storage.test.ts`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/App.tsx`

**Interfaces:**
- Consumes: `createProject` 백엔드 라우트 `POST /admin/api/projects` (기존, `admin-proxy.ts`)
- Produces: `export const API_BASE_URL: string` (`config.ts`)
- Produces: `export function readSelectedProjectId(): string | undefined` (`storage.ts`)
- Produces: `export function writeSelectedProjectId(projectId: string): void` (`storage.ts`)
- Produces: `export async function createProject(input: { name: string; allowedDomains: string[] }, csrfToken: string): Promise<{ projectId: string }>` (`api.ts`)

`VITE_PROJECT_ID`를 제거한다. 프로젝트를 빌드 타임 환경변수로 고정하면 프로젝트를 만들 때마다 프론트를 다시 빌드해야 한다.

`storage.ts`를 `api.ts`와 분리하는 이유는 테스트다. `App.test.tsx`가 `./api` 모듈 전체를 mock하므로, 저장 로직이 `api.ts`에 있으면 App 테스트에서 실제 동작을 검증할 수 없다.

`API_BASE_URL`은 현재 `api.ts:3`과 `App.tsx:7`에 중복 선언되어 있다. `config.ts`로 모아 한 곳에서 정의한다.

- [x] **Step 1: 실패하는 저장 테스트 작성**

Create `apps/admin/src/storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSelectedProjectId, writeSelectedProjectId } from "./storage.js";

beforeEach(() => {
  window.localStorage.clear();
});

describe("선택한 프로젝트 저장", () => {
  it("저장한 값을 읽는다", () => {
    writeSelectedProjectId("proj_abc");

    expect(readSelectedProjectId()).toBe("proj_abc");
  });

  it("저장된 값이 없으면 undefined 를 반환한다", () => {
    expect(readSelectedProjectId()).toBeUndefined();
  });

  it("localStorage 접근이 실패해도 예외를 던지지 않는다", () => {
    // jsdom 의 localStorage 는 Proxy 라 인스턴스에 스파이를 얹으면 defineProperty
    // 트랩이 삼켜 버린다. 실제로 가로채려면 Storage.prototype 에 걸어야 한다.
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => writeSelectedProjectId("proj_abc")).not.toThrow();
    expect(readSelectedProjectId()).toBeUndefined();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
```

- [x] **Step 2: 테스트를 실행해 실패 확인**

Run:

```bash
npm run test --workspace @trace/admin -- src/storage.test.ts
```

Expected: FAIL. `Failed to resolve import "./storage.js"`.

- [x] **Step 3: config 모듈 작성**

Create `apps/admin/src/config.ts`:

```ts
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
```

- [x] **Step 4: storage 모듈 작성**

Create `apps/admin/src/storage.ts`:

```ts
const PROJECT_STORAGE_KEY = "trace.selectedProjectId";

export function readSelectedProjectId(): string | undefined {
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeSelectedProjectId(projectId: string): void {
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
  } catch {
    // 브라우저가 저장을 막아도 대시보드는 동작해야 한다.
  }
}
```

- [x] **Step 5: 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/admin -- src/storage.test.ts
```

Expected: PASS. 3개 통과.

- [x] **Step 6: api.ts에 createProject 추가하고 중복 선언 제거**

Modify `apps/admin/src/api.ts` — 파일 앞부분의 다음 두 줄을 제거한다:

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const DEFAULT_PROJECT_ID = import.meta.env.VITE_PROJECT_ID;
```

첫 import 다음 줄에 추가한다:

```ts
import { API_BASE_URL } from "./config.js";
```

`credentialedFetch`의 `API_BASE`를 `API_BASE_URL`로 바꾼다:

```ts
const credentialedFetch = (path: string, init: RequestInit = {}) =>
  fetch(`${API_BASE_URL}${path}`, { ...init, credentials: "include" });
```

`logout` 함수 다음에 추가한다:

```ts
export async function createProject(
  input: { name: string; allowedDomains: string[] },
  csrfToken: string,
): Promise<{ projectId: string }> {
  const response = await ensureSuccess("/admin/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json", "x-trace-csrf": csrfToken },
    body: JSON.stringify(input),
  });

  return response.json() as Promise<{ projectId: string }>;
}
```

- [x] **Step 7: App.tsx가 저장된 프로젝트를 쓰도록 변경**

Modify `apps/admin/src/App.tsx`.

파일 앞부분의 다음 두 줄을 제거한다:

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const DEFAULT_PROJECT_ID = import.meta.env.VITE_PROJECT_ID;
```

import 블록에 추가한다:

```ts
import { API_BASE_URL } from "./config.js";
import { readSelectedProjectId, writeSelectedProjectId } from "./storage.js";
```

`load` 함수 안의 프로젝트 결정부를 다음으로 교체한다:

```ts
        const auth = await getAuthMe();
        const storedProjectId = readSelectedProjectId();
        const hasStored = storedProjectId
          ? auth.projects.some((project) => project.projectId === storedProjectId)
          : false;
        const projectId = hasStored ? storedProjectId : auth.projects[0]?.projectId;
        if (!projectId) {
          if (active) setState({ type: "empty-projects" });
          return;
        }

        writeSelectedProjectId(projectId);
```

로그인 버튼의 `${API_BASE}/auth/google/start`를 `${API_BASE_URL}/auth/google/start`로 바꾼다.

저장된 값이 현재 계정의 프로젝트 목록에 없으면 무시한다. 다른 계정으로 로그인했을 때 남의 프로젝트 ID를 요청해 403을 받는 것을 막는다.

- [x] **Step 8: 전체 검증**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 전부 통과. `App.test.tsx`의 기존 5개 테스트가 그대로 통과한다. `localStorage`가 비어 있으면 `auth.projects[0]`을 쓰므로 기존 동작과 같다.

- [x] **Step 9: Commit**

```bash
git add apps/admin/src/config.ts apps/admin/src/storage.ts apps/admin/src/storage.test.ts \
        apps/admin/src/api.ts apps/admin/src/App.tsx
git commit -m "$(cat <<'MSG'
관리자: VITE_PROJECT_ID 를 제거하고 프로젝트 선택을 저장

프로젝트를 빌드 타임 환경변수로 고정하면 프로젝트를 만들 때마다
프론트를 다시 빌드해야 한다. 선택한 프로젝트를 localStorage 에
기억하고 없으면 첫 프로젝트를 쓴다.

저장된 값이 현재 계정의 프로젝트 목록에 없으면 무시한다. 다른
계정으로 로그인했을 때 403 을 받는 것을 막는다.

API_BASE_URL 이 api.ts 와 App.tsx 에 중복 선언되어 있어 config.ts
로 모은다. createProject 를 추가해 다음 단계의 온보딩 화면이 쓸
수 있게 한다.
MSG
)"
```

---

## Task 9: 온보딩 화면

**Files:**
- Create: `apps/admin/src/pages/CreateProjectPage.tsx`
- Create: `apps/admin/src/pages/InstallPage.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `apps/admin/src/App.test.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `createProject(input, csrfToken)` (Task 8), `API_BASE_URL` (Task 8), `writeSelectedProjectId` (Task 8), `getDashboardData` (기존), `DashboardSummary["totalEventsCount"]` (Task 3)
- Produces: `CreateProjectPage({ onCreate, error }: { onCreate: (input: { name: string; allowedDomains: string[] }) => void; error?: string | undefined })`
- Produces: `InstallPage({ projectId, snippet, eventsSeen, onContinue }: { projectId: string; snippet: string; eventsSeen: number; onContinue: () => void })`
- Produces: `DashboardPage` prop 추가 — `onShowInstall: () => void`

상태 흐름은 다음과 같다.

```
loading → login → create-project → install → ready
```

폴링은 App이 소유하고 `InstallPage`는 표시만 한다. 첫 이벤트 도착 확인이 온보딩 최대 이탈 지점이므로, 화면에 머무는 동안 3초 간격으로 `getDashboardData`를 호출해 `totalEventsCount`를 확인한다.

- [x] **Step 1: 실패하는 온보딩 테스트 작성**

Modify `apps/admin/src/App.test.tsx` — `api` mock 객체에 `createProject: vi.fn(),`를 추가하고 `vi.mock("./api", ...)`의 반환 객체에도 `createProject: api.createProject,`를 추가한다. 그리고 파일 맨 아래에 다음 describe 블록을 추가한다:

```ts
describe("App 온보딩", () => {
  const emptyAuth = {
    user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
    projects: [],
    csrfToken: "csrf_1",
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("프로젝트가 없으면 생성 폼을 보여준다", async () => {
    api.getAuthMe.mockResolvedValue(emptyAuth);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "첫 프로젝트를 만들어주세요." })).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toBeInTheDocument();
    expect(screen.getByLabelText("허용 도메인")).toBeInTheDocument();
  });

  it("프로젝트를 만들면 설치 스니펫을 보여준다", async () => {
    api.getAuthMe.mockResolvedValue(emptyAuth);
    api.createProject.mockResolvedValue({ projectId: "proj_new" });
    api.getDashboardData.mockResolvedValue({
      summary: { ...baseSummary, totalEventsCount: 0 },
      issues: [],
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "내 사이트" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), {
      target: { value: "http://localhost:5174" },
    });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

    expect(await screen.findByRole("heading", { name: "스크립트를 붙여주세요." })).toBeInTheDocument();
    expect(api.createProject).toHaveBeenCalledWith(
      { name: "내 사이트", allowedDomains: ["http://localhost:5174"] },
      "csrf_1",
    );
    expect(screen.getByText(/data-project-id="proj_new"/)).toBeInTheDocument();
  });

  it("첫 이벤트가 도착하면 대시보드로 넘어가는 버튼을 보여준다", async () => {
    vi.useFakeTimers();
    api.getAuthMe.mockResolvedValue(emptyAuth);
    api.createProject.mockResolvedValue({ projectId: "proj_new" });
    // 폴링은 install 화면에 들어간 뒤 3 초 시점에 처음 호출된다. mockResolvedValueOnce 로
    // 0 을 먼저 두면 첫 폴링이 0 을 받아 아래 도착 단정이 3 초에 성립하지 않는다.
    api.getDashboardData.mockResolvedValue({
      summary: { ...baseSummary, totalEventsCount: 3 },
      issues: [],
    });

    render(<App />);

    await vi.advanceTimersByTimeAsync(0);
    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "내 사이트" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), {
      target: { value: "http://localhost:5174" },
    });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText("아직 이벤트를 기다리고 있습니다.")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(3000);

    expect(screen.getByText("첫 이벤트가 도착했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대시보드 보기" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("생성이 실패하면 오류를 폼에 표시한다", async () => {
    api.getAuthMe.mockResolvedValue(emptyAuth);
    api.createProject.mockRejectedValue(new api.ApiError(400, "invalid_allowed_domains"));

    render(<App />);

    fireEvent.change(await screen.findByLabelText("프로젝트 이름"), { target: { value: "내 사이트" } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), { target: { value: "localhost" } });
    fireEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

    expect(await screen.findByText("invalid_allowed_domains")).toBeInTheDocument();
  });

  it("대시보드에서 설치 안내로 돌아갈 수 있다", async () => {
    api.getAuthMe.mockResolvedValue({
      user: { adminUserId: "admin_1", email: "admin@example.com", name: "Admin" },
      projects: [{ projectId: "proj_demo", role: "owner" }],
      csrfToken: "csrf_1",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "설치 안내" }));

    expect(await screen.findByRole("heading", { name: "스크립트를 붙여주세요." })).toBeInTheDocument();
  });
});
```

`baseSummary`가 필요하다. 파일 상단 `beforeEach` 바로 위에 추가한다:

```ts
const baseSummary = {
  frictionScore: 82,
  affectedSessionsCount: 312,
  newIssuesCount: 14,
  resolvedOrIgnoredIssuesCount: 6,
  totalEventsCount: 128,
  insight: "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다.",
  trend: [{ date: "2026-08-24", score: 82 }],
  issueTypeDistribution: [{ issueType: "rage_click" as const, count: 4 }],
  topTargets: [{ label: "/settings", count: 42 }],
};
```

기존 `beforeEach`의 `summary` 리터럴을 `summary: baseSummary,`로 교체한다.

- [x] **Step 2: 테스트를 실행해 실패 확인**

Run:

```bash
npm run test --workspace @trace/admin
```

Expected: FAIL. `Unable to find an accessible element with the role "heading" and name "첫 프로젝트를 만들어주세요."`.

- [x] **Step 3: 프로젝트 생성 화면 작성**

Create `apps/admin/src/pages/CreateProjectPage.tsx`:

```tsx
import { useState } from "react";

export function CreateProjectPage({
  onCreate,
  error,
}: {
  onCreate: (input: { name: string; allowedDomains: string[] }) => void;
  error?: string | undefined;
}) {
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");

  const submit = () => {
    const allowedDomains = domains
      .split(",")
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);

    onCreate({ name: name.trim(), allowedDomains });
  };

  return (
    <main className="app-shell auth-state">
      <p className="eyebrow">Trace 관리자</p>
      <h1>첫 프로젝트를 만들어주세요.</h1>
      <p>프로젝트를 만들면 사이트에 붙일 스크립트를 알려드립니다.</p>

      <label className="field" htmlFor="project-name">
        프로젝트 이름
        <input
          id="project-name"
          type="text"
          value={name}
          placeholder="내 사이트"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      {/* 힌트를 label 안에 두면 접근 가능한 이름에 힌트 문구까지 붙어 라벨이
          "허용 도메인" 으로 조회되지 않는다. 밖으로 빼고 aria-describedby 로 잇는다. */}
      <div className="field">
        <label htmlFor="allowed-domains">허용 도메인</label>
        <input
          id="allowed-domains"
          type="text"
          value={domains}
          placeholder="http://localhost:5174"
          aria-describedby="allowed-domains-hint"
          onChange={(event) => setDomains(event.target.value)}
        />
        <span className="field-hint" id="allowed-domains-hint">
          이 프로젝트의 이벤트를 받을 사이트 주소입니다. 여러 개면 쉼표로 구분합니다.
        </span>
      </div>

      {error ? <p className="field-error">{error}</p> : null}

      <button
        type="button"
        className="primary-button"
        disabled={name.trim().length === 0 || domains.trim().length === 0}
        onClick={submit}
      >
        프로젝트 만들기
      </button>
    </main>
  );
}
```

`<label>`이 텍스트와 `<input>`을 함께 감싸면 `getByLabelText`가 동작한다. 다만 힌트까지 감싸면 접근 가능한 이름에 힌트 문구가 붙어 조회에 실패하므로, 힌트가 있는 필드는 `htmlFor` 와 `aria-describedby` 로 나눈다.

- [x] **Step 4: 설치 안내 화면 작성**

Create `apps/admin/src/pages/InstallPage.tsx`:

```tsx
export function InstallPage({
  projectId,
  snippet,
  eventsSeen,
  onContinue,
}: {
  projectId: string;
  snippet: string;
  eventsSeen: number;
  onContinue: () => void;
}) {
  const arrived = eventsSeen > 0;

  return (
    <main className="app-shell auth-state">
      <p className="eyebrow">Trace 관리자</p>
      <h1>스크립트를 붙여주세요.</h1>
      <p>
        사이트의 <code>&lt;head&gt;</code>에 아래 한 줄을 붙이면 수집이 시작됩니다.
      </p>

      <pre className="install-snippet">{snippet}</pre>

      <p className="install-status">
        {arrived ? "첫 이벤트가 도착했습니다." : "아직 이벤트를 기다리고 있습니다."}
      </p>

      <button type="button" className="primary-button" onClick={onContinue}>
        {arrived ? "대시보드 보기" : "대시보드로 이동"}
      </button>

      <p className="field-hint">
        프로젝트 ID는 <code>{projectId}</code>입니다. 동의 배너를 쓰는 사이트는{" "}
        <code>data-consent="pending"</code>을 추가하고 <code>window.trace.consent.grant()</code>로
        수집을 시작하세요.
      </p>
    </main>
  );
}
```

- [x] **Step 5: App.tsx 상태 흐름 확장**

Modify `apps/admin/src/App.tsx`.

import에 추가한다:

```ts
import { createProject } from "./api.js";
import { CreateProjectPage } from "./pages/CreateProjectPage.js";
import { InstallPage } from "./pages/InstallPage.js";
```

기존 `import { ApiError, getAuthMe, getDashboardData, logout } from "./api.js";`는 `createProject`를 포함하도록 합친다.

`AppState` 타입에서 `{ type: "empty-projects" }`를 제거하고 다음 두 상태를 추가한다:

```ts
  | { type: "create-project"; csrfToken: string; createError?: string | undefined }
  | { type: "install"; projectId: string; eventsSeen: number }
```

`ready` 상태에 `projectId: string`을 추가한다.

`load` 함수의 `if (!projectId)` 분기를 다음으로 교체한다:

```ts
        if (!projectId) {
          if (active) setState({ type: "create-project", csrfToken: auth.csrfToken });
          return;
        }
```

`setState({ type: "ready", ... })` 호출에 `projectId`를 추가한다:

```ts
          setState({
            type: "ready",
            data,
            projectId,
            userEmail: auth.user.email,
            csrfToken: auth.csrfToken,
          });
```

`if (state.type === "empty-projects")` 블록을 제거하고, 그 자리에 다음을 넣는다:

```ts
  if (state.type === "create-project") {
    const handleCreate = async (input: { name: string; allowedDomains: string[] }) => {
      try {
        const project = await createProject(input, state.csrfToken);
        writeSelectedProjectId(project.projectId);
        setState({ type: "install", projectId: project.projectId, eventsSeen: 0 });
      } catch (error) {
        setState({
          type: "create-project",
          csrfToken: state.csrfToken,
          createError: error instanceof ApiError ? error.message : "프로젝트를 만들지 못했습니다.",
        });
      }
    };

    return <CreateProjectPage onCreate={(input) => { void handleCreate(input); }} error={state.createError} />;
  }

  if (state.type === "install") {
    return (
      <InstallPage
        projectId={state.projectId}
        snippet={buildSnippet(state.projectId)}
        eventsSeen={state.eventsSeen}
        onContinue={() => setReloadKey((key) => key + 1)}
      />
    );
  }
```

`install` 상태에서 폴링하는 effect를 첫 `useEffect` 다음에 추가한다:

```ts
  useEffect(() => {
    if (state.type !== "install" || state.eventsSeen > 0) return;

    const projectId = state.projectId;
    let active = true;

    const timer = setInterval(() => {
      void getDashboardData(projectId)
        .then((data) => {
          if (!active || data.summary.totalEventsCount === 0) return;
          setState((current) =>
            current.type === "install"
              ? { ...current, eventsSeen: data.summary.totalEventsCount }
              : current,
          );
        })
        .catch(() => {
          // 폴링 실패는 무시한다. 다음 주기에 다시 시도한다.
        });
    }, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state]);
```

파일 맨 아래 `AppMessage` 함수 다음에 스니펫 생성 함수를 추가한다:

```ts
function buildSnippet(projectId: string): string {
  return `<script src="${API_BASE_URL}/trace.js" data-project-id="${projectId}"></script>`;
}
```

`ready` 상태의 `DashboardPage`에 prop을 추가한다:

```tsx
        onShowInstall={() =>
          setState({
            type: "install",
            projectId: state.projectId,
            eventsSeen: state.data.summary.totalEventsCount,
          })
        }
```

- [x] **Step 6: 대시보드 헤더에 설치 안내 버튼 추가**

Modify `apps/admin/src/pages/DashboardPage.tsx`.

props 타입과 구조 분해에 `onShowInstall: () => void;`를 추가한다.

`header-actions` div 안 `user-email` span 다음에 추가한다:

```tsx
          <button className="secondary-button" type="button" onClick={onShowInstall}>설치 안내</button>
```

- [x] **Step 7: 스타일 추가**

Modify `apps/admin/src/styles.css` — 파일 끝에 추가한다:

```css
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px 0;
  max-width: 420px;
  text-align: left;
}

.field input {
  padding: 10px 12px;
  border: 1px solid #d9e1ea;
  border-radius: 6px;
  font: inherit;
}

.field-hint {
  color: #5b6b7c;
  font-size: 13px;
}

.field-error {
  color: #c0392b;
  font-size: 14px;
}

.install-snippet {
  max-width: 640px;
  padding: 14px 16px;
  border: 1px solid #d9e1ea;
  border-radius: 6px;
  background: #f7f9fb;
  overflow-x: auto;
  text-align: left;
  font-size: 13px;
}

.install-status {
  font-weight: 600;
}
```

- [x] **Step 8: 테스트를 실행해 통과 확인**

Run:

```bash
npm run test --workspace @trace/admin
```

Expected: PASS. `storage.test.ts` 3개, `App.test.tsx` 10개(기존 5개 + 온보딩 5개).

- [x] **Step 9: 전체 검증**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 전부 통과.

- [x] **Step 10: Commit**

```bash
git add apps/admin/src
git commit -m "$(cat <<'MSG'
관리자: 프로젝트 생성과 설치 안내 온보딩 추가

프로젝트가 없을 때 "연결된 프로젝트가 없습니다" 로 끝나던 화면을
생성 폼으로 바꾼다. README 가 안내하던 브라우저 콘솔 fetch 절차가
사라진다.

생성 후 설치 스니펫을 보여주고 3 초 간격으로 totalEventsCount 를
확인한다. 첫 이벤트가 도착하면 화면에 알리고 대시보드로 넘어간다.
"붙였는데 되는지 모르겠다" 가 온보딩 최대 이탈 지점이다.

대시보드 헤더에 설치 안내 버튼을 두어 스니펫을 다시 볼 수 있게
한다.
MSG
)"
```

---

## Task 10: README 재작성과 최종 검증

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 앞선 모든 태스크의 산출물
- Produces: 없음

현재 README는 브라우저 콘솔에 `fetch`를 붙여넣어 프로젝트를 만들도록 안내한다. Task 9로 그 절차가 사라졌으므로 문서가 실제와 어긋난 상태다.

- [x] **Step 1: README 전체 재작성**

Modify `README.md` 전체를 다음으로 교체한다:

````markdown
# trace

사이트에 스크립트 한 줄을 붙이면 사용자가 막히는 지점을 관리자 페이지에서 통계, 차트, 세션 타임라인으로 확인할 수 있습니다.

self-hosted 제품입니다. 서버와 관리자 페이지를 직접 운영하고, 수집한 데이터는 여러분의 서버를 벗어나지 않습니다.

## 요구 사항

- Node 22.5 이상 (`.nvmrc` 참고)
- Google 계정 (관리자 로그인에 사용합니다)

## 시작하기

### 1. 설치

```bash
npm install
npm run build
```

### 2. Google OAuth 클라이언트 준비

관리자 로그인에 Google OAuth를 사용하므로 [Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서 OAuth 2.0 클라이언트 ID를 하나 만들어야 합니다. 승인된 리디렉션 URI에 아래를 등록합니다.

```text
http://localhost:4000/auth/google/callback
```

### 3. API 서버 실행

```bash
NODE_ENV=development \
GOOGLE_CLIENT_ID=<client-id> \
GOOGLE_CLIENT_SECRET=<client-secret> \
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback \
SESSION_SECRET=<32자 이상 임의 문자열> \
ADMIN_APP_ORIGIN=http://localhost:5173 \
ADMIN_ALLOWED_EMAILS=<로그인할 Google 계정 이메일> \
COOKIE_SECURE=false \
npm run dev:api
```

`COOKIE_SECURE=false`는 `NODE_ENV`가 `development`나 `test`일 때만 허용됩니다. HTTPS 없이 로컬에서 띄우려면 위처럼 둘을 함께 지정합니다.

`ADMIN_ALLOWED_EMAILS`에 적은 이메일만 로그인할 수 있습니다. 데이터는 `./trace.db`에 저장되고 서버를 재시작해도 남습니다.

### 4. 관리자 페이지 실행

```bash
npm run dev:admin
```

`http://localhost:5173`을 열고 Google로 로그인합니다.

### 5. 프로젝트 만들고 스크립트 붙이기

로그인하면 프로젝트 생성 화면이 나옵니다. 이름과 허용 도메인을 입력하면 붙일 스크립트를 알려줍니다.

```html
<script src="http://localhost:4000/trace.js" data-project-id="proj_xxxxxxxxxx"></script>
```

사이트의 `<head>`에 붙이고 몇 번 클릭하면, 설치 화면이 첫 이벤트 도착을 알려줍니다.

## 데모 사이트로 확인하기

붙일 사이트가 아직 없으면 포함된 데모 사이트로 확인할 수 있습니다. 프로젝트 생성 시 허용 도메인에 `http://localhost:5174`를 넣으세요.

```bash
npm run dev:demo
```

```text
http://localhost:5174/?projectId=<projectId>
```

## 수집하는 것과 수집하지 않는 것

기본 설정에서 개인을 식별할 수 있는 정보를 수집하지 않습니다.

| 항목 | 동작 |
| --- | --- |
| 쿠키, localStorage, sessionStorage | **사용하지 않습니다** |
| 방문자 ID | 페이지를 열 때마다 새로 만들고 저장하지 않습니다. 새로고침하면 다른 ID가 됩니다 |
| IP 주소 | 저장하지 않습니다 |
| URL 경로 | 식별자로 보이는 부분을 `:id`로 바꿉니다. `/users/alice/settings` → `/users/:id/settings` |
| URL 쿼리 | 값을 전부 `[redacted]`로 바꿉니다 |
| 요소 텍스트 | 마스킹하고 길이를 제한합니다. 선택자는 해시로 저장합니다 |
| 입력값 원문 | 수집하지 않습니다 |
| 클릭 좌표, 화면 크기 | 수집합니다 |

`track()`으로 직접 넘기는 metadata에 회원번호 같은 내부 식별자를 넣으면 그것은 저장됩니다. 이메일 형태는 자동으로 걸러내지만 임의의 내부 식별자는 걸러낼 수 없습니다.

## 동의 배너를 쓰는 경우

기본값은 스크립트를 붙이면 바로 수집을 시작하는 것입니다. 사용자 동의를 먼저 받아야 하는 지역(EU 등)에 서비스한다면 수집을 보류하고 동의 후 시작하세요.

```html
<script src="http://localhost:4000/trace.js" data-project-id="proj_xxx" data-consent="pending"></script>
```

```js
// 사용자가 동의한 뒤
window.trace.consent.grant();
```

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | 필수 | — | Google OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | 필수 | — | Google OAuth 클라이언트 시크릿 |
| `GOOGLE_REDIRECT_URI` | 필수 | — | OAuth 콜백 주소 |
| `SESSION_SECRET` | 필수 | — | 세션 쿠키 서명 키. 32자 이상 |
| `ADMIN_APP_ORIGIN` | 필수 | — | 관리자 페이지 origin. CORS 허용 대상 |
| `ADMIN_ALLOWED_EMAILS` | 필수 | — | 로그인 허용 이메일. 쉼표로 구분 |
| `GOOGLE_ALLOWED_DOMAIN` | 선택 | — | 특정 Google Workspace 도메인으로 제한 |
| `NODE_ENV` | 선택 | — | `development` 또는 `test`일 때만 `COOKIE_SECURE=false`를 허용합니다 |
| `COOKIE_SECURE` | 선택 | `true` | 로컬 개발에서만 `false`로 둡니다. `NODE_ENV`와 함께 지정합니다 |
| `TRACE_DB_PATH` | 선택 | `./trace.db` | SQLite 데이터베이스 파일 경로 |
| `PORT` | 선택 | `4000` | API 서버 포트 |
| `SESSION_TTL_SECONDS` | 선택 | — | 세션 유효 기간 |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | 선택 | — | 로그인 rate limit 시간 창 |
| `LOGIN_RATE_LIMIT_MAX` | 선택 | — | 시간 창당 로그인 시도 허용 횟수 |

관리자 페이지는 `VITE_API_BASE_URL`로 API 주소를 지정할 수 있고, 기본값은 `http://localhost:4000`입니다.

## 서버에 올릴 때

`COOKIE_SECURE=true`로 두고 HTTPS를 사용하세요. `GOOGLE_REDIRECT_URI`와 `ADMIN_APP_ORIGIN`을 실제 주소로 바꾸고, Google Cloud Console의 승인된 리디렉션 URI에도 같은 주소를 등록해야 합니다.

SQLite를 쓰므로 단일 인스턴스로 운영합니다.

## 개발

```bash
npm test
npm run typecheck
npm run build
```

인증 관련 통합 검증은 fake Google client로 동작합니다.

```bash
npm run test --workspace @trace/api -- src/routes/auth.test.ts src/routes/admin.test.ts
```
````

- [x] **Step 2: 문서에 남은 콘솔 절차가 없는지 확인**

Run:

```bash
grep -rn "x-trace-csrf\|VITE_PROJECT_ID\|개발자 도구" README.md || echo "잔여 없음"
```

Expected: `잔여 없음`.

- [x] **Step 3: 사내 고유값이 커밋되지 않았는지 확인**

Run:

```bash
grep -rniE "douzone|더존|amaranth|oneffice|gwa\." README.md docs apps packages examples \
  --include="*.ts" --include="*.tsx" --include="*.md" --include="*.html" --include="*.json" \
  || echo "사내 고유값 없음"
```

Expected: `사내 고유값 없음`. 저장소를 public으로 전환하면 커밋 히스토리도 공개된다.

- [x] **Step 4: 전체 검증**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 전부 통과.

- [x] **Step 5: 번들에 비밀값이 들어가지 않았는지 확인**

Run:

```bash
grep -rn "GOOGLE_CLIENT_SECRET\|SESSION_SECRET\|TRACE_ADMIN_TOKEN\|VITE_TRACE_ADMIN_TOKEN" \
  apps/admin/dist packages/sdk/dist || echo "비밀값 없음"
```

Expected: `비밀값 없음`.

- [x] **Step 6: 설치 경험을 처음부터 끝까지 수동 확인**

깨끗한 상태에서 성공 기준을 직접 밟아본다.

```bash
rm -f trace.db trace.db-wal trace.db-shm
```

터미널 세 개를 쓴다.

1. `npm run dev:api` (Task 7 Step 9의 환경변수 사용, 단 `ADMIN_ALLOWED_EMAILS`는 실제 Google 계정)
2. `npm run dev:admin`
3. `npm run dev:demo`

확인 순서:

- `http://localhost:5173`에서 Google 로그인
- 프로젝트 생성 화면에서 이름과 허용 도메인 `http://localhost:5174` 입력
- 표시된 스니펫의 `projectId` 확인
- `http://localhost:5174/?projectId=<projectId>` 열고 버튼 몇 개 클릭
- 관리자 화면이 "첫 이벤트가 도착했습니다."로 바뀌는지 확인
- "대시보드 보기"를 눌러 문제 인박스 진입
- API 서버를 재시작한 뒤 대시보드에 데이터가 남아 있는지 확인

브라우저 개발자 도구 콘솔을 한 번도 열지 않고 위 과정을 마쳐야 한다.

- [x] **Step 7: Commit**

```bash
git add README.md
git commit -m "$(cat <<'MSG'
문서: self-hosted 설치 절차로 README 재작성

브라우저 콘솔에 fetch 를 붙여넣어 프로젝트를 만들라는 안내를
제거한다. 관리자 화면에서 프로젝트를 만들고 스니펫을 받는 절차로
바꾼다.

수집하는 항목과 수집하지 않는 항목을 표로 명시하고, 동의 배너를
쓰는 경우의 data-consent 사용법을 설치 안내 옆에 둔다. 환경변수
표에 TRACE_DB_PATH 를 추가하고 VITE_PROJECT_ID 를 제거한다.
MSG
)"
```

---

## Final Review Checklist

구현을 마친 뒤 확인한다.

- [x] `npm test`가 통과한다.
- [x] `npm run typecheck`가 통과한다.
- [x] `npm run build`가 통과한다.
- [x] `SqliteStore`와 `MemoryStore`가 같은 계약 테스트를 통과한다.
- [x] SDK 번들 gzip 크기가 10KB 미만이다.
- [x] SDK 번들에 zod가 없다. `grep -c "ZodError" packages/sdk/dist/trace.js`가 0이다.
- [x] `GET /trace.js`가 200과 JavaScript content type을 반환한다.
- [x] 데모 사이트에서 클릭한 이벤트가 5초 안에 서버에 도착한다.
- [x] 서버를 재시작해도 대시보드 데이터가 남아 있다.
- [x] 브라우저 콘솔을 열지 않고 프로젝트를 만들고 스크립트를 붙일 수 있다.
- [x] `VITE_PROJECT_ID` 참조가 코드와 문서에 남아 있지 않다.
- [x] 사내 고유값이 코드, 문서, 테스트 픽스처에 없다.

## 이번 범위에서 해소하지 않는 알려진 마찰

- **Google OAuth 클라이언트 준비가 필요하다.** 처음 써보는 사용자가 Google Cloud Console에서 OAuth 클라이언트를 만들어야 하므로 실제 소요 시간이 5분을 넘는다. 인증 방식은 이전 사이클에서 확정된 사항이라 이번 범위에서 바꾸지 않고, README에 필수 단계로 명시한다. 다음 사이클에서 로컬 전용 간편 로그인을 검토할 수 있다.
- **`allowedDomains`를 나중에 수정할 수 없다.** 입력값은 origin 으로 정규화되지만, 다른 도메인을 추가하려면 아직 프로젝트를 다시 만들어야 한다. 프로젝트 설정 화면과 함께 해소한다.
- **이벤트 보관 기간 정책이 없다.** SQLite 파일이 무한히 커진다.
- **프로젝트 전환 UI가 없다.** 프로젝트가 여러 개면 `localStorage`를 직접 지워야 다른 프로젝트로 갈 수 있다.
