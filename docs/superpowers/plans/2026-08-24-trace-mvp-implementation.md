# Trace MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 웹사이트에서 실제 행동 이벤트를 수집하고, 관리자 페이지에서 문제 인박스/통계 차트/문제 상세/세션 타임라인을 볼 수 있는 Trace MVP 1차를 만든다.

**Architecture:** npm workspaces 기반 TypeScript 모노레포로 구성한다. `packages/shared`는 이벤트 타입, zod schema, 개인정보 redaction을 제공하고, `packages/sdk`는 브라우저 수집 SDK를 제공하며, `apps/api`는 Fastify 수집/관리 API와 막힘 감지 엔진을 제공하고, `apps/admin`은 React 관리자 페이지를 제공한다.

**Tech Stack:** Node.js 22, npm workspaces, TypeScript, Vitest, Fastify, Zod, PostgreSQL SQL schema, React, Vite, Recharts, Testing Library.

## Global Constraints

- 기본 언어는 한국어다. 프로젝트 논의, 스펙, 구현 요약, 커밋 메시지는 한국어로 작성한다.
- 코드 식별자, 명령어, 파일 경로, 패키지명, API 이름은 원문 언어를 유지한다.
- MVP 1차 범위는 실제 수집, 문제 인박스, 홈 요약 통계/기본 차트, 문제 상세, 세션 타임라인이다.
- MVP 1.5차인 기능 맵, 기능 이름 매핑, 개인정보 설정 UI는 이번 구현에서 데이터/인터페이스 경계만 유지한다.
- 전체 세션 리플레이, 히트맵 고도화, AI 요약, Slack 알림, 팀 권한 고도화, 결제/요금제, 대량 이벤트 파이프라인, 고급 필터/세그먼트는 구현하지 않는다.
- 개인정보 기본 원칙은 Private by default다.
- 입력값 원문, 비밀번호/결제/카드/주소/전화번호/이메일 필드 값, 전체 DOM 원문, 전체 화면 텍스트, 이미지/영상 원본, 네트워크 body, 민감 URL query value는 저장하지 않는다.
- URL query value는 redaction한다.
- SDK gzip 크기는 가능하면 30KB 이하를 목표로 한다.
- 이벤트 전송은 batch 방식으로 한다.
- click handler는 가볍게 처리하고, scroll 이벤트는 throttle/debounce한다.
- 네트워크 실패가 고객 웹사이트 사용자 경험에 영향을 주지 않게 한다.

---

## File Structure

Create:

- `package.json`: npm workspaces, 공통 scripts.
- `tsconfig.base.json`: 모든 workspace의 TypeScript 기준 설정.
- `vitest.workspace.ts`: workspace별 테스트 실행 설정.
- `packages/shared/package.json`: shared package manifest.
- `packages/shared/src/events.ts`: 공통 event/session/project/issue/feature 타입과 zod schema.
- `packages/shared/src/privacy.ts`: 이메일/전화번호/긴 숫자/query/custom metadata redaction.
- `packages/shared/src/index.ts`: shared public exports.
- `packages/shared/src/events.test.ts`: schema validation 테스트.
- `packages/shared/src/privacy.test.ts`: redaction 테스트.
- `packages/sdk/package.json`: browser SDK package manifest.
- `packages/sdk/src/index.ts`: SDK public API, `init`, `track`, consent API.
- `packages/sdk/src/client.ts`: 수집 상태, 세션 생성, batch queue, flush.
- `packages/sdk/src/collectors.ts`: page/click/scroll/error/web vital 수집.
- `packages/sdk/src/dom.ts`: selector hash, safe element metadata, input exclusion.
- `packages/sdk/src/client.test.ts`: SDK batch/consent 테스트.
- `packages/sdk/src/dom.test.ts`: DOM 마스킹 테스트.
- `apps/api/package.json`: API app manifest.
- `apps/api/src/app.ts`: Fastify app factory.
- `apps/api/src/server.ts`: HTTP server entrypoint.
- `apps/api/src/config.ts`: env parsing.
- `apps/api/src/db/schema.sql`: PostgreSQL schema.
- `apps/api/src/store/types.ts`: store interface.
- `apps/api/src/store/memory-store.ts`: 테스트와 로컬 MVP용 in-memory store.
- `apps/api/src/routes/ingestion.ts`: `POST /v1/events/batch`.
- `apps/api/src/routes/admin.ts`: projects/issues/session timeline/dashboard summary API.
- `apps/api/src/detection/detect.ts`: event stream에서 issue 후보 생성.
- `apps/api/src/detection/severity.ts`: severity score 계산.
- `apps/api/src/detection/url.ts`: 동적 URL segment 정규화.
- `apps/api/src/routes/ingestion.test.ts`: 수집 API 테스트.
- `apps/api/src/detection/detect.test.ts`: 막힘 감지 테스트.
- `apps/api/src/routes/admin.test.ts`: 관리자 API 테스트.
- `apps/admin/package.json`: admin app manifest.
- `apps/admin/index.html`: Vite entry HTML.
- `apps/admin/src/main.tsx`: React bootstrap.
- `apps/admin/src/api.ts`: 관리자 API client.
- `apps/admin/src/App.tsx`: layout/routing state.
- `apps/admin/src/pages/DashboardPage.tsx`: 문제 인박스 홈과 차트.
- `apps/admin/src/pages/IssueDetailPage.tsx`: 문제 상세와 세션 타임라인.
- `apps/admin/src/components/MetricStrip.tsx`: 핵심 지표 카드.
- `apps/admin/src/components/FrictionTrendChart.tsx`: 기간별 막힘 추세 차트.
- `apps/admin/src/components/IssueTypeChart.tsx`: issue 유형 분포 차트.
- `apps/admin/src/components/IssueTable.tsx`: 문제 인박스 표.
- `apps/admin/src/components/SessionTimeline.tsx`: 세션 이벤트 타임라인.
- `apps/admin/src/styles.css`: 관리자 화면 스타일.
- `apps/admin/src/App.test.tsx`: 대시보드 렌더링 테스트.
- `examples/demo-site/index.html`: SDK 설치와 이벤트 수집을 확인하는 샘플 사이트.
- `README.md`: 설치, 실행, 테스트, MVP 범위 문서.

Modify:

- `.gitignore`: `node_modules/`, `dist/`, coverage, env 파일 제외.

---

### Task 1: Monorepo Scaffold and Shared Event Contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/events.ts`
- Create: `packages/shared/src/events.test.ts`
- Create: `packages/shared/src/index.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `eventBatchSchema`, `adminProjectSchema`, `type EventBatch`, `type TraceEvent`, `type Issue`, `type SessionTimelineEvent` from `@trace/shared`.
- Consumes: none.

- [ ] **Step 1: Write the failing shared schema test**

Create `packages/shared/src/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventBatchSchema } from "./events";

describe("eventBatchSchema", () => {
  it("accepts a valid click batch", () => {
    const parsed = eventBatchSchema.parse({
      projectId: "proj_123",
      anonymousUserId: "anon_123",
      sessionId: "sess_123",
      sentAt: "2026-08-24T00:00:00.000Z",
      sdkVersion: "0.1.0",
      url: "https://example.com/settings?email=[redacted]",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_123",
          pageId: "page_1",
          timestamp: "2026-08-24T00:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          urlQueryRedacted: "?email=[redacted]",
          elementSelectorHash: "abc123",
          elementRole: "button",
          elementTextMaskedOrLimited: "멤버 초대",
          x: 120,
          y: 48,
          viewportX: 1440,
          viewportY: 900,
          metadata: { source: "auto" },
        },
      ],
    });

    expect(parsed.events[0].type).toBe("click");
  });

  it("rejects unknown event types", () => {
    expect(() =>
      eventBatchSchema.parse({
        projectId: "proj_123",
        anonymousUserId: "anon_123",
        sessionId: "sess_123",
        sentAt: "2026-08-24T00:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://example.com/settings",
        events: [
          {
            eventId: "evt_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:00.000Z",
            type: "unknown_event",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Create workspace manifests**

Create root `package.json`:

```json
{
  "name": "trace",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty false",
    "dev:api": "npm run dev --workspace @trace/api",
    "dev:admin": "npm run dev --workspace @trace/admin"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "@vitest/ui": "^2.1.9",
    "typescript": "^5.7.3",
    "vitest": "^2.1.9"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": ".",
    "paths": {
      "@trace/shared": ["packages/shared/src/index.ts"],
      "@trace/sdk": ["packages/sdk/src/index.ts"]
    }
  }
}
```

Create `vitest.workspace.ts`:

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared",
  "packages/sdk",
  "apps/api",
  "apps/admin",
]);
```

Create `packages/shared/package.json`:

```json
{
  "name": "@trace/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "composite": true
  },
  "include": ["src"]
}
```

Create `packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and workspace dependencies are installed.

- [ ] **Step 4: Run the shared schema test and verify it fails**

Run: `npm test --workspace @trace/shared -- events.test.ts`

Expected: FAIL because `./events` does not exist.

- [ ] **Step 5: Implement shared event contracts**

Create `packages/shared/src/events.ts`:

```ts
import { z } from "zod";

export const eventTypeSchema = z.enum([
  "page_view",
  "page_leave",
  "click",
  "scroll",
  "idle",
  "dead_click",
  "rage_click",
  "js_error",
  "api_error",
  "web_vital",
  "custom_event",
  "form_start",
  "field_focus",
  "field_blur",
  "form_submit",
  "form_abandon",
]);

export const isoDateStringSchema = z.string().datetime();

export const traceEventSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  timestamp: isoDateStringSchema,
  type: eventTypeSchema,
  urlPath: z.string().min(1),
  urlQueryRedacted: z.string().optional(),
  titleMasked: z.string().max(120).optional(),
  elementSelectorHash: z.string().optional(),
  elementRole: z.string().optional(),
  elementTextMaskedOrLimited: z.string().max(120).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  viewportX: z.number().int().positive().optional(),
  viewportY: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const eventBatchSchema = z.object({
  projectId: z.string().min(1),
  anonymousUserId: z.string().min(1),
  sessionId: z.string().min(1),
  sentAt: isoDateStringSchema,
  sdkVersion: z.string().min(1),
  url: z.string().url(),
  events: z.array(traceEventSchema).min(1).max(100),
});

export const issueStatusSchema = z.enum(["new", "reviewing", "ignored", "resolved"]);
export const issueTypeSchema = z.enum([
  "dead_click_cluster",
  "rage_click",
  "long_pause",
  "scroll_friction",
  "error_friction",
  "form_friction",
]);

export const issueSchema = z.object({
  issueId: z.string().min(1),
  projectId: z.string().min(1),
  issueType: issueTypeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  affectedSessionsCount: z.number().int().nonnegative(),
  affectedUsersCount: z.number().int().nonnegative(),
  severityScore: z.number().int().min(0).max(100),
  firstSeenAt: isoDateStringSchema,
  lastSeenAt: isoDateStringSchema,
  trend: z.enum(["up", "flat", "down"]),
  relatedUrlPath: z.string().optional(),
  relatedFeatureId: z.string().optional(),
  exampleSessionIds: z.array(z.string()).default([]),
  status: issueStatusSchema,
});

export const dashboardSummarySchema = z.object({
  frictionScore: z.number().int().min(0).max(100),
  affectedSessionsCount: z.number().int().nonnegative(),
  newIssuesCount: z.number().int().nonnegative(),
  resolvedOrIgnoredIssuesCount: z.number().int().nonnegative(),
  insight: z.string(),
  trend: z.array(z.object({ date: z.string(), score: z.number().int().min(0).max(100) })),
  issueTypeDistribution: z.array(z.object({ issueType: issueTypeSchema, count: z.number().int().nonnegative() })),
  topTargets: z.array(z.object({ label: z.string(), count: z.number().int().nonnegative() })),
});

export type EventType = z.infer<typeof eventTypeSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type EventBatch = z.infer<typeof eventBatchSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type SessionTimelineEvent = TraceEvent;
```

Create `packages/shared/src/index.ts`:

```ts
export * from "./events";
```

- [ ] **Step 6: Update `.gitignore`**

Append these lines to `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
```

- [ ] **Step 7: Run the shared schema test and verify it passes**

Run: `npm test --workspace @trace/shared -- events.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.base.json vitest.workspace.ts packages/shared .gitignore
git commit -m "기반: 모노레포와 공통 이벤트 계약 추가"
```

---

### Task 2: Shared Privacy Redaction

**Files:**
- Create: `packages/shared/src/privacy.ts`
- Create: `packages/shared/src/privacy.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: none.
- Produces: `redactText(value: string): string`, `redactUrl(rawUrl: string): RedactedUrl`, `redactMetadata(metadata: Record<string, unknown>): Record<string, unknown>`, `isSensitiveField(element: Pick<HTMLInputElement, "tagName" | "type" | "name" | "id">): boolean`.

- [ ] **Step 1: Write failing redaction tests**

Create `packages/shared/src/privacy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSensitiveField, redactMetadata, redactText, redactUrl } from "./privacy";

describe("privacy redaction", () => {
  it("redacts emails, phone numbers, and long numeric values from text", () => {
    expect(redactText("choi@example.com 초대")).toBe("[redacted] 초대");
    expect(redactText("010-1234-5678")).toBe("[redacted]");
    expect(redactText("주문번호 123456789")).toBe("주문번호 [redacted]");
    expect(redactText("멤버 초대")).toBe("멤버 초대");
  });

  it("redacts URL query values and normalizes numeric path segments", () => {
    expect(redactUrl("https://app.example.com/users/123/settings?email=choi@example.com&tab=invite")).toEqual({
      origin: "https://app.example.com",
      urlPath: "/users/:id/settings",
      urlQueryRedacted: "?email=[redacted]&tab=[redacted]",
      urlQueryKeys: ["email", "tab"],
    });
  });

  it("redacts nested metadata values", () => {
    expect(redactMetadata({ email: "choi@example.com", count: 3, nested: { phone: "010-1234-5678" } })).toEqual({
      email: "[redacted]",
      count: 3,
      nested: { phone: "[redacted]" },
    });
  });

  it("marks sensitive form fields", () => {
    expect(isSensitiveField({ tagName: "INPUT", type: "password", name: "password", id: "password" })).toBe(true);
    expect(isSensitiveField({ tagName: "INPUT", type: "email", name: "email", id: "email" })).toBe(true);
    expect(isSensitiveField({ tagName: "BUTTON", type: "button", name: "invite", id: "invite" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @trace/shared -- privacy.test.ts`

Expected: FAIL because `./privacy` does not exist.

- [ ] **Step 3: Implement privacy utilities**

Create `packages/shared/src/privacy.ts`:

```ts
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /\b(?:\+?82[-.\s]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g;
const LONG_NUMBER_PATTERN = /\b\d{9,}\b/g;
const SENSITIVE_FIELD_HINTS = ["email", "phone", "tel", "password", "card", "address", "name", "ssn"];

export interface RedactedUrl {
  origin: string;
  urlPath: string;
  urlQueryRedacted: string;
  urlQueryKeys: string[];
}

export function redactText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[redacted]")
    .replace(PHONE_PATTERN, "[redacted]")
    .replace(LONG_NUMBER_PATTERN, "[redacted]")
    .slice(0, 120);
}

export function redactUrl(rawUrl: string): RedactedUrl {
  const url = new URL(rawUrl);
  const urlQueryKeys = Array.from(url.searchParams.keys());
  const urlQueryRedacted =
    urlQueryKeys.length === 0
      ? ""
      : `?${urlQueryKeys.map((key) => `${encodeURIComponent(key)}=[redacted]`).join("&")}`;

  return {
    origin: url.origin,
    urlPath: normalizePath(url.pathname),
    urlQueryRedacted,
    urlQueryKeys,
  };
}

export function normalizePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8,}$/i.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

export function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, redactUnknown(value)]));
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === "object") return redactMetadata(value as Record<string, unknown>);
  return value;
}

export function isSensitiveField(element: Pick<HTMLInputElement, "tagName" | "type" | "name" | "id">): boolean {
  const tagName = element.tagName.toLowerCase();
  const type = element.type?.toLowerCase() ?? "";
  const hints = `${element.name ?? ""} ${element.id ?? ""}`.toLowerCase();

  if (tagName === "input" && ["password", "email", "tel", "number"].includes(type)) return true;
  return SENSITIVE_FIELD_HINTS.some((hint) => hints.includes(hint));
}
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./events";
export * from "./privacy";
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @trace/shared -- privacy.test.ts events.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/shared/src/privacy.ts packages/shared/src/privacy.test.ts packages/shared/src/index.ts
git commit -m "개인정보: 공통 마스킹 유틸리티 추가"
```

---

### Task 3: API Store, Schema, and Project Creation

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/db/schema.sql`
- Create: `apps/api/src/store/types.ts`
- Create: `apps/api/src/store/memory-store.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/routes/admin.ts`
- Create: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `Issue`, `TraceEvent`, `DashboardSummary` from `@trace/shared`.
- Produces: `createApp(options: { store: TraceStore }): FastifyInstance`, `TraceStore`, `MemoryStore`.

- [ ] **Step 1: Write failing project API test**

Create `apps/api/src/routes/admin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { MemoryStore } from "../store/memory-store";

describe("admin routes", () => {
  it("creates a project and returns an install snippet", async () => {
    const app = createApp({ store: new MemoryStore() });

    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Demo SaaS",
        allowedDomains: ["https://demo.example.com"],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.projectId).toMatch(/^proj_/);
    expect(body.installSnippet).toContain("data-project-id");
    expect(body.allowedDomains).toEqual(["https://demo.example.com"]);
  });
});
```

- [ ] **Step 2: Create API manifest and config**

Create `apps/api/package.json`:

```json
{
  "name": "@trace/api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.2",
    "@trace/shared": "0.1.0",
    "fastify": "^5.2.1",
    "nanoid": "^5.0.9",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "vitest": "^2.1.9"
  }
}
```

Create `apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"],
  "references": [{ "path": "../../packages/shared" }]
}
```

Create `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace @trace/api -- admin.test.ts`

Expected: FAIL because `../app` and store files do not exist.

- [ ] **Step 4: Implement SQL schema and store**

Create `apps/api/src/db/schema.sql`:

```sql
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  allowed_domains JSONB NOT NULL,
  privacy_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  anonymous_user_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  device TEXT,
  browser TEXT,
  os TEXT,
  viewport JSONB,
  country_or_region TEXT,
  referrer TEXT
);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  session_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  url_path TEXT NOT NULL,
  url_query_redacted TEXT,
  title_masked TEXT,
  element_selector_hash TEXT,
  element_role TEXT,
  element_text_masked_or_limited TEXT,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  viewport_x INTEGER,
  viewport_y INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE issues (
  issue_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id),
  issue_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  affected_sessions_count INTEGER NOT NULL,
  affected_users_count INTEGER NOT NULL,
  severity_score INTEGER NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  trend TEXT NOT NULL,
  related_url_path TEXT,
  related_feature_id TEXT,
  example_session_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL
);
```

Create `apps/api/src/store/types.ts`:

```ts
import type { DashboardSummary, EventBatch, Issue, TraceEvent } from "@trace/shared";

export interface ProjectRecord {
  projectId: string;
  name: string;
  allowedDomains: string[];
  privacyConfig: { strictMasking: true; queryRedaction: true; inputCapture: false };
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  allowedDomains: string[];
}

export interface StoredSession {
  sessionId: string;
  projectId: string;
  anonymousUserId: string;
  startedAt: string;
  endedAt?: string;
}

export interface TraceStore {
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  getProject(projectId: string): Promise<ProjectRecord | undefined>;
  saveBatch(batch: EventBatch): Promise<void>;
  listEvents(projectId: string): Promise<TraceEvent[]>;
  upsertIssues(projectId: string, issues: Issue[]): Promise<void>;
  listIssues(projectId: string): Promise<Issue[]>;
  getIssue(issueId: string): Promise<Issue | undefined>;
  getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]>;
  getDashboardSummary(projectId: string): Promise<DashboardSummary>;
}
```

Create `apps/api/src/store/memory-store.ts` with in-memory maps implementing `TraceStore`. The methods must:

```ts
import type { DashboardSummary, EventBatch, Issue, TraceEvent } from "@trace/shared";
import { nanoid } from "nanoid";
import type { CreateProjectInput, ProjectRecord, TraceStore } from "./types";

export class MemoryStore implements TraceStore {
  private projects = new Map<string, ProjectRecord>();
  private events = new Map<string, TraceEvent[]>();
  private issues = new Map<string, Issue>();

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const project: ProjectRecord = {
      projectId: `proj_${nanoid(10)}`,
      name: input.name,
      allowedDomains: input.allowedDomains,
      privacyConfig: { strictMasking: true, queryRedaction: true, inputCapture: false },
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.projectId, project);
    return project;
  }

  async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    return this.projects.get(projectId);
  }

  async saveBatch(batch: EventBatch): Promise<void> {
    const existing = this.events.get(batch.projectId) ?? [];
    const seen = new Set(existing.map((event) => event.eventId));
    const unique = batch.events.filter((event) => !seen.has(event.eventId));
    this.events.set(batch.projectId, [...existing, ...unique]);
  }

  async listEvents(projectId: string): Promise<TraceEvent[]> {
    return [...(this.events.get(projectId) ?? [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async upsertIssues(projectId: string, issues: Issue[]): Promise<void> {
    for (const issue of issues) {
      if (issue.projectId === projectId) this.issues.set(issue.issueId, issue);
    }
  }

  async listIssues(projectId: string): Promise<Issue[]> {
    return [...this.issues.values()]
      .filter((issue) => issue.projectId === projectId)
      .sort((a, b) => b.severityScore - a.severityScore);
  }

  async getIssue(issueId: string): Promise<Issue | undefined> {
    return this.issues.get(issueId);
  }

  async getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]> {
    return (await this.listEvents(projectId)).filter((event) => event.sessionId === sessionId);
  }

  async getDashboardSummary(projectId: string): Promise<DashboardSummary> {
    const issues = await this.listIssues(projectId);
    const activeIssues = issues.filter((issue) => issue.status === "new" || issue.status === "reviewing");
    const frictionScore = activeIssues.length === 0 ? 0 : Math.max(...activeIssues.map((issue) => issue.severityScore));

    return {
      frictionScore,
      affectedSessionsCount: activeIssues.reduce((sum, issue) => sum + issue.affectedSessionsCount, 0),
      newIssuesCount: issues.filter((issue) => issue.status === "new").length,
      resolvedOrIgnoredIssuesCount: issues.filter((issue) => issue.status === "resolved" || issue.status === "ignored").length,
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
}
```

- [ ] **Step 5: Implement Fastify app and project route**

Create `apps/api/src/app.ts`:

```ts
import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerAdminRoutes } from "./routes/admin";
import type { TraceStore } from "./store/types";

export function createApp(options: { store: TraceStore }) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  app.register(registerAdminRoutes, { store: options.store });
  return app;
}
```

Create `apps/api/src/routes/admin.ts`:

```ts
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { TraceStore } from "../store/types";

const createProjectSchema = z.object({
  name: z.string().min(1),
  allowedDomains: z.array(z.string().url()).min(1),
});

export async function registerAdminRoutes(app: FastifyInstance, options: { store: TraceStore }) {
  app.post("/api/projects", async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    const project = await options.store.createProject(input);

    return reply.code(201).send({
      ...project,
      installSnippet: `<script src="https://cdn.trace.app/sdk.js" data-project-id="${project.projectId}"></script>`,
    });
  });
}
```

Create `apps/api/src/server.ts`:

```ts
import { createApp } from "./app";
import { MemoryStore } from "./store/memory-store";

const port = Number(process.env.PORT ?? 4000);
const app = createApp({ store: new MemoryStore() });

await app.listen({ port, host: "0.0.0.0" });
```

- [ ] **Step 6: Run API tests**

Run: `npm test --workspace @trace/api -- admin.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/api
git commit -m "서버: 프로젝트 생성 API 추가"
```

---

### Task 4: Event Ingestion API with Redaction and Domain Validation

**Files:**
- Create: `apps/api/src/routes/ingestion.ts`
- Create: `apps/api/src/routes/ingestion.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `apps/api/src/store/memory-store.ts`

**Interfaces:**
- Consumes: `eventBatchSchema`, `redactMetadata`, `redactUrl`, `TraceStore`.
- Produces: `POST /v1/events/batch` returns `{ accepted: number }`.

- [ ] **Step 1: Write failing ingestion route tests**

Create `apps/api/src/routes/ingestion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { MemoryStore } from "../store/memory-store";

describe("ingestion routes", () => {
  it("accepts a valid batch from an allowed domain and redacts metadata", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://demo.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings?email=choi@example.com",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "custom_event",
            urlPath: "/settings",
            metadata: { email: "choi@example.com" },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 1 });
    const events = await store.listEvents(project.projectId);
    expect(events[0]?.metadata).toEqual({ email: "[redacted]" });
    expect(events[0]?.urlQueryRedacted).toBe("?email=[redacted]");
  });

  it("rejects events from a disallowed domain", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({
      name: "Demo",
      allowedDomains: ["https://demo.example.com"],
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/events/batch",
      headers: { origin: "https://evil.example.com" },
      payload: {
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-24T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://evil.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-24T00:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run ingestion tests to verify failure**

Run: `npm test --workspace @trace/api -- ingestion.test.ts`

Expected: FAIL because `/v1/events/batch` is not registered.

- [ ] **Step 3: Implement ingestion route**

Create `apps/api/src/routes/ingestion.ts`:

```ts
import { eventBatchSchema, redactMetadata, redactUrl } from "@trace/shared";
import type { EventBatch } from "@trace/shared";
import type { FastifyInstance } from "fastify";
import type { TraceStore } from "../store/types";

export async function registerIngestionRoutes(app: FastifyInstance, options: { store: TraceStore }) {
  app.post("/v1/events/batch", async (request, reply) => {
    const parsed = eventBatchSchema.parse(request.body);
    const project = await options.store.getProject(parsed.projectId);
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const origin = request.headers.origin;
    if (origin && !project.allowedDomains.includes(origin)) {
      return reply.code(403).send({ error: "domain_not_allowed" });
    }

    const redactedUrl = redactUrl(parsed.url);
    const sanitized: EventBatch = {
      ...parsed,
      events: parsed.events.map((event) => ({
        ...event,
        urlPath: redactedUrl.urlPath,
        urlQueryRedacted: redactedUrl.urlQueryRedacted,
        metadata: redactMetadata(event.metadata),
      })),
    };

    await options.store.saveBatch(sanitized);
    return reply.code(202).send({ accepted: sanitized.events.length });
  });
}
```

Modify `apps/api/src/app.ts`:

```ts
import { registerIngestionRoutes } from "./routes/ingestion";

// inside createApp
app.register(registerIngestionRoutes, { store: options.store });
```

Modify `apps/api/src/store/memory-store.ts`:

```ts
async getSessionTimeline(projectId: string, sessionId: string): Promise<TraceEvent[]> {
  return (await this.listEvents(projectId)).filter((event) => event.sessionId === sessionId);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace @trace/api -- ingestion.test.ts admin.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/api
git commit -m "수집: 이벤트 배치 API 추가"
```

---

### Task 5: Rule-Based Friction Detection Engine

**Files:**
- Create: `apps/api/src/detection/url.ts`
- Create: `apps/api/src/detection/severity.ts`
- Create: `apps/api/src/detection/detect.ts`
- Create: `apps/api/src/detection/detect.test.ts`
- Modify: `apps/api/src/routes/ingestion.ts`

**Interfaces:**
- Consumes: `TraceEvent[]`, `Issue`.
- Produces: `detectIssues(input: { projectId: string; events: TraceEvent[]; now: string }): Issue[]`.

- [ ] **Step 1: Write failing detection tests**

Create `apps/api/src/detection/detect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@trace/shared";
import { detectIssues } from "./detect";

function click(partial: Partial<TraceEvent>): TraceEvent {
  return {
    eventId: partial.eventId ?? "evt",
    sessionId: partial.sessionId ?? "sess_1",
    pageId: "page_1",
    timestamp: partial.timestamp ?? "2026-08-24T00:00:00.000Z",
    type: partial.type ?? "click",
    urlPath: partial.urlPath ?? "/settings",
    elementSelectorHash: partial.elementSelectorHash ?? "button_hash",
    elementRole: "button",
    elementTextMaskedOrLimited: "권한 추가",
    metadata: partial.metadata ?? {},
  };
}

describe("detectIssues", () => {
  it("detects rage clicks on the same element within three seconds", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T00:00:05.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({ eventId: "evt_2", timestamp: "2026-08-24T00:00:01.000Z" }),
        click({ eventId: "evt_3", timestamp: "2026-08-24T00:00:02.000Z" }),
      ],
    });

    expect(issues[0]).toMatchObject({
      issueType: "rage_click",
      relatedUrlPath: "/settings",
      severityScore: 70,
    });
  });

  it("detects dead clicks when a click is followed by no response event", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T00:00:05.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({ eventId: "evt_2", type: "idle", timestamp: "2026-08-24T00:00:03.000Z", metadata: { durationMs: 3000 } }),
      ],
    });

    expect(issues.some((issue) => issue.issueType === "dead_click_cluster")).toBe(true);
  });

  it("detects long pause after a click", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T00:00:30.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({ eventId: "evt_2", type: "idle", timestamp: "2026-08-24T00:00:20.000Z", metadata: { durationMs: 20000 } }),
      ],
    });

    expect(issues.some((issue) => issue.issueType === "long_pause")).toBe(true);
  });

  it("detects error friction after a click", () => {
    const issues = detectIssues({
      projectId: "proj_1",
      now: "2026-08-24T00:00:05.000Z",
      events: [
        click({ eventId: "evt_1", timestamp: "2026-08-24T00:00:00.000Z" }),
        click({ eventId: "evt_2", type: "js_error", timestamp: "2026-08-24T00:00:04.000Z", metadata: { message: "TypeError" } }),
      ],
    });

    expect(issues.some((issue) => issue.issueType === "error_friction")).toBe(true);
  });
});
```

- [ ] **Step 2: Run detection tests to verify failure**

Run: `npm test --workspace @trace/api -- detect.test.ts`

Expected: FAIL because `./detect` does not exist.

- [ ] **Step 3: Implement severity and detection**

Create `apps/api/src/detection/severity.ts`:

```ts
export function clampSeverity(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreIssue(input: {
  base: number;
  affectedSessions: number;
  hasError?: boolean;
  repeatedClicks?: number;
}): number {
  return clampSeverity(
    input.base +
      input.affectedSessions * 8 +
      (input.repeatedClicks ?? 0) * 6 +
      (input.hasError ? 18 : 0),
  );
}
```

Create `apps/api/src/detection/detect.ts`:

```ts
import type { Issue, TraceEvent } from "@trace/shared";
import { scoreIssue } from "./severity";

interface DetectInput {
  projectId: string;
  events: TraceEvent[];
  now: string;
}

export function detectIssues(input: DetectInput): Issue[] {
  const events = [...input.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const issues: Issue[] = [];
  issues.push(...detectDeadClicks(input.projectId, events, input.now));
  issues.push(...detectRageClicks(input.projectId, events, input.now));
  issues.push(...detectLongPauses(input.projectId, events, input.now));
  issues.push(...detectErrorFriction(input.projectId, events, input.now));
  return dedupeIssues(issues);
}

function detectDeadClicks(projectId: string, events: TraceEvent[], now: string): Issue[] {
  return events
    .filter((event) => event.type === "click" && event.elementSelectorHash)
    .filter((event) => {
      const clickTime = Date.parse(event.timestamp);
      const response = events.find((candidate) => {
        const delta = Date.parse(candidate.timestamp) - clickTime;
        if (delta <= 0 || delta > 2000) return false;
        if (candidate.sessionId !== event.sessionId) return false;
        if (candidate.type === "page_view" || candidate.type === "custom_event") return true;
        if (candidate.type === "js_error" || candidate.type === "api_error") return true;
        return candidate.urlPath !== event.urlPath;
      });
      return !response;
    })
    .map((event) =>
      makeIssue({
        projectId,
        issueType: "dead_click_cluster",
        title: `${event.urlPath} 화면에서 반응 없는 클릭이 감지되었습니다`,
        summary: "클릭 후 2초 안에 화면 변화, 이벤트, 오류, URL 변경이 감지되지 않았습니다.",
        relatedUrlPath: event.urlPath,
        sessionIds: [event.sessionId],
        severityScore: scoreIssue({ base: 38, affectedSessions: 1 }),
        now,
      }),
    );
}

function detectRageClicks(projectId: string, events: TraceEvent[], now: string): Issue[] {
  const clicks = events.filter((event) => event.type === "click" && event.elementSelectorHash);
  const issues: Issue[] = [];

  for (let index = 0; index < clicks.length; index += 1) {
    const current = clicks[index];
    const cluster = clicks.filter((event) => {
      const delta = Math.abs(Date.parse(event.timestamp) - Date.parse(current.timestamp));
      return event.elementSelectorHash === current.elementSelectorHash && delta <= 3000;
    });

    if (cluster.length >= 3) {
      issues.push(makeIssue({
        projectId,
        issueType: "rage_click",
        title: `${current.urlPath} 화면에서 반복 클릭이 감지되었습니다`,
        summary: `${cluster.length}회 클릭이 3초 안에 같은 요소에서 발생했습니다.`,
        relatedUrlPath: current.urlPath,
        sessionIds: unique(cluster.map((event) => event.sessionId)),
        severityScore: scoreIssue({ base: 40, affectedSessions: unique(cluster.map((event) => event.sessionId)).length, repeatedClicks: cluster.length }),
        now,
      }));
    }
  }

  return issues;
}

function detectLongPauses(projectId: string, events: TraceEvent[], now: string): Issue[] {
  return events
    .filter((event) => event.type === "idle" && Number(event.metadata.durationMs ?? 0) >= 15000)
    .map((event) =>
      makeIssue({
        projectId,
        issueType: "long_pause",
        title: `${event.urlPath} 화면에서 긴 정지가 감지되었습니다`,
        summary: `${Math.round(Number(event.metadata.durationMs) / 1000)}초 동안 후속 행동이 없었습니다.`,
        relatedUrlPath: event.urlPath,
        sessionIds: [event.sessionId],
        severityScore: scoreIssue({ base: 35, affectedSessions: 1 }),
        now,
      }),
    );
}

function detectErrorFriction(projectId: string, events: TraceEvent[], now: string): Issue[] {
  return events
    .filter((event) => event.type === "js_error" || event.type === "api_error")
    .map((event) =>
      makeIssue({
        projectId,
        issueType: "error_friction",
        title: `${event.urlPath} 화면에서 오류 기반 막힘이 감지되었습니다`,
        summary: `사용자 행동 흐름 중 ${event.type} 이벤트가 발생했습니다.`,
        relatedUrlPath: event.urlPath,
        sessionIds: [event.sessionId],
        severityScore: scoreIssue({ base: 45, affectedSessions: 1, hasError: true }),
        now,
      }),
    );
}

function makeIssue(input: {
  projectId: string;
  issueType: Issue["issueType"];
  title: string;
  summary: string;
  relatedUrlPath: string;
  sessionIds: string[];
  severityScore: number;
  now: string;
}): Issue {
  return {
    issueId: `issue_${input.issueType}_${input.relatedUrlPath.replace(/[^a-z0-9]+/gi, "_")}`,
    projectId: input.projectId,
    issueType: input.issueType,
    title: input.title,
    summary: input.summary,
    affectedSessionsCount: input.sessionIds.length,
    affectedUsersCount: input.sessionIds.length,
    severityScore: input.severityScore,
    firstSeenAt: input.now,
    lastSeenAt: input.now,
    trend: "flat",
    relatedUrlPath: input.relatedUrlPath,
    exampleSessionIds: input.sessionIds.slice(0, 3),
    status: "new",
  };
}

function dedupeIssues(issues: Issue[]): Issue[] {
  return [...new Map(issues.map((issue) => [issue.issueId, issue])).values()];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
```

- [ ] **Step 4: Run detection tests**

Run: `npm test --workspace @trace/api -- detect.test.ts`

Expected: PASS.

- [ ] **Step 5: Call detection from ingestion**

Modify `apps/api/src/routes/ingestion.ts` after `saveBatch`:

```ts
import { detectIssues } from "../detection/detect";

// after saveBatch
const projectEvents = await options.store.listEvents(parsed.projectId);
const issues = detectIssues({
  projectId: parsed.projectId,
  events: projectEvents,
  now: new Date().toISOString(),
});
await options.store.upsertIssues(parsed.projectId, issues);
```

- [ ] **Step 6: Run API and detection tests**

Run: `npm test --workspace @trace/api`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/api/src/detection apps/api/src/routes/ingestion.ts
git commit -m "감지: 규칙 기반 막힘 이슈 생성 추가"
```

---

### Task 6: Admin API for Dashboard, Issues, and Session Timeline

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin.test.ts`
- Modify: `apps/api/src/store/memory-store.ts`

**Interfaces:**
- Consumes: `TraceStore.getDashboardSummary`, `TraceStore.listIssues`, `TraceStore.getIssue`, `TraceStore.getSessionTimeline`.
- Produces: `GET /api/projects/:id/summary`, `GET /api/projects/:id/issues`, `GET /api/issues/:id`, `GET /api/sessions/:id/timeline?projectId=...`.

- [ ] **Step 1: Add failing admin API tests**

Append to `apps/api/src/routes/admin.test.ts`:

```ts
it("returns dashboard summary, issues, issue detail, and session timeline", async () => {
  const store = new MemoryStore();
  const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
  await store.saveBatch({
    projectId: project.projectId,
    anonymousUserId: "anon_1",
    sessionId: "sess_1",
    sentAt: "2026-08-24T00:00:03.000Z",
    sdkVersion: "0.1.0",
    url: "https://demo.example.com/settings",
    events: [
      {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-08-24T00:00:00.000Z",
        type: "click",
        urlPath: "/settings",
        elementSelectorHash: "button_hash",
        metadata: {},
      },
    ],
  });
  await store.upsertIssues(project.projectId, [
    {
      issueId: "issue_1",
      projectId: project.projectId,
      issueType: "rage_click",
      title: "설정 화면에서 반복 클릭",
      summary: "같은 버튼을 반복 클릭했습니다.",
      affectedSessionsCount: 1,
      affectedUsersCount: 1,
      severityScore: 70,
      firstSeenAt: "2026-08-24T00:00:00.000Z",
      lastSeenAt: "2026-08-24T00:00:00.000Z",
      trend: "flat",
      relatedUrlPath: "/settings",
      exampleSessionIds: ["sess_1"],
      status: "new",
    },
  ]);
  const app = createApp({ store });

  expect((await app.inject(`/api/projects/${project.projectId}/summary`)).statusCode).toBe(200);
  expect((await app.inject(`/api/projects/${project.projectId}/issues`)).json()[0].issueId).toBe("issue_1");
  expect((await app.inject(`/api/issues/issue_1`)).json().title).toBe("설정 화면에서 반복 클릭");
  expect((await app.inject(`/api/sessions/sess_1/timeline?projectId=${project.projectId}`)).json()[0].eventId).toBe("evt_1");
});
```

- [ ] **Step 2: Run admin tests to verify failure**

Run: `npm test --workspace @trace/api -- admin.test.ts`

Expected: FAIL because the GET routes do not exist.

- [ ] **Step 3: Implement admin GET routes**

Append inside `registerAdminRoutes`:

```ts
app.get("/api/projects/:projectId/summary", async (request, reply) => {
  const params = z.object({ projectId: z.string() }).parse(request.params);
  const project = await options.store.getProject(params.projectId);
  if (!project) return reply.code(404).send({ error: "project_not_found" });
  return options.store.getDashboardSummary(params.projectId);
});

app.get("/api/projects/:projectId/issues", async (request, reply) => {
  const params = z.object({ projectId: z.string() }).parse(request.params);
  const project = await options.store.getProject(params.projectId);
  if (!project) return reply.code(404).send({ error: "project_not_found" });
  return options.store.listIssues(params.projectId);
});

app.get("/api/issues/:issueId", async (request, reply) => {
  const params = z.object({ issueId: z.string() }).parse(request.params);
  const issue = await options.store.getIssue(params.issueId);
  if (!issue) return reply.code(404).send({ error: "issue_not_found" });
  return issue;
});

app.get("/api/sessions/:sessionId/timeline", async (request, reply) => {
  const params = z.object({ sessionId: z.string() }).parse(request.params);
  const query = z.object({ projectId: z.string() }).parse(request.query);
  return options.store.getSessionTimeline(query.projectId, params.sessionId);
});
```

- [ ] **Step 4: Run admin tests**

Run: `npm test --workspace @trace/api -- admin.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts apps/api/src/store/memory-store.ts
git commit -m "관리자: 요약과 이슈 조회 API 추가"
```

---

### Task 7: Browser SDK Core Collection

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/vitest.config.ts`
- Create: `packages/sdk/src/dom.ts`
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/collectors.ts`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/src/dom.test.ts`
- Create: `packages/sdk/src/client.test.ts`

**Interfaces:**
- Consumes: `EventBatch`, `TraceEvent`, `redactText`, `redactUrl`, `redactMetadata`, `isSensitiveField`.
- Produces: browser global `window.trace`, `init(options)`, `track(name, metadata)`, `consent.grant()`, `consent.deny()`.

- [ ] **Step 1: Write failing DOM tests**

Create `packages/sdk/src/dom.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getElementMetadata } from "./dom";

describe("getElementMetadata", () => {
  it("returns safe button metadata", () => {
    document.body.innerHTML = `<button id="invite">멤버 초대</button>`;
    const button = document.querySelector("button")!;
    expect(getElementMetadata(button)).toMatchObject({
      elementRole: "button",
      elementTextMaskedOrLimited: "멤버 초대",
    });
  });

  it("does not expose input values", () => {
    document.body.innerHTML = `<input id="email" type="email" value="choi@example.com" />`;
    const input = document.querySelector("input")!;
    expect(getElementMetadata(input)).toMatchObject({
      elementTextMaskedOrLimited: undefined,
    });
  });
});
```

- [ ] **Step 2: Write failing client tests**

Create `packages/sdk/src/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { TraceClient } from "./client";

describe("TraceClient", () => {
  it("does not send events when consent is denied", async () => {
    const fetcher = vi.fn();
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "denied",
    });

    client.track("report_export_clicked", { email: "choi@example.com" });
    await client.flush();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("redacts custom metadata and sends a batch when consent is granted", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    client.track("report_export_clicked", { email: "choi@example.com" });
    await client.flush();

    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.events[0].metadata).toEqual({
      name: "report_export_clicked",
      email: "[redacted]",
    });
    expect(payload.events[0].sessionId).toBe(payload.sessionId);
  });
});
```

- [ ] **Step 3: Create SDK manifest**

Create package files matching Task 1 patterns, with browser test environment:

```json
{
  "name": "@trace/sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@trace/shared": "0.1.0",
    "nanoid": "^5.0.9"
  },
  "devDependencies": {
    "jsdom": "^25.0.1",
    "vitest": "^2.1.9"
  }
}
```

Create `packages/sdk/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 4: Run SDK tests to verify failure**

Run: `npm test --workspace @trace/sdk`

Expected: FAIL because SDK modules do not exist.

- [ ] **Step 5: Implement DOM metadata**

Create `packages/sdk/src/dom.ts`:

```ts
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

  return {
    elementSelectorHash: hashSelector(selector),
    elementRole: role,
    elementTextMaskedOrLimited: sensitive ? undefined : redactText((element.textContent ?? element.getAttribute("aria-label") ?? "").trim()),
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
```

- [ ] **Step 6: Implement SDK client**

Create `packages/sdk/src/client.ts`:

```ts
import { nanoid } from "nanoid";
import { redactMetadata, redactUrl } from "@trace/shared";
import type { EventBatch, TraceEvent } from "@trace/shared";

type Consent = "granted" | "denied" | "pending";
type Fetcher = typeof fetch;

export interface TraceClientOptions {
  projectId: string;
  endpoint: string;
  fetcher?: Fetcher;
  consent?: Consent;
}

export class TraceClient {
  private readonly projectId: string;
  private readonly endpoint: string;
  private readonly fetcher: Fetcher;
  private consent: Consent;
  private readonly anonymousUserId = `anon_${nanoid(10)}`;
  private readonly sessionId = `sess_${nanoid(10)}`;
  private readonly pageId = `page_${nanoid(10)}`;
  private queue: TraceEvent[] = [];

  constructor(options: TraceClientOptions) {
    this.projectId = options.projectId;
    this.endpoint = options.endpoint;
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.consent = options.consent ?? "pending";
  }

  grantConsent() {
    this.consent = "granted";
  }

  denyConsent() {
    this.consent = "denied";
    this.queue = [];
  }

  track(name: string, metadata: Record<string, unknown> = {}) {
    this.enqueue(this.createEvent({
      eventId: `evt_${nanoid(10)}`,
      type: "custom_event",
      urlPath: currentRedactedUrl().urlPath,
      urlQueryRedacted: currentRedactedUrl().urlQueryRedacted,
      metadata: redactMetadata({ name, ...metadata }),
    }));
  }

  createEvent(event: Omit<TraceEvent, "sessionId" | "pageId" | "timestamp"> & { timestamp?: string }): TraceEvent {
    return {
      ...event,
      sessionId: this.sessionId,
      pageId: this.pageId,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
  }

  enqueue(event: TraceEvent) {
    if (this.consent !== "granted") return;
    this.queue.push(event);
  }

  async flush() {
    if (this.consent !== "granted" || this.queue.length === 0) return;
    const redactedUrl = currentRedactedUrl();
    const batch: EventBatch = {
      projectId: this.projectId,
      anonymousUserId: this.anonymousUserId,
      sessionId: this.sessionId,
      sentAt: new Date().toISOString(),
      sdkVersion: "0.1.0",
      url: window.location.href,
      events: this.queue.splice(0, 100).map((event) => ({
        ...event,
        urlPath: event.urlPath || redactedUrl.urlPath,
        urlQueryRedacted: event.urlQueryRedacted ?? redactedUrl.urlQueryRedacted,
      })),
    };

    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
      keepalive: true,
    });

    if (!response.ok) this.queue.unshift(...batch.events);
  }
}

function currentRedactedUrl() {
  return redactUrl(window.location.href);
}
```

Create `packages/sdk/src/index.ts` exposing global API:

```ts
import { TraceClient } from "./client";
import { installCollectors } from "./collectors";

let client: TraceClient | undefined;

export function init(options: { projectId: string; endpoint?: string; consent?: "granted" | "denied" | "pending" }) {
  client = new TraceClient({
    projectId: options.projectId,
    endpoint: options.endpoint ?? "/v1/events/batch",
    consent: options.consent ?? "pending",
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
}
```

Create `packages/sdk/src/collectors.ts` with minimal page/click/error collection:

```ts
import type { TraceClient } from "./client";
import { getElementMetadata } from "./dom";

export function installCollectors(client: TraceClient) {
  client.enqueue(client.createEvent({
    eventId: crypto.randomUUID(),
    type: "page_view",
    urlPath: window.location.pathname,
    urlQueryRedacted: "",
    metadata: {},
  }));

  window.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const metadata = getElementMetadata(event.target);
    client.enqueue(client.createEvent({
      eventId: crypto.randomUUID(),
      type: "click",
      urlPath: window.location.pathname,
      ...metadata,
      x: event.clientX,
      y: event.clientY,
      viewportX: window.innerWidth,
      viewportY: window.innerHeight,
      metadata: {},
    }));
  });

  window.addEventListener("error", (event) => {
    client.enqueue(client.createEvent({
      eventId: crypto.randomUUID(),
      type: "js_error",
      urlPath: window.location.pathname,
      metadata: { message: event.message },
    }));
  });
}
```

- [ ] **Step 7: Run SDK tests**

Run: `npm test --workspace @trace/sdk`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add packages/sdk
git commit -m "SDK: 브라우저 이벤트 수집 기본 구현"
```

---

### Task 8: Admin React Dashboard

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/vitest.config.ts`
- Create: `apps/admin/index.html`
- Create: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/api.ts`
- Create: `apps/admin/src/App.tsx`
- Create: `apps/admin/src/pages/DashboardPage.tsx`
- Create: `apps/admin/src/pages/IssueDetailPage.tsx`
- Create: `apps/admin/src/components/MetricStrip.tsx`
- Create: `apps/admin/src/components/FrictionTrendChart.tsx`
- Create: `apps/admin/src/components/IssueTypeChart.tsx`
- Create: `apps/admin/src/components/IssueTable.tsx`
- Create: `apps/admin/src/components/SessionTimeline.tsx`
- Create: `apps/admin/src/styles.css`
- Create: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes: Admin API endpoints from Task 6.
- Produces: 관리자 페이지 showing metrics, charts, issue inbox, issue detail, session timeline.

- [ ] **Step 1: Write failing admin UI test**

Create `apps/admin/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./api", () => ({
  getDashboardData: async () => ({
    summary: {
      frictionScore: 82,
      affectedSessionsCount: 312,
      newIssuesCount: 14,
      resolvedOrIgnoredIssuesCount: 6,
      insight: "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다.",
      trend: [{ date: "2026-08-24", score: 82 }],
      issueTypeDistribution: [{ issueType: "rage_click", count: 4 }],
      topTargets: [{ label: "/settings", count: 42 }],
    },
    issues: [
      {
        issueId: "issue_1",
        projectId: "proj_demo",
        issueType: "rage_click",
        title: "설정 화면에서 반복 클릭",
        summary: "같은 버튼을 반복 클릭했습니다.",
        affectedSessionsCount: 42,
        affectedUsersCount: 42,
        severityScore: 82,
        firstSeenAt: "2026-08-24T00:00:00.000Z",
        lastSeenAt: "2026-08-24T00:00:00.000Z",
        trend: "up",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
      },
    ],
  }),
}));

describe("App", () => {
  it("renders dashboard metrics and problem inbox", async () => {
    render(<App />);
    expect(await screen.findByText("문제 인박스")).toBeInTheDocument();
    expect(await screen.findByText("막힘 점수")).toBeInTheDocument();
    expect(await screen.findByText("설정 화면에서 반복 클릭")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Create admin manifest**

Create `apps/admin/package.json`:

```json
{
  "name": "@trace/admin",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@trace/shared": "0.1.0",
    "@vitejs/plugin-react": "^4.3.4",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.15.0",
    "vite": "^6.0.7"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.3",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 3: Run admin UI test to verify failure**

Run: `npm test --workspace @trace/admin`

Expected: FAIL because `App` does not exist.

- [ ] **Step 4: Implement admin API client**

Create `apps/admin/src/api.ts`:

```ts
import type { DashboardSummary, Issue, SessionTimelineEvent } from "@trace/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const PROJECT_ID = import.meta.env.VITE_PROJECT_ID ?? "proj_demo";

export async function getDashboardData(): Promise<{ summary: DashboardSummary; issues: Issue[] }> {
  const [summary, issues] = await Promise.all([
    fetch(`${API_BASE}/api/projects/${PROJECT_ID}/summary`).then((response) => response.json()),
    fetch(`${API_BASE}/api/projects/${PROJECT_ID}/issues`).then((response) => response.json()),
  ]);
  return { summary, issues };
}

export async function getIssueDetail(issueId: string): Promise<Issue> {
  return fetch(`${API_BASE}/api/issues/${issueId}`).then((response) => response.json());
}

export async function getSessionTimeline(projectId: string, sessionId: string): Promise<SessionTimelineEvent[]> {
  return fetch(`${API_BASE}/api/sessions/${sessionId}/timeline?projectId=${projectId}`).then((response) => response.json());
}
```

- [ ] **Step 5: Implement dashboard components**

Create `apps/admin/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { DashboardSummary, Issue } from "@trace/shared";
import { getDashboardData } from "./api";
import { DashboardPage } from "./pages/DashboardPage";
import "./styles.css";

export function App() {
  const [data, setData] = useState<{ summary: DashboardSummary; issues: Issue[] }>();

  useEffect(() => {
    getDashboardData().then(setData);
  }, []);

  if (!data) return <main className="app-shell">불러오는 중</main>;
  return <DashboardPage summary={data.summary} issues={data.issues} />;
}
```

Create components that render exact Korean labels:

```tsx
// MetricStrip.tsx
import type { DashboardSummary } from "@trace/shared";

export function MetricStrip({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="metric-strip" aria-label="핵심 지표">
      <div><span>막힘 점수</span><strong>{summary.frictionScore}</strong></div>
      <div><span>영향 세션</span><strong>{summary.affectedSessionsCount}</strong></div>
      <div><span>신규 이슈</span><strong>{summary.newIssuesCount}</strong></div>
      <div><span>처리됨</span><strong>{summary.resolvedOrIgnoredIssuesCount}</strong></div>
    </section>
  );
}
```

Use `recharts` for `FrictionTrendChart` and `IssueTypeChart`. Labels must be Korean: `기간별 막힘 추세`, `이슈 유형 분포`.

Create `DashboardPage.tsx`:

```tsx
import type { DashboardSummary, Issue } from "@trace/shared";
import { FrictionTrendChart } from "../components/FrictionTrendChart";
import { IssueTable } from "../components/IssueTable";
import { IssueTypeChart } from "../components/IssueTypeChart";
import { MetricStrip } from "../components/MetricStrip";

export function DashboardPage({ summary, issues }: { summary: DashboardSummary; issues: Issue[] }) {
  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>문제 인박스</h1>
        </div>
      </header>
      <MetricStrip summary={summary} />
      <section className="insight">{summary.insight}</section>
      <section className="chart-grid">
        <FrictionTrendChart data={summary.trend} />
        <IssueTypeChart data={summary.issueTypeDistribution} />
      </section>
      <IssueTable issues={issues} />
    </main>
  );
}
```

- [ ] **Step 6: Run admin UI tests**

Run: `npm test --workspace @trace/admin`

Expected: PASS.

- [ ] **Step 7: Run build**

Run: `npm run build --workspace @trace/admin`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/admin
git commit -m "관리자: 문제 인박스 대시보드 추가"
```

---

### Task 9: Demo Site, README, and End-to-End Verification

**Files:**
- Create: `examples/demo-site/index.html`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: API server from Task 6, SDK from Task 7, Admin app from Task 8.
- Produces: local demo workflow showing script installation, event collection, issue generation, and admin dashboard.

- [ ] **Step 1: Create demo site**

Create `examples/demo-site/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trace Demo SaaS</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 40px; color: #17202a; }
      button { padding: 10px 14px; margin-right: 8px; }
      .panel { max-width: 720px; border: 1px solid #d9e1ea; padding: 24px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>설정</h1>
      <p>반복 클릭과 오류 감지를 확인하는 데모 화면입니다.</p>
      <button id="dead-click">권한 추가</button>
      <button onclick="window.trace?.track('report_export_clicked')">리포트 내보내기</button>
      <button onclick="throw new Error('Demo error')">오류 발생</button>
    </main>
    <script type="module">
      import { init } from "../../packages/sdk/src/index.ts";
      init({
        projectId: "proj_demo",
        endpoint: "http://localhost:4000/v1/events/batch",
        consent: "granted"
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Add README instructions**

Replace `README.md` with:

```md
# trace

사용자 행동 분석/통계 제품 MVP입니다. SaaS 제품 운영자가 사용자의 막힘 지점을 관리자 페이지에서 통계, 차트, 세션 타임라인으로 확인할 수 있게 합니다.

## 실행

```bash
npm install
npm test
npm run dev:api
npm run dev:admin
```

## MVP 1차 범위

- 브라우저 SDK 이벤트 수집
- 수집 API
- private by default 마스킹
- 규칙 기반 막힘 감지
- 문제 인박스
- 홈 요약 통계와 차트
- 문제 상세와 세션 타임라인

## 스펙과 계획

- 설계: `docs/superpowers/specs/2026-08-24-trace-mvp-design.md`
- 구현 계획: `docs/superpowers/plans/2026-08-24-trace-mvp-implementation.md`
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: both PASS.

- [ ] **Step 4: Manual local verification**

Run in separate terminals:

```bash
npm run dev:api
npm run dev:admin
```

Open the admin URL printed by Vite. Confirm:

- 관리자 화면 title is `문제 인박스`.
- Metrics show `막힘 점수`, `영향 세션`, `신규 이슈`, `처리됨`.
- Trend and issue type charts render.
- Issue table renders at least an empty state or seeded issue data.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md examples/demo-site package.json
git commit -m "문서: 로컬 데모와 실행 방법 추가"
```

---

## Plan Self-Review

**Spec coverage:**

- JavaScript SDK: Task 7.
- 자동 행동 수집: Task 7.
- `track()` 명시 이벤트: Task 7.
- 기본 마스킹/민감정보 미수집: Task 2, Task 4, Task 7.
- dead click/rage click/오래 정지/오류 감지: Task 5.
- 문제 인박스/통계/차트: Task 8.
- 문제 상세/세션 타임라인: Task 6, Task 8.
- 실제 수집 API: Task 4.
- PostgreSQL schema: Task 3.
- 리플레이 확장 경계: Task 1, Task 3, Task 7 preserve `sessionId`, `pageId`, `timestamp`, `selector_hash`, `viewport`.

**Completeness scan:**

- The plan avoids deferred labels and unspecified "handle edge cases" language.
- The plan has no deferred implementation notes that ask the executor to decide missing behavior.

**Type consistency:**

- `TraceEvent.sessionId` is required by Task 1 before API/session timeline work.
- `DashboardSummary` fields used by API and admin match Task 1 schema.
- `issueType` values used in API/admin match Task 1 schema.
