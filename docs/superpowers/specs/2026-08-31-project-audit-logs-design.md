# 프로젝트 활동 이력 조회 Design

작성일 2026-08-31 · 브랜치 `design/project-audit-logs`

## 배경

프로젝트 설정 화면에는 멤버 목록, 후보 검색 기반 멤버 추가, 역할 변경, 제거가 모두 갖춰졌다. 서버는 이 변경들을 `project.member_added`, `project.member_role_updated`, `project.member_removed` audit log로 남기고, 프로젝트 생성과 설정 변경, 멤버가 아닌 사용자의 접근 거부도 함께 기록한다.

그런데 이 기록을 읽을 방법이 없다. `TraceStore.listAuditLogs()`는 존재하지만 프로덕션 코드에서 호출되지 않고 테스트에서만 쓰인다. 조회 route도 화면도 없다. 운영자는 "누가 언제 이 멤버를 제거했는가"에 답할 수 없다.

멤버 관리 기능이 성실히 쌓아 온 기록을 운영자가 화면에서 확인할 수 있게 만드는 것이 이번 범위다.

## 목적

프로젝트 owner가 자기 프로젝트의 활동 이력을 최신순으로 확인할 수 있게 한다.

행위자와 변경 내용을 한국어 문장으로 읽을 수 있어야 한다. `admin_abc`와 raw JSON을 그대로 노출하면 조사 도구로 쓸 수 없으므로, 행위자는 이름/이메일로 해석하고 `metadata`는 action별 문장으로 조립한다.

## 범위

**한다**

- 프로젝트별 활동 이력 조회 API를 추가한다.
- `projectId`가 있는 audit log 6종을 대상으로 한다.
- 최신순으로 정렬하고 keyset 커서 페이지네이션을 제공한다.
- 행위자 `adminUserId`를 이름/이메일로 해석해서 반환한다.
- action과 `metadata`를 한국어 문장으로 렌더링한다.
- 모르는 action은 코드와 metadata JSON으로 fallback한다.
- owner만 활동 이력을 조회할 수 있다.
- 설정 화면에서 진입하는 별도 활동 이력 화면을 만든다.
- `audit_logs`에 프로젝트 조회용 인덱스를 추가한다.
- Store, API, Admin UI, App 상태 전이 테스트를 추가한다.

**하지 않는다**

- `auth.login_success`, `auth.logout`, `auth.login_failure` 3종을 화면에 넣지 않는다. `projectId`가 없고 볼 주체인 시스템 관리자 개념이 아직 없다.
- 시스템 전역 활동 이력 화면과 시스템 관리자 역할을 만들지 않는다.
- 기존 `listAuditLogs()`의 계약을 바꾸지 않는다.
- action별 필터, 기간 필터, 행위자 필터, 검색을 만들지 않는다.
- 활동 이력 CSV 내보내기를 만들지 않는다.
- audit log 보존 기간 정책과 삭제를 만들지 않는다.
- 시각을 사용자 로컬 시간대로 변환하지 않는다.
- admin/viewer에게 활동 이력을 제공하지 않는다.

## 제품 동작

### 화면 위치

설정 화면 멤버 섹션 아래에 owner 전용 `활동 이력` 버튼을 둔다. admin/viewer에게는 버튼을 보여주지 않는다.

버튼을 누르면 활동 이력 화면으로 전환한다. 설정 화면 안에 목록을 넣지 않는다. 설정 화면은 이미 프로젝트 이름, 허용 도메인, 멤버 목록, 멤버 추가로 채워져 있어 한 화면에 더 넣으면 읽기 어려워진다.

활동 이력 화면의 `설정으로 돌아가기`는 설정 화면을 다시 로드한다.

### 목록 표시

각 행은 세 가지를 보여준다.

| 열 | 내용 |
| --- | --- |
| 시각 (UTC) | `YYYY-MM-DD HH:mm` |
| 행위자 | 이름이 있으면 `이름 · 이메일`, 없으면 이메일 |
| 내용 | action과 metadata로 조립한 한국어 문장 |

행위자 해석 규칙은 다음과 같다.

| 상황 | 표시 |
| --- | --- |
| `actor`에 이름과 이메일이 있다 | `Owner · owner@example.com` |
| `actor`에 이메일만 있다 | `owner@example.com` |
| `actor`에 `adminUserId`만 있다 | `admin_abc` |
| `actor`가 없다 | `시스템` |

조회에 실패한 행위자는 `adminUserId`를 그대로 보여준다. 원인을 추측해 덧붙이지 않는다. 이 레포에는 admin user 삭제 경로가 없어서, 조회 실패가 삭제 때문인지 확인할 방법이 없다.

### action 문장

| action | 문장 |
| --- | --- |
| `project.created` | `프로젝트 '{name}'을 만들었습니다.` |
| `project.updated` | `프로젝트 설정을 변경했습니다.` + 변경 상세 |
| `project.member_added` | `{email}을 {역할}로 추가했습니다.` |
| `project.member_role_updated` | `{email}의 역할을 {이전 역할}에서 {이후 역할}로 변경했습니다.` |
| `project.member_removed` | `{email}({역할})을 제거했습니다.` |
| `project.access_denied` | `{리소스} 접근이 거부되었습니다.` |

역할 문구는 기존 `roleLabel`을 재사용해 `소유자`, `관리자`, `조회자`로 표시한다.

`project.access_denied`의 리소스 문구는 `resourceType`을 옮긴다.

| `resourceType` | 표시 |
| --- | --- |
| `project_settings` | `프로젝트 설정` |
| `project_members` | `멤버 목록` |
| `project_member_candidates` | `멤버 후보 검색` |
| `project_audit_logs` | `활동 이력` |
| `project_summary` | `대시보드 요약` |
| `project_issues` | `문제 목록` |
| `issue_detail` | `문제 상세` |
| `session_timeline` | `세션 타임라인` |

`project.updated`의 `metadata`는 `before`와 `after`에 이름과 허용 도메인 배열 전체를 담는다. 도메인 목록을 그대로 펼치면 행이 길어지므로 요약한다.

- 이름이 바뀌었으면 `이름을 '{before}'에서 '{after}'로 바꿈`을 덧붙인다.
- 허용 도메인 개수가 바뀌었으면 `허용 도메인 {before 개수}개에서 {after 개수}개로 변경`을 덧붙인다.
- 개수가 같고 내용만 바뀌었으면 `허용 도메인 변경`을 덧붙인다.
- 둘 다 그대로면 상세를 덧붙이지 않는다.

목록에 없는 action은 `action` 코드를 그대로 보여주고 `metadata`를 `JSON.stringify`로 덧붙인다. action이 추가되어도 화면이 비어 보이거나 깨지지 않게 한다.

### 페이지네이션

첫 진입에서 최신 50건을 불러온다. 서버가 `nextCursor`를 주면 목록 아래에 `더 보기` 버튼을 보여준다.

`더 보기`를 누르면 같은 커서로 다음 50건을 불러와 기존 목록 뒤에 이어 붙인다. 불러오는 동안 버튼은 disabled이고 `불러오는 중`을 표시한다.

`nextCursor`가 없으면 `더 보기` 버튼을 보여주지 않는다.

### 빈 목록과 오류

첫 로드 중에는 `불러오는 중`을 보여주고 빈 목록 문구를 보여주지 않는다. 후보 검색 화면이 `검색 중`과 `검색 결과가 없습니다.`를 배타적으로 다루는 방식과 같다.

로드가 끝났고 이력이 없으면 `활동 이력이 없습니다.`를 보여준다.

첫 로드가 실패하면 `활동 이력을 불러오지 못했습니다.`를 보여준다. `더 보기`가 실패하면 기존 목록을 유지하고 같은 문구를 목록 아래에 보여준다. 이어 붙인 목록을 실패로 비우지 않는다.

## API 설계

### `GET /admin/api/projects/:projectId/audit-logs`

프로젝트 활동 이력을 최신순으로 반환한다.

Query:

| 이름 | 설명 |
| --- | --- |
| `limit` | 선택. 1-100 사이 정수. 기본 50. UI client는 보내지 않고 서버 기본값을 쓴다. |
| `cursor` | 선택. 직전 페이지 마지막 항목의 불투명 커서. |

권한:

| 요청자 | 결과 |
| --- | --- |
| `owner` | 허용 |
| `admin` | `403 project_role_forbidden` |
| `viewer` | `403 project_role_forbidden` |
| 멤버 아님 | `403 project_access_denied` |

프로젝트가 없으면 `404 project_not_found`, 세션이 없으면 `401 admin_auth_required`를 반환한다. 조회 API이므로 CSRF는 요구하지 않는다.

권한 검사는 기존 `getProjectAccess`를 재사용하고, `admin-proxy.ts`의 `ProjectResourceType` union에 `"project_audit_logs"`를 추가한다. 멤버가 아닌 요청자의 거부는 기존 `project.access_denied` audit log에 이 resourceType으로 남는다.

권한 검사를 query schema 검증보다 먼저 둔다. owner가 아닌 요청자에게 `limit`·`cursor` 검증 결과를 흘리지 않는다.

`limit`은 서버 계약으로만 둔다. UI client는 `limit`을 보내지 않으므로 범위 검증은 API 테스트에서 직접 query string으로 검증한다.

응답:

```json
{
  "entries": [
    {
      "auditLogId": "audit_abc",
      "action": "project.member_added",
      "createdAt": "2026-08-31T01:00:00.000Z",
      "actor": {
        "adminUserId": "admin_owner",
        "email": "owner@example.com",
        "name": "Owner"
      },
      "metadata": {
        "addedAdminUserId": "admin_member",
        "email": "member@example.com",
        "role": "viewer"
      }
    }
  ],
  "nextCursor": "2026-08-31T01:00:00.000Z|audit_abc"
}
```

`entries`는 `createdAt` 내림차순이다. 다음 페이지가 없으면 `nextCursor` 키를 넣지 않는다.

`actor`는 `adminUserId`가 `null`이면 키를 넣지 않는다. `getAdminUser` 조회가 실패하면 `adminUserId`만 담는다. `name`이 없으면 `name` 키를 넣지 않는다. 기존 멤버 응답과 같은 규칙으로, `undefined` 값을 담고 직렬화 결과에 의존하지 않는다.

### 행위자 해석

`entries`의 행위자를 채우기 위해 route가 `getAdminUser`를 호출한다. 50건마다 50번 조회하지 않도록 `adminUserId` 중복을 먼저 제거하고 distinct한 값만 조회해 Map으로 재사용한다. 한 페이지의 행위자는 보통 1-3명이다.

### 커서

커서는 `${createdAt}|${auditLogId}` 형식의 불투명 문자열이다.

`createdAt`은 ISO 8601이고 `auditLogId`는 `audit_` prefix와 nanoid로 이루어져 둘 다 `|`를 담지 않는다. 첫 `|`를 구분자로 쓴다.

route는 커서를 다음 조건으로 검증하고, 어긋나면 `400 invalid_audit_log_query`를 반환한다.

- `|`가 정확히 구분자 역할을 하도록 앞뒤가 모두 비어 있지 않다.
- 앞부분이 `Date`로 파싱 가능한 ISO 문자열이다.

### 다음 페이지 판정

route는 store에 `limit + 1`을 요청한다. `limit + 1`건이 오면 다음 페이지가 있다는 뜻이므로, 앞 `limit`건만 반환하고 그 마지막 항목으로 `nextCursor`를 만든다. `limit`건 이하가 오면 `nextCursor`를 넣지 않는다.

이 방식은 별도 count 쿼리 없이 다음 페이지 존재를 정확히 판정한다.

오류:

| 상황 | 응답 |
| --- | --- |
| 세션 없음 | `401 admin_auth_required` |
| 프로젝트 없음 | `404 project_not_found` |
| 요청자가 프로젝트 멤버 아님 | `403 project_access_denied` |
| 요청자가 owner 아님 | `403 project_role_forbidden` |
| `limit`이 범위를 벗어남 | `400 invalid_audit_log_query` |
| `cursor` 형식이 잘못됨 | `400 invalid_audit_log_query` |

## Store 설계

`TraceStore`에 프로젝트 스코프 조회 계약을 추가한다.

```ts
listProjectAuditLogs(input: {
  projectId: string;
  limit: number;
  cursor?: { createdAt: string; auditLogId: string };
}): Promise<AuditLogRecord[]>;
```

기존 `listAuditLogs()`는 그대로 둔다. 이 메서드는 프로덕션 코드에서 호출되지 않고 route 테스트가 전체 덤프를 검증하는 도구로 자리잡았다. 프로젝트 스코프와 페이지네이션은 계약이 달라 하나로 합치면 양쪽이 모두 나빠진다.

스토어 책임:

- `projectId`가 일치하는 audit log만 반환한다. `projectId`가 없는 log는 제외한다.
- `createdAt` 내림차순, 같으면 `auditLogId` 내림차순으로 정렬한다.
- `cursor`가 있으면 그 항목보다 엄격히 뒤에 오는 것만 반환한다.
- 최대 `limit`건을 반환한다.

SQLite는 다음 조건을 쓴다.

```sql
SELECT * FROM audit_logs
WHERE project_id = ?
  AND (created_at < ? OR (created_at = ? AND audit_log_id < ?))
ORDER BY created_at DESC, audit_log_id DESC
LIMIT ?
```

row value 비교(`(a, b) < (?, ?)`) 대신 풀어 쓴 형태를 쓴다. SQLite 버전에 의존하지 않는다.

MemoryStore는 `auditLogs`를 `Map`으로 갖고 `listAuditLogs()`가 삽입 순서를 그대로 반환한다. 새 메서드는 **명시적으로 내림차순 정렬**해야 SQLite와 같은 계약이 된다. 삽입 순서에 기대면 두 스토어가 어긋난다.

### 인덱스

`audit_logs`에는 현재 인덱스가 없다. 프로젝트 필터와 정렬이 full scan이 되므로 인덱스를 추가한다.

```sql
CREATE INDEX IF NOT EXISTS audit_logs_project_created
  ON audit_logs (project_id, created_at DESC, audit_log_id DESC);
```

`apps/api/src/db/schema.sqlite.ts`의 스키마 문자열에 넣는다. `IF NOT EXISTS`이고 시작할 때 멱등하게 적용되므로 마이그레이션 버전 관리는 이번에도 도입하지 않는다.

## Admin API Client 설계

`apps/admin/src/api.ts`에 타입과 함수를 추가한다.

```ts
export interface ProjectAuditLogActorResponse {
  adminUserId: string;
  email?: string;
  name?: string;
}

export interface ProjectAuditLogEntryResponse {
  auditLogId: string;
  action: string;
  createdAt: string;
  actor?: ProjectAuditLogActorResponse;
  metadata: Record<string, unknown>;
}

export interface ProjectAuditLogPageResponse {
  entries: ProjectAuditLogEntryResponse[];
  nextCursor?: string;
}

export async function getProjectAuditLogs(
  projectId: string,
  cursor?: string,
): Promise<ProjectAuditLogPageResponse>;
```

`action`은 `string`으로 둔다. union으로 좁히면 서버가 새 action을 추가할 때 클라이언트 타입이 먼저 깨진다. 모르는 action을 fallback으로 렌더링하는 설계와 맞춘다.

`cursor`는 불투명 문자열이므로 URL에 붙일 때 `encodeURIComponent`로 인코딩한다.

## Admin UI 설계

새 페이지 `apps/admin/src/pages/ProjectAuditLogPage.tsx`를 만든다.

```ts
interface ProjectAuditLogPageProps {
  projectId: string;
  entries: ProjectAuditLogEntryResponse[];
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | undefined;
  hasMore: boolean;
  onBack: () => void;
  onLoadMore: () => void;
}
```

문장 조립은 페이지 모듈의 순수 함수로 둔다.

```ts
export function describeAuditLogEntry(entry: ProjectAuditLogEntryResponse): string;
```

이 함수를 export하는 이유는 action별 문장이 이 기능의 핵심 가치이고, 컴포넌트 렌더링을 거치지 않고 직접 검증하는 편이 테스트가 명확하기 때문이다.

시각은 `createdAt.slice(0, 16).replace("T", " ")`로 만든다. 기존 멤버 목록이 `createdAt.slice(0, 10)`을 쓰는 방식과 같은 계열이고, 시간대 변환 없이 테스트가 결정적이다. 열 제목에 `시각 (UTC)`를 명시해서 UTC임을 숨기지 않는다.

설정 화면에는 owner 전용 버튼만 추가한다.

```ts
onShowAuditLog?: (() => void) | undefined;
```

`project.role === "owner"`이고 이 prop이 있을 때만 `활동 이력` 버튼을 보여준다. 기존 멤버 섹션과 멤버 추가 폼은 바꾸지 않는다.

페이지는 커서 문자열을 알 필요가 없다. App이 `nextCursor !== undefined`로 `hasMore`를 파생해서 넘긴다. 커서 값 자체는 App 상태에만 둔다.

## App 상태 설계

`AppState`에 `audit` 상태를 추가한다.

```ts
| {
    type: "audit";
    project: ProjectSettingsResponse;
    dashboardData: { summary: DashboardSummary; issues: Issue[] };
    projects: ProjectOption[];
    projectId: string;
    userEmail: string;
    adminUserId: string;
    csrfToken: string;
    settingsSessionId: number;
    entries: ProjectAuditLogEntryResponse[];
    nextCursor?: string | undefined;
    auditRequestId: number;
    loading: boolean;
    loadingMore: boolean;
    error?: string | undefined;
  }
```

설정 화면과 대시보드로 돌아가기 위해 `dashboardData`, `projects`, `settingsSessionId`를 함께 들고 다닌다. 기존 `settings-not-found` 상태가 같은 값들을 들고 다니는 방식과 같다.

활동 이력 진입 시:

- `audit` 상태로 전환하고 `loading: true`, `entries: []`로 시작한다.
- `getProjectAuditLogs(projectId)`를 커서 없이 호출한다.
- 응답이 오면 `state.type`, `projectId`, `settingsSessionId`, `auditRequestId`가 모두 일치할 때만 반영한다.

`더 보기`:

- `loadingMore: true`로 두고 `auditRequestId`를 증가시킨다.
- `getProjectAuditLogs(projectId, nextCursor)`를 호출한다.
- 성공하면 `entries`에 append하고 `nextCursor`를 갱신한다.
- 실패하면 `entries`를 유지하고 `error`만 채운다.

`설정으로 돌아가기`:

- `getProjectSettings`와 `getProjectMembers`를 다시 불러 `settings` 상태로 전환한다.
- 진입 경로가 늘어나므로 `handleShowSettings`의 guard를 `ready`와 `audit` 둘 다 허용하도록 넓힌다.
- `settingsSessionId`가 증가하므로 기존 후보 검색 bootstrap effect가 다시 발동한다. 별도 처리는 필요하지 않다.

`401`은 기존 다른 handler와 같이 login 화면으로 전이한다.

## 오류 메시지

활동 이력 조회 실패는 기존 `describeApiError` 패턴을 따른다.

| 오류 코드 | 문구 |
| --- | --- |
| `project_role_forbidden` | `활동 이력을 볼 권한이 없습니다.` |
| `project_access_denied` | `더 이상 이 프로젝트의 멤버가 아닙니다.` |
| `project_not_found` | `프로젝트를 찾을 수 없습니다.` |
| `invalid_audit_log_query` | `조회 조건이 올바르지 않습니다.` |
| 그 외 전부 (fallback) | `활동 이력을 불러오지 못했습니다.` |

UI는 owner일 때만 진입하고 `limit`을 보내지 않으므로 권한/조건 오류는 정상 흐름에서 나오지 않는다. 권한이 도중에 바뀐 경우를 대비해 지도에 남긴다. `401`은 login 화면으로 전이하므로 담지 않는다.

## 테스트 전략

### Store

`store-contract.test.ts`에서 MemoryStore와 SqliteStore 공통 계약으로 검증한다.

- 프로젝트별로 격리한다. 다른 프로젝트 log와 `projectId`가 없는 log를 제외한다.
- `createdAt` 내림차순으로 반환한다.
- `createdAt`이 같으면 `auditLogId` 내림차순으로 반환한다.
- `limit`이 적용된다.
- `cursor` 다음 페이지가 이어진다. 두 페이지를 합치면 중복과 누락이 없다.
- `createdAt`이 같은 항목이 커서 경계에 걸쳐도 중복과 누락이 없다.
- 커서가 마지막 항목을 가리키면 빈 배열을 반환한다.

### API

`admin.test.ts`에서 검증한다.

- owner가 활동 이력을 최신순으로 조회한다.
- 행위자 이름과 이메일이 채워진다.
- `adminUserId`가 없는 log는 `actor` 키가 없다.
- 이름이 없는 행위자는 `actor.name` 키가 없다.
- 다음 페이지가 있으면 `nextCursor`를 반환하고, 없으면 키가 없다.
- `nextCursor`로 이어 조회하면 중복 없이 다음 페이지가 온다.
- `projectId`가 없는 `auth.*` log는 반환되지 않는다.
- 다른 프로젝트의 log는 반환되지 않는다.
- admin/viewer는 `403 project_role_forbidden`이다.
- non-member는 `403 project_access_denied`이고 `resourceType: "project_audit_logs"`로 audit된다.
- 없는 프로젝트는 `404 project_not_found`이다.
- 세션 없이 호출하면 `401 admin_auth_required`이다.
- `limit=0`, `limit=101`, `limit=abc`는 `400 invalid_audit_log_query`이다.
- 잘못된 `cursor`는 `400 invalid_audit_log_query`이다.
- 행위자가 같은 여러 항목에서 `getAdminUser` 조회가 중복 실행되지 않는다.

### Admin UI

`ProjectAuditLogPage.test.tsx`에서 검증한다.

`describeAuditLogEntry`를 직접 호출해 action별 문장을 검증한다.

- 6종 action이 각각 기대한 문장을 만든다.
- `project.updated`가 이름 변경, 도메인 개수 변경, 도메인 내용 변경, 변경 없음 네 경우를 구분한다.
- 모르는 action은 코드와 metadata JSON으로 fallback한다.
- `metadata`에 기대한 키가 없어도 예외를 던지지 않는다.

컴포넌트는 다음을 검증한다.

- 시각, 행위자, 내용 세 열이 보인다.
- 행위자 4가지 경우(이름+이메일, 이메일만, adminUserId만, 없음)가 각각 표시된다.
- `hasMore`가 참일 때만 `더 보기` 버튼이 보인다.
- `더 보기` 클릭이 `onLoadMore`를 호출한다.
- `loadingMore`면 `더 보기`가 disabled이고 `불러오는 중`이 보인다.
- 빈 목록에 `활동 이력이 없습니다.`가 보인다.
- `error`가 표시된다.

`ProjectSettingsPage.test.tsx`에 추가한다.

- owner에게 `활동 이력` 버튼이 보이고 클릭이 `onShowAuditLog`를 호출한다.
- admin/viewer에게 버튼이 보이지 않는다.

### App

`App.test.tsx`에서 검증한다.

- 설정 화면에서 `활동 이력`을 누르면 조회 API를 호출하고 목록을 보여준다.
- `더 보기`가 커서로 다음 페이지를 불러와 이어 붙인다.
- `더 보기` 실패 시 기존 목록을 유지하고 오류를 보여준다.
- 첫 로드 실패 시 오류 문구를 보여준다.
- `401`이면 login 화면으로 전이한다.
- `설정으로 돌아가기`가 설정 화면을 다시 로드하고 후보 검색이 다시 발동한다.
- 늦게 도착한 조회 응답은 `auditRequestId` guard로 무시된다.

## 알려진 한계

시각을 UTC로 표시한다. 열 제목에 `(UTC)`를 명시하므로 오해하지는 않지만, 운영자가 자기 시간대로 읽으려면 머릿속에서 변환해야 한다. 로컬 시간대 변환은 테스트를 시간대에 의존하게 만들어 이번 범위에서 제외한다.

`auth.login_success`, `auth.logout`, `auth.login_failure`는 화면에 나오지 않는다. self-hosted 운영자가 로그인 이력을 보려면 여전히 DB를 직접 조회해야 한다. 이걸 화면으로 만들려면 시스템 관리자 역할을 새로 정의해야 하므로 별도 사이클로 남긴다.

필터와 검색이 없다. 활동이 많은 프로젝트에서 특정 사건을 찾으려면 `더 보기`를 반복해야 한다. action별 필터와 기간 필터는 후속 개선으로 남긴다.

## 마이그레이션과 호환성

`audit_logs` 테이블 컬럼은 바꾸지 않는다. 인덱스 하나를 `CREATE INDEX IF NOT EXISTS`로 추가하고 시작 시 멱등하게 적용한다.

기존 `listAuditLogs()`는 시그니처와 동작을 그대로 유지하므로 이 메서드를 쓰는 route 테스트는 영향을 받지 않는다.

기존 audit log 기록 경로(`createAuditLog`, `addProjectMembershipWithAudit`, `updateProjectMembershipRoleWithAudit`, `removeProjectMembershipWithAudit`)는 바꾸지 않는다. 이번 작업은 읽기만 추가한다.

## 완료 기준

- owner가 설정 화면에서 활동 이력 화면으로 진입해 최신 50건을 볼 수 있다.
- 행위자가 이름/이메일로 표시되고, 없는 경우 4가지가 각각 알맞게 표시된다.
- 6종 action이 한국어 문장으로 읽히고, 모르는 action도 화면을 깨지 않는다.
- `더 보기`로 다음 페이지가 중복 없이 이어진다.
- admin/viewer는 활동 이력에 접근할 수 없다.
- `auth.*` log와 다른 프로젝트 log가 섞이지 않는다.
- `npm run typecheck`, `npm test`, `git diff --check`가 통과한다.
