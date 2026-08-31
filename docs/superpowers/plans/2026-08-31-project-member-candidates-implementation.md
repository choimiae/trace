# Project Member Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 설정 화면에서 owner가 기존 admin user를 이름/이메일로 검색하고, 이미 멤버인 사용자는 상태만 확인한 뒤, 아직 멤버가 아닌 사용자만 선택해 기존 멤버 추가 API로 추가할 수 있게 한다.

**Architecture:** admin user 검색은 Store의 새 조회 계약 하나로 내리고, membership 합성은 Admin BFF가 기존 `listProjectMemberships`와 합쳐 수행한다. 최종 추가는 기존 `POST /members`를 그대로 재사용하므로 중복 방어, CSRF, audit log 흐름은 바뀌지 않는다. Admin UI는 검색어만 `ProjectSettingsPage` local state로 갖고, 후보 목록과 선택 상태는 `App.tsx` settings 상태가 소유한다.

**Tech Stack:** TypeScript, Fastify, Zod, better-sqlite3, React, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-08-31-project-member-candidates-design.md`

## Global Constraints

- 기본 커뮤니케이션, 사용자-facing copy, commit message는 한국어를 사용한다.
- 검색 대상은 기존 `admin_users`에 존재하는 사용자로 제한한다. admin user 생성이나 초대는 만들지 않는다.
- 검색 결과에는 이미 프로젝트 멤버인 사용자도 포함하고, 상태만 표시하고 선택은 막는다.
- 후보 검색과 멤버 추가는 `owner`만 수행할 수 있다.
- 후보 검색은 조회 API이므로 CSRF를 요구하지 않는다.
- 최종 추가는 기존 `POST /admin/api/projects/:projectId/members`를 사용한다. 새 추가 경로를 만들지 않는다.
- 역할 select는 `admin`, `viewer`만 제공한다. 기본값은 `viewer`이다.
- DB schema 변경은 없다.
- 기존 멤버 목록 응답 shape와 기존 멤버 추가/변경/제거 route는 바꾸지 않는다.
- 검색 입력에 debounce를 넣지 않는다. 늦은 응답은 request id와 settings session guard로 무시한다.

---

## File Structure

- `apps/api/src/store/types.ts`: `TraceStore`에 `searchAdminUsers` 조회 계약을 추가한다.
- `apps/api/src/store/memory-store.ts`: array filter/sort/slice로 검색 계약을 구현한다.
- `apps/api/src/store/sqlite-store.ts`: row → `AdminUserRecord` 변환을 helper로 추출하고 `LIKE` 검색 쿼리를 추가한다.
- `apps/api/src/store/store-contract.test.ts`: MemoryStore와 SqliteStore 공통 계약으로 검색을 검증한다.
- `apps/api/src/routes/admin.ts`: 후보 검색 query schema를 추가한다.
- `apps/api/src/routes/admin-proxy.ts`: `GET /admin/api/projects/:projectId/member-candidates` route와 `ProjectResourceType` 항목을 추가한다.
- `apps/api/src/routes/admin.test.ts`: 후보 검색 권한, 정렬, membership 합성, limit 검증을 검증한다.
- `apps/admin/src/api.ts`: `ProjectMemberCandidateResponse` 타입과 `searchProjectMemberCandidates` client 함수를 추가한다.
- `apps/admin/src/pages/ProjectSettingsPage.tsx`: 이메일 input을 검색 입력과 후보 목록, 선택 요약으로 바꾼다.
- `apps/admin/src/pages/ProjectSettingsPage.test.tsx`: 기존 이메일 기반 추가 테스트를 후보 선택 기반으로 이관하고 새 케이스를 추가한다.
- `apps/admin/src/pages/pages.css`: 후보 목록과 선택 요약 스타일을 추가한다.
- `apps/admin/src/App.tsx`: settings 상태에 후보 목록/선택/검색 상태를 추가하고 진입 시 검색 effect와 검색/선택 handler를 추가한다.
- `apps/admin/src/App.test.tsx`: api mock에 검색 함수를 등록하고, 기존 이메일 기반 테스트를 이관하고 상태 전이 케이스를 추가한다.

---

### Task 1: Store Admin User Search Contract

**Files:**
- Modify: `apps/api/src/store/types.ts`
- Modify: `apps/api/src/store/memory-store.ts`
- Modify: `apps/api/src/store/sqlite-store.ts`
- Test: `apps/api/src/store/store-contract.test.ts`

**Interfaces:**
- Consumes: existing `AdminUserRecord`, `TraceStore.upsertAdminUserFromGoogle`.
- Produces:

```ts
searchAdminUsers(input: {
  query: string;
  limit: number;
}): Promise<AdminUserRecord[]>;
```

- 계약: `query`는 호출자가 trim한 문자열이다. 빈 query면 이메일 오름차순 첫 `limit`개를 반환한다. query가 있으면 email 또는 name에 case-insensitive 부분 일치하는 사용자를 이메일 오름차순으로 최대 `limit`개 반환한다.

- [ ] **Step 1: Write failing store contract tests**

`apps/api/src/store/store-contract.test.ts`의 `describeTraceStoreContract` 안, 기존 admin user 테스트 근처에 추가한다. 기존 `open()`과 `upsertAdminUserFromGoogle` 패턴을 그대로 쓴다.

```ts
it("빈 검색어는 이메일 오름차순으로 limit 만큼 반환한다", async () => {
  const store = open();
  await store.upsertAdminUserFromGoogle({
    googleSub: "search_c",
    email: "carol@example.com",
    emailVerified: true,
    name: "Carol",
    now: "2026-08-31T00:00:00.000Z",
  });
  await store.upsertAdminUserFromGoogle({
    googleSub: "search_a",
    email: "alice@example.com",
    emailVerified: true,
    name: "Alice",
    now: "2026-08-31T00:00:01.000Z",
  });
  await store.upsertAdminUserFromGoogle({
    googleSub: "search_b",
    email: "bob@example.com",
    emailVerified: true,
    now: "2026-08-31T00:00:02.000Z",
  });

  const all = await store.searchAdminUsers({ query: "", limit: 20 });
  expect(all.map((user) => user.email)).toEqual([
    "alice@example.com",
    "bob@example.com",
    "carol@example.com",
  ]);

  const limited = await store.searchAdminUsers({ query: "", limit: 2 });
  expect(limited.map((user) => user.email)).toEqual(["alice@example.com", "bob@example.com"]);
});
```

이어서 다음 이름과 단언으로 테스트를 추가한다.

```ts
it("이메일 부분 검색은 대소문자를 구분하지 않는다", async () => {
  // alice@example.com, bob@other.example.com 을 만든다.
  // searchAdminUsers({ query: "OTHER", limit: 20 }) 가 bob 만 반환한다.
  // searchAdminUsers({ query: "alice", limit: 20 }) 와 { query: "ALICE" } 결과가 같다.
});

it("이름 부분 검색은 대소문자를 구분하지 않는다", async () => {
  // name "Alice Kim" 과 name 없는 사용자를 만든다.
  // searchAdminUsers({ query: "kim", limit: 20 }) 가 Alice Kim 만 반환한다.
});

it("이름이 없는 사용자도 이메일 검색으로 찾는다", async () => {
  // name 을 넘기지 않은 사용자를 만든다.
  // 이메일 일부로 검색하면 그 사용자가 반환된다.
  // 반환된 record 에 name 키가 없다.
});

it("검색어가 아무것도 일치하지 않으면 빈 배열을 반환한다", async () => {
  // 사용자 한 명을 만들고 존재하지 않는 검색어로 조회한다.
  // 결과가 [] 이다.
});

it("검색 결과도 이메일 오름차순이고 limit이 적용된다", async () => {
  // 이메일에 공통 문자열을 가진 사용자 3명을 역순으로 만든다.
  // { query: 공통문자열, limit: 2 } 가 이메일 오름차순 앞 2명을 반환한다.
});
```

- [ ] **Step 2: Run store tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts
```

Expected: FAIL because `TraceStore`와 두 구현에 `searchAdminUsers`가 없다.

- [ ] **Step 3: Add the TraceStore signature**

`apps/api/src/store/types.ts`에서 `getAdminUserByEmail` 바로 다음에 추가한다.

```ts
  searchAdminUsers(input: { query: string; limit: number }): Promise<AdminUserRecord[]>;
```

- [ ] **Step 4: Implement MemoryStore search**

`apps/api/src/store/memory-store.ts`에서 `getAdminUserByEmail` 다음에 추가한다. `adminUsers`는 googleSub 기준 Map이므로 값만 훑는다.

```ts
  async searchAdminUsers(input: { query: string; limit: number }): Promise<AdminUserRecord[]> {
    const needle = input.query.toLowerCase();
    return [...this.adminUsers.values()]
      .filter((user) => {
        if (needle === "") return true;
        if (user.email.toLowerCase().includes(needle)) return true;
        return user.name !== undefined && user.name.toLowerCase().includes(needle);
      })
      .sort((left, right) => left.email.localeCompare(right.email))
      .slice(0, input.limit);
  }
```

- [ ] **Step 5: Extract the SQLite admin user row mapper**

`apps/api/src/store/sqlite-store.ts`의 `getAdminUser`와 `getAdminUserByEmail`이 같은 `compact({...}) as AdminUserRecord` 변환을 각각 중복하고 있다. 세 번째 조회가 추가되기 전에 helper를 먼저 뽑고 기존 두 메서드를 그 helper로 바꾼다.

```ts
  private toAdminUserRecord(row: Row): AdminUserRecord {
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
```

`getAdminUser`와 `getAdminUserByEmail`은 `return row ? this.toAdminUserRecord(row) : undefined` 형태로 줄인다. 이 추출만으로 기존 테스트는 계속 통과해야 한다.

- [ ] **Step 6: Implement SQLite search**

`getAdminUserByEmail` 다음에 추가한다. `name`은 nullable 컬럼이므로 `COALESCE`로 감싼다. 감싸지 않으면 name이 NULL인 행에서 `LOWER(name) LIKE ?`가 NULL이 되어 OR 판정이 흐려진다.

```ts
  async searchAdminUsers(input: { query: string; limit: number }): Promise<AdminUserRecord[]> {
    const needle = input.query.toLowerCase();
    const rows = needle === ""
      ? (this.db
          .prepare(`SELECT * FROM admin_users ORDER BY email ASC LIMIT ?`)
          .all(input.limit) as Row[])
      : (this.db
          .prepare(
            `SELECT * FROM admin_users
             WHERE LOWER(email) LIKE ? OR LOWER(COALESCE(name, '')) LIKE ?
             ORDER BY email ASC LIMIT ?`,
          )
          .all(`%${needle}%`, `%${needle}%`, input.limit) as Row[]);

    return rows.map((row) => this.toAdminUserRecord(row));
  }
```

- [ ] **Step 7: Run store tests and verify pass**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/store/store-contract.test.ts
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS for both stores.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/store
git commit -m "관리자: 관리자 사용자 검색 스토어 계약 추가"
```

---

### Task 2: Admin API Member Candidates Route

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin-proxy.ts`
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: Task 1 `TraceStore.searchAdminUsers`, existing `getProjectAccess`, `listProjectMemberships`.
- Produces:
  - `GET /admin/api/projects/:projectId/member-candidates`
  - export `memberCandidateSearchSchema`
  - response item shape `{ adminUserId, email, name?, membership?: { role } }`

- [ ] **Step 1: Write failing API tests**

`apps/api/src/routes/admin.test.ts`에 기존 멤버 목록/추가 테스트 근처로 추가한다. 기존 `signedInStore()`, `createApp`, cookie 패턴을 그대로 쓴다.

```ts
it("owner 는 빈 검색어로 관리자 사용자 후보를 조회한다", async () => {
  // signedInStore() 로 owner 를 만들고 프로젝트와 owner membership 을 만든다.
  // 프로젝트 멤버가 아닌 admin user 한 명을 store 에 추가한다.
  // GET /admin/api/projects/:projectId/member-candidates 를 호출한다.
  // 200 이고 응답이 이메일 오름차순이다.
  // owner 항목은 membership: { role: "owner" } 를 갖는다.
  // 멤버가 아닌 항목은 membership 키가 없다.
});

it("owner 는 이메일 검색어로 후보를 검색한다", async () => {
  // 서로 다른 이메일 도메인의 admin user 두 명을 만든다.
  // ?query= 한쪽 도메인 일부 로 호출한다.
  // 200 이고 일치하는 사용자만 반환된다.
});

it("owner 는 이름 검색어로 후보를 검색한다", async () => {
  // name 이 있는 admin user 를 만든다.
  // ?query= 이름 일부 로 호출한다.
  // 200 이고 그 사용자가 반환된다.
});

it("검색어에 공백과 대소문자가 섞여도 정규화해서 검색한다", async () => {
  // ?query=%20%20ALICE%20%20 형태로 호출한다.
  // 200 이고 alice 사용자가 반환된다.
});
```

거부 케이스는 body까지 단언한다.

```ts
expect(response.statusCode).toBe(403);
expect(response.json()).toEqual({ error: "project_role_forbidden" });
```

Cover:
- admin 요청자는 `403 project_role_forbidden`
- viewer 요청자는 `403 project_role_forbidden`
- 프로젝트 멤버가 아닌 요청자는 `403 project_access_denied`
- 없는 프로젝트는 `404 project_not_found`
- 세션 쿠키 없이 호출하면 `401 admin_auth_required`
- `?limit=0`, `?limit=51`, `?limit=abc`는 `400 invalid_member_candidate_search`
- `?limit=1`은 200이고 결과가 1건이다

프로젝트 멤버가 아닌 요청자 케이스에서는 `project.access_denied` audit log가 `resourceType: "project_member_candidates"`로 남는 것도 함께 단언한다.

- [ ] **Step 2: Run API tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts
```

Expected: FAIL with 404 for the new endpoint.

- [ ] **Step 3: Add the query schema**

`apps/api/src/routes/admin.ts`에 추가한다. query string은 항상 문자열로 들어오므로 `coerce`로 숫자로 바꾸고 정수/범위를 강제한다.

```ts
export const memberCandidateSearchSchema = z.object({
  query: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
```

- [ ] **Step 4: Add the resource type**

`apps/api/src/routes/admin-proxy.ts`의 `ProjectResourceType` union에 항목을 추가한다.

```ts
  | "project_member_candidates"
```

- [ ] **Step 5: Add the route**

`apps/api/src/routes/admin-proxy.ts`에서 `GET .../members` 다음, `POST .../members` 앞에 추가한다. `memberCandidateSearchSchema`를 import에 더한다. 조회 API이므로 CSRF 검증은 넣지 않는다.

```ts
  app.get("/admin/api/projects/:projectId/member-candidates", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_member_candidates");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
    if (access.membership.role !== "owner") {
      return reply.code(403).send({ error: "project_role_forbidden" });
    }

    const parsed = memberCandidateSearchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_member_candidate_search" });

    const [users, memberships] = await Promise.all([
      options.store.searchAdminUsers(parsed.data),
      options.store.listProjectMemberships(projectId),
    ]);
    const roleByAdminUserId = new Map(
      memberships.map((membership) => [membership.adminUserId, membership.role]),
    );

    return users.map((user) => {
      const candidate: ProjectMemberCandidateResponse = {
        adminUserId: user.adminUserId,
        email: user.email,
      };
      if (user.name !== undefined) candidate.name = user.name;
      const role = roleByAdminUserId.get(user.adminUserId);
      if (role !== undefined) candidate.membership = { role };
      return candidate;
    });
  });
```

권한 검사를 schema 검증보다 먼저 두는 순서를 유지한다. owner가 아닌 요청자에게 `limit` 검증 결과를 흘리지 않는다.

- [ ] **Step 6: Add the response type**

`apps/api/src/routes/admin-proxy.ts`의 `ProjectMemberResponse` 타입 근처에 추가한다.

```ts
type ProjectMemberCandidateResponse = {
  adminUserId: string;
  email: string;
  name?: string;
  membership?: { role: AdminRole };
};
```

- [ ] **Step 7: Run API tests and typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/routes/admin.test.ts
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes
git commit -m "관리자: 프로젝트 멤버 후보 검색 API 추가"
```

---

### Task 3: Admin API Client and Candidate Selection UI

**Files:**
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/pages/ProjectSettingsPage.tsx`
- Modify: `apps/admin/src/pages/pages.css`
- Test: `apps/admin/src/pages/ProjectSettingsPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 `GET /admin/api/projects/:projectId/member-candidates`, existing `AddProjectMemberInput`, existing `onAddMember` prop.
- Produces:

```ts
export interface ProjectMemberCandidateResponse {
  adminUserId: string;
  email: string;
  name?: string;
  membership?: { role: ProjectRole };
}

export async function searchProjectMemberCandidates(
  projectId: string,
  query: string,
): Promise<ProjectMemberCandidateResponse[]>;
```

- `ProjectSettingsPage` 추가 props:

```ts
memberCandidates: ProjectMemberCandidateResponse[];
memberCandidateSearchLoading?: boolean;
memberCandidateSearchError?: string | undefined;
selectedMemberCandidate?: ProjectMemberCandidateResponse | undefined;
onSearchMemberCandidates: (query: string) => void;
onSelectMemberCandidate: (candidate: ProjectMemberCandidateResponse) => void;
```

- [ ] **Step 1: Migrate the existing email-based tests**

`apps/admin/src/pages/ProjectSettingsPage.test.tsx`에서 이메일 직접 입력에 의존하는 기존 단언을 먼저 후보 선택 기준으로 고친다. 대상은 `멤버 이메일` label 조회와 이메일 입력 후 `멤버 추가` 클릭 테스트다.

`renderRequiredProps` helper에 새 필수 props 기본값을 더한다.

```ts
const memberCandidates = [
  { adminUserId: "admin_owner", email: "owner@example.com", name: "Owner", membership: { role: "owner" as const } },
  { adminUserId: "admin_new", email: "new@example.com", name: "New Member" },
  { adminUserId: "admin_nameless", email: "nameless@example.com" },
];
```

`renderRequiredProps`에 `memberCandidates={memberCandidates}`, `onSearchMemberCandidates={() => undefined}`, `onSelectMemberCandidate={() => undefined}`를 넣고, `missingMemberProps`의 `@ts-expect-error` 케이스가 새 필수 props 누락으로도 계속 성립하는지 확인한다.

- [ ] **Step 2: Write failing UI tests**

같은 파일에 추가한다.

```ts
it("owner 에게 검색 입력과 후보 목록을 보여준다", async () => {
  // renderRequiredProps() 후
  // getByLabelText("멤버 검색") 이 존재한다.
  // 후보 3건의 이메일이 모두 보인다.
  // "멤버 이메일" label 은 더 이상 존재하지 않는다.
});

it("검색 입력을 바꾸면 onSearchMemberCandidates 를 호출한다", async () => {
  // onSearchMemberCandidates spy 를 넘긴다.
  // fireEvent.change(getByLabelText("멤버 검색"), { target: { value: "new" } })
  // spy 가 "new" 로 호출된다.
});

it("추가 가능한 후보를 누르면 onSelectMemberCandidate 를 호출한다", async () => {
  // onSelectMemberCandidate spy 를 넘긴다.
  // "new@example.com" 후보 버튼을 클릭한다.
  // spy 가 그 후보 객체로 호출된다.
});

it("이미 멤버인 후보는 역할과 함께 표시하고 선택되지 않는다", async () => {
  // onSelectMemberCandidate spy 를 넘긴다.
  // "이미 멤버 · 소유자" 가 보인다.
  // owner 후보 버튼이 disabled 이다.
  // 클릭해도 spy 가 호출되지 않는다.
});

it("추가 가능한 후보에는 추가 가능 상태를 표시한다", async () => {
  // "추가 가능" 이 보인다.
});

it("이름이 없는 후보는 이메일만 표시한다", async () => {
  // "nameless@example.com" 이 보이고 그 row 에 이름 요소가 없다.
});

it("선택된 후보가 없으면 멤버 추가 버튼이 disabled 이다", async () => {
  // selectedMemberCandidate 를 넘기지 않는다.
  // getByRole("button", { name: "멤버 추가" }) 가 disabled 이다.
});

it("선택된 후보 요약을 보여주고 선택한 역할로 onAddMember 를 호출한다", async () => {
  // selectedMemberCandidate={memberCandidates[1]} 와 onAddMember spy 를 넘긴다.
  // "선택됨: New Member · new@example.com" 이 보인다.
  // 역할 select 를 "admin" 으로 바꾸고 "멤버 추가" 를 클릭한다.
  // spy 가 { email: "new@example.com", role: "admin" } 으로 호출된다.
});

it("역할 기본값은 조회자다", async () => {
  // selectedMemberCandidate 를 넘기고 바로 "멤버 추가" 를 클릭한다.
  // onAddMember 가 role "viewer" 로 호출된다.
});

it("후보 검색 중이면 로딩 안내를 보여준다", async () => {
  // memberCandidateSearchLoading 을 넘긴다.
  // "검색 중" 이 보인다.
});

it("후보 검색 실패 문구를 보여준다", async () => {
  // memberCandidateSearchError="사용자를 검색하지 못했습니다." 를 넘긴다.
  // 그 문구가 보인다.
});

it("후보가 없으면 결과 없음 안내를 보여준다", async () => {
  // memberCandidates={[]} 를 넘긴다.
  // "검색 결과가 없습니다." 가 보인다.
});

it("admin 에게는 검색 입력과 후보 목록을 보여주지 않는다", async () => {
  // project.role "admin" 으로 렌더한다.
  // "멤버 추가 권한이 없습니다." 가 보이고 "멤버 검색" label 이 없다.
});
```

- [ ] **Step 3: Run UI tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx
```

Expected: FAIL because the search input, candidate list, and selection summary do not exist.

- [ ] **Step 4: Add the API client function**

`apps/admin/src/api.ts`에서 `addProjectMember` 앞에 추가한다. query는 사용자 자유 입력이므로 반드시 인코딩한다.

```ts
export interface ProjectMemberCandidateResponse {
  adminUserId: string;
  email: string;
  name?: string;
  membership?: { role: ProjectRole };
}

export async function searchProjectMemberCandidates(
  projectId: string,
  query: string,
): Promise<ProjectMemberCandidateResponse[]> {
  return getJson<ProjectMemberCandidateResponse[]>(
    `/admin/api/projects/${projectId}/member-candidates?query=${encodeURIComponent(query)}`,
  );
}
```

- [ ] **Step 5: Replace the add form body**

`apps/admin/src/pages/ProjectSettingsPage.tsx`에서 다음을 바꾼다.

- props interface에 Task 3 Interfaces의 6개 prop을 추가하고, 구조 분해에도 더한다.
- `memberEmail` local state를 제거하고 `memberCandidateQuery` local state를 추가한다.
- `handleAddMemberSubmit`은 선택된 후보 기준으로 바꾼다.

```ts
  const handleAddMemberSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedMemberCandidate) return;
    onAddMember({ email: selectedMemberCandidate.email, role: memberRole });
  };
```

- 검색 입력은 기존 `Field`를 재사용한다.

```tsx
            <Field
              id="settings-member-search"
              label="멤버 검색"
              value={memberCandidateQuery}
              onChange={(value) => {
                setMemberCandidateQuery(value);
                onSearchMemberCandidates(value);
              }}
              disabled={addingMember}
              hint="이름 또는 이메일로 검색"
            />
```

- 후보 목록은 button 목록으로 만든다. 이미 멤버인 후보는 `disabled`로 두어 클릭 자체가 막히게 한다. 상태 문구는 `candidateStatusLabel`로 뽑는다.

```tsx
            {memberCandidateSearchLoading ? <p className="settings-subtitle">검색 중</p> : null}
            {memberCandidateSearchError ? <p className="field-error">{memberCandidateSearchError}</p> : null}
            {!memberCandidateSearchLoading && memberCandidates.length === 0 ? (
              <p className="settings-subtitle">검색 결과가 없습니다.</p>
            ) : null}
            <div className="member-candidate-list">
              {memberCandidates.map((candidate) => {
                const alreadyMember = candidate.membership !== undefined;
                const selected = selectedMemberCandidate?.adminUserId === candidate.adminUserId;
                return (
                  <button
                    type="button"
                    key={candidate.adminUserId}
                    className="member-candidate-row"
                    aria-pressed={selected}
                    disabled={alreadyMember || addingMember}
                    onClick={() => onSelectMemberCandidate(candidate)}
                  >
                    <span className="member-candidate-identity">
                      {candidate.name !== undefined ? <strong>{candidate.name}</strong> : null}
                      <span>{candidate.email}</span>
                    </span>
                    <span className="member-candidate-status">{candidateStatusLabel(candidate)}</span>
                  </button>
                );
              })}
            </div>
            {selectedMemberCandidate ? (
              <p className="member-candidate-selected">
                선택됨: {selectedMemberCandidate.name !== undefined
                  ? `${selectedMemberCandidate.name} · ${selectedMemberCandidate.email}`
                  : selectedMemberCandidate.email}
              </p>
            ) : null}
```

- 제출 버튼 disabled 조건을 선택 기준으로 바꾼다.

```tsx
              <Button variant="primary" type="submit" disabled={addingMember || !selectedMemberCandidate}>
```

- 파일 하단에 상태 문구 helper를 추가한다. 기존 `roleLabel`을 재사용한다.

```ts
function candidateStatusLabel(candidate: ProjectMemberCandidateResponse): string {
  return candidate.membership === undefined
    ? "추가 가능"
    : `이미 멤버 · ${roleLabel(candidate.membership.role)}`;
}
```

`roleLabel`의 파라미터 타입은 `ProjectSettingsViewModel["role"]`이고 `ProjectRole`과 같은 union이므로 그대로 호출된다. 타입을 바꾸지 않는다.

`ProjectMemberCandidateResponse`를 `../api.js` import 목록에 더한다.

- [ ] **Step 6: Add candidate list styles**

`apps/admin/src/pages/pages.css`의 `.member-add-form` 규칙 근처에 추가한다. 기존 `.member-row` 스타일 토큰과 같은 변수를 쓴다.

```css
.member-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}

.member-candidate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: none;
  cursor: pointer;
}

.member-candidate-row:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.member-candidate-identity {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
```

기존 파일의 border, radius, color 변수 이름을 확인해서 `.member-row`와 시각적으로 일치시킨다. `aria-pressed="true"` 상태에 선택 강조를 준다.

- [ ] **Step 7: Run UI tests and typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/pages/ProjectSettingsPage.test.tsx
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS. `App.test.tsx`는 아직 실패해도 된다. Task 4에서 고친다.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/api.ts apps/admin/src/pages
git commit -m "관리자: 프로젝트 멤버 후보 선택 UI 추가"
```

---

### Task 4: App Settings State Integration

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Test: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 `searchProjectMemberCandidates`, `ProjectMemberCandidateResponse`, `ProjectSettingsPage` 새 props.
- Produces: settings 상태 추가 필드와 handler.

```ts
memberCandidates: ProjectMemberCandidateResponse[];
memberCandidateSearchRequestId: number;
memberCandidateSearchLoading: boolean;
memberCandidateSearchError?: string | undefined;
selectedMemberCandidate?: ProjectMemberCandidateResponse | undefined;
```

- 검색어 문자열은 App state에 두지 않는다. `ProjectSettingsPage` local state가 단일 소유자다.

- [ ] **Step 1: Register the api mock and migrate existing tests**

`apps/admin/src/App.test.tsx`의 `vi.mock("./api", ...)`는 export를 하나하나 나열하므로 먼저 등록한다. 등록하지 않으면 App이 호출하는 순간 `undefined`가 되어 무관한 테스트까지 깨진다.

```ts
  searchProjectMemberCandidates: api.searchProjectMemberCandidates,
```

기존 settings 테스트는 role `owner`로 진입하므로 진입 시 후보 검색이 항상 발동한다. 공용 `beforeEach`에 기본값을 넣는다.

```ts
  api.searchProjectMemberCandidates.mockResolvedValue([
    {
      adminUserId: "admin_candidate",
      email: "candidate@example.com",
      name: "Candidate",
    },
  ]);
```

그다음 이메일 직접 입력에 의존하는 기존 테스트 두 곳을 후보 선택 기반으로 이관한다. 멤버 추가 성공 테스트와 오류 문구 table-driven 테스트다. 두 곳 모두 `멤버 이메일` 입력 대신 후보 버튼을 클릭한 뒤 `멤버 추가`를 누르는 형태로 바꾼다.

- [ ] **Step 2: Write failing App tests**

```ts
it("설정 진입 시 빈 검색어로 후보를 조회하고 목록을 보여준다", async () => {
  // 설정 화면에 진입한다.
  // searchProjectMemberCandidates 가 (projectId, "") 로 정확히 한 번 호출된다.
  // "candidate@example.com" 이 보인다.
});

it("owner 가 아니면 후보 검색 API 를 호출하지 않는다", async () => {
  // getProjectSettings 가 role "admin" 을 반환하게 한다.
  // 설정 화면에 진입한다.
  // "멤버 추가 권한이 없습니다." 가 보인다.
  // searchProjectMemberCandidates 가 호출되지 않는다.
});

it("검색어를 바꾸면 후보 검색 API 를 호출하고 목록을 갱신한다", async () => {
  // 진입 후 두 번째 호출이 다른 후보를 반환하게 한다.
  // "멤버 검색" 에 "other" 를 입력한다.
  // searchProjectMemberCandidates 가 (projectId, "other") 로 호출된다.
  // 새 후보가 화면에 보인다.
});

it("늦게 도착한 후보 검색 응답은 무시한다", async () => {
  // 첫 검색은 수동 resolve 가능한 deferred, 두 번째 검색은 즉시 resolve 로 만든다.
  // 검색어를 두 번 연속 바꾼 뒤 첫 deferred 를 나중에 resolve 한다.
  // 화면에는 두 번째 응답 결과만 남는다.
});

it("후보 검색 실패 시 설정 화면을 유지하고 오류 문구를 보여준다", async () => {
  // searchProjectMemberCandidates 를 ApiError(500) 로 reject 한다.
  // 설정 화면은 그대로 보인다.
  // "사용자를 검색하지 못했습니다." 가 보인다.
});

it("후보 검색 권한 오류 문구를 보여준다", async () => {
  // ApiError(403, "project_role_forbidden") 로 reject 한다.
  // "멤버를 검색할 권한이 없습니다." 가 보인다.
});

it("후보 검색이 401 이면 로그인 화면으로 보낸다", async () => {
  // ApiError(401, "admin_auth_required") 로 reject 한다.
  // "Google로 로그인" 버튼이 보인다.
});

it("이미 멤버인 후보는 선택되지 않는다", async () => {
  // membership 이 있는 후보만 반환하게 한다.
  // 그 후보 버튼을 클릭한다.
  // "선택됨:" 요약이 나타나지 않고 "멤버 추가" 가 계속 disabled 다.
});

it("후보 선택 후 추가 성공 시 멤버 목록과 후보 상태를 함께 갱신한다", async () => {
  // addProjectMember 가 후보와 같은 adminUserId 로 viewer member 를 반환하게 한다.
  // 후보를 선택하고 "멤버 추가" 를 클릭한다.
  // 멤버 목록에 새 멤버가 보인다.
  // 같은 후보 row 가 "이미 멤버 · 조회자" 로 바뀐다.
  // "선택됨:" 요약이 사라지고 "멤버를 추가했습니다." 가 보인다.
});

it("추가 실패 시 선택 상태를 유지하고 기존 오류 문구를 보여준다", async () => {
  // addProjectMember 를 ApiError(409, "project_member_exists") 로 reject 한다.
  // 후보를 선택하고 "멤버 추가" 를 클릭한다.
  // "이미 이 프로젝트의 멤버입니다." 가 보인다.
  // "선택됨:" 요약이 그대로 남아 있다.
  // 후보 row 상태는 "추가 가능" 을 유지한다.
});
```

- [ ] **Step 3: Run App tests and verify failure**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx
```

Expected: FAIL because App does not search candidates or track selection.

- [ ] **Step 4: Extend the settings state type and imports**

`apps/admin/src/App.tsx`의 `settings` 상태에 Task 4 Interfaces 5개 필드를 더한다. import에 `searchProjectMemberCandidates`와 `type ProjectMemberCandidateResponse`를 더한다.

`handleShowSettings`의 settings 전이 객체에 초기값을 더한다.

```ts
              memberCandidates: [],
              memberCandidateSearchRequestId: 0,
              memberCandidateSearchLoading: false,
              memberCandidateSearchError: undefined,
              selectedMemberCandidate: undefined,
```

- [ ] **Step 5: Add the candidate search error mapper**

기존 `describeApiError` 패턴을 따라 `describeProjectMemberError` 근처에 추가한다.

```ts
// 후보 검색 라우트가 반환할 수 있는 오류 코드를 한국어 안내로 옮긴다.
// apps/api/src/routes/admin-proxy.ts 의 GET member-candidates 핸들러 기준.
// UI 는 owner 일 때만 검색하고 limit 을 보내지 않으므로 권한/조건 오류는 정상 흐름에서 나오지
// 않는다. 권한이 도중에 바뀐 경우를 위해 지도에 남긴다.
// 401 admin_auth_required 는 login 화면으로 전이하므로 이 지도에 담지 않는다.
const MEMBER_CANDIDATE_SEARCH_ERROR_MESSAGES: Record<string, string> = {
  project_role_forbidden: "멤버를 검색할 권한이 없습니다.",
  project_access_denied: "더 이상 이 프로젝트의 멤버가 아닙니다.",
  invalid_member_candidate_search: "검색 조건이 올바르지 않습니다.",
};

function describeMemberCandidateSearchError(error: unknown): string {
  return describeApiError(
    MEMBER_CANDIDATE_SEARCH_ERROR_MESSAGES,
    error,
    "사용자를 검색하지 못했습니다.",
  );
}
```

- [ ] **Step 6: Add the shared search runner**

`App` 컴포넌트 안, 최상위 `useEffect` 들 앞에 검색 실행 함수를 하나 둔다. 진입 시 검색과 검색어 변경이 같은 guard를 쓰게 한다.

```ts
  const runMemberCandidateSearch = (
    projectId: string,
    settingsSessionId: number,
    query: string,
  ) => {
    let requestId = 0;
    setState((current) => {
      if (
        current.type !== "settings"
        || current.projectId !== projectId
        || current.settingsSessionId !== settingsSessionId
      ) return current;
      requestId = current.memberCandidateSearchRequestId + 1;
      return Object.assign({}, current, {
        memberCandidateSearchRequestId: requestId,
        memberCandidateSearchLoading: true,
        memberCandidateSearchError: undefined,
      });
    });
    if (requestId === 0) return;

    void searchProjectMemberCandidates(projectId, query)
      .then((candidates) => {
        setState((current) =>
          current.type === "settings"
          && current.projectId === projectId
          && current.settingsSessionId === settingsSessionId
          && current.memberCandidateSearchRequestId === requestId
            ? Object.assign({}, current, {
                memberCandidates: candidates,
                memberCandidateSearchLoading: false,
                memberCandidateSearchError: undefined,
              })
            : current,
        );
      })
      .catch((error: unknown) => {
        setState((current) => {
          if (error instanceof ApiError && error.status === 401) return { type: "login" };
          if (
            current.type !== "settings"
            || current.projectId !== projectId
            || current.settingsSessionId !== settingsSessionId
            || current.memberCandidateSearchRequestId !== requestId
          ) return current;
          return Object.assign({}, current, {
            memberCandidateSearchLoading: false,
            memberCandidateSearchError: describeMemberCandidateSearchError(error),
          });
        });
      });
  };
```

`requestId`를 updater 안에서 읽는 이유는 guard가 실패한 경우 요청 자체를 보내지 않기 위해서다. `requestId === 0`은 해당 settings session이 이미 사라졌다는 뜻이다.

- [ ] **Step 7: Add the settings entry search effect**

진입 시 검색은 `handleShowSettings` 안에서 이어 호출하지 않는다. 그 함수의 settings 전이는 `settingsSessionId`를 updater 안에서 `current.settingsSessionId + 1`로 계산하므로, 같은 함수에서 이어 호출하면 guard에 쓸 session id를 미리 추측해야 한다. 이미 install 폴링이 최상위 `useEffect`로 구현되어 있으므로 같은 방식으로 추가하고 실제 state에서 session id를 읽는다.

`install` 폴링 effect 다음에 추가한다.

```ts
  const memberCandidateBootstrapKey = state.type === "settings" && state.project.role === "owner"
    ? `${state.projectId}:${state.settingsSessionId}`
    : undefined;

  useEffect(() => {
    if (memberCandidateBootstrapKey === undefined) return;
    const [projectId, settingsSessionId] = memberCandidateBootstrapKey.split(":");
    runMemberCandidateSearch(projectId!, Number(settingsSessionId), "");
  }, [memberCandidateBootstrapKey]);
```

owner가 아닌 settings session에서는 key가 `undefined`이므로 검색 API를 호출하지 않는다. `projectId`에 `:`가 들어갈 수 있다면 key를 `JSON.stringify([projectId, settingsSessionId])`로 바꾸고 `JSON.parse`로 읽는다. 현재 `projectId`는 `proj_` prefix 형태이므로 split으로 충분하지만, 값에 대한 가정을 코드에 주석으로 남긴다.

- [ ] **Step 8: Add search and select handlers**

`state.type === "settings"` 분기 안, `handleAddMember` 근처에 추가한다.

```ts
    const handleSearchMemberCandidates = (query: string) => {
      runMemberCandidateSearch(state.projectId, state.settingsSessionId, query);
    };

    const handleSelectMemberCandidate = (candidate: ProjectMemberCandidateResponse) => {
      if (candidate.membership !== undefined) return;
      setState((current) =>
        current.type === "settings" && current.projectId === state.projectId
          ? Object.assign({}, current, { selectedMemberCandidate: candidate })
          : current,
      );
    };
```

- [ ] **Step 9: Update add-member success and failure handling**

`handleAddMember` 성공 분기에서 선택 해제와 후보 상태 갱신을 함께 처리한다.

```ts
            ? Object.assign({}, current, {
                members: current.members.concat(member),
                memberCandidates: current.memberCandidates.map((candidate) =>
                  candidate.adminUserId === member.adminUserId
                    ? Object.assign({}, candidate, { membership: { role: member.role } })
                    : candidate,
                ),
                selectedMemberCandidate: undefined,
                addingMember: false,
                memberSavedMessage: "멤버를 추가했습니다.",
              })
```

실패 분기는 그대로 둔다. 선택 상태를 건드리지 않으므로 유지된다. 후보 상태도 추측으로 바꾸지 않는다.

- [ ] **Step 10: Pass the new props**

`ProjectSettingsPage` 호출부에 추가한다.

```tsx
        memberCandidates={state.memberCandidates}
        memberCandidateSearchLoading={state.memberCandidateSearchLoading}
        memberCandidateSearchError={state.memberCandidateSearchError}
        selectedMemberCandidate={state.selectedMemberCandidate}
        onSearchMemberCandidates={handleSearchMemberCandidates}
        onSelectMemberCandidate={handleSelectMemberCandidate}
```

- [ ] **Step 11: Run App tests and typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS. `App.loading.test.tsx`도 함께 통과해야 한다. 실패하면 그 파일의 api mock에도 검색 함수 등록이 필요한지 확인한다.

- [ ] **Step 12: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "관리자: 프로젝트 멤버 후보 검색 상태 연결"
```

---

### Task 5: Final Verification and Branch Finish

**Files:** none by default.

- [ ] **Step 1: Review the whole diff against the spec**

```bash
git diff main --stat
git diff main -- docs/superpowers/specs/2026-08-31-project-member-candidates-design.md
```

확인 항목:
- 검색 결과에 이미 멤버가 포함되고 상태가 표시된다.
- 이미 멤버는 선택과 추가가 막혀 있다.
- 빈 검색어로 기본 후보가 표시된다.
- owner만 후보 검색을 사용할 수 있다.
- 최종 추가가 기존 `POST /members`를 사용한다.
- DB schema 변경이 없다.

- [ ] **Step 2: Run typecheck**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

```bash
PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test
```

Expected: PASS.

- [ ] **Step 4: Check whitespace and diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; status is clean.

- [ ] **Step 5: Commit final fixes if any**

Step 1 through Step 4에서 작은 수정이 필요했다면 해당 파일만 커밋한다.

```bash
git status --short
git commit -m "관리자: 프로젝트 멤버 후보 검색 검증 보완"
```

- [ ] **Step 6: Finish branch**

After all tests pass and the working tree is clean, use `superpowers:finishing-a-development-branch` to decide whether to merge this branch into `main`, keep it for review, or hand off the final branch state.
