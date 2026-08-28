# 프로젝트 멤버 관리 Design

작성일 2026-08-28 · 브랜치 `design/project-members`

## 배경

Trace는 이미 프로젝트별 멤버십 모델을 갖고 있다. `project_memberships`에는 `owner`, `admin`, `viewer` 역할이 저장되고, 관리자 API는 프로젝트별 접근 권한을 이 멤버십으로 확인한다. 최근 작업으로 프로젝트 설정과 프로젝트 전환 UI가 추가되어, 관리자는 프로젝트 단위 작업을 화면에서 수행할 수 있게 됐다.

하지만 아직 제품 화면에서 프로젝트 멤버를 조회하거나 추가할 방법이 없다. 새 관리자가 특정 프로젝트를 보거나 운영하려면 DB를 직접 수정해야 한다. 첫 멤버 관리 사이클은 기존 `admin_users`에 존재하는 사용자만 프로젝트 멤버로 추가하는 작은 범위로 시작한다.

## 목적

프로젝트 설정 화면에서 현재 프로젝트의 멤버 목록을 확인하고, `owner`가 기존 관리자 사용자를 `admin` 또는 `viewer` 역할로 추가할 수 있게 한다.

이번 작업은 멤버 조회와 추가에 집중한다. 이메일 초대 발송, pending invite, 멤버 제거, 역할 변경, owner 이전, 조직 단위 권한 관리는 별도 사이클에서 다룬다.

## 범위

**한다**

- 프로젝트 멤버 목록 조회 API를 추가한다.
- 기존 admin user 이메일로 프로젝트 멤버를 추가하는 API를 추가한다.
- 멤버 추가 시 역할을 `admin` 또는 `viewer` 중 선택하게 한다.
- 프로젝트 설정 화면 하단에 멤버 목록과 추가 폼을 추가한다.
- `owner/admin/viewer/non-member` 권한 흐름을 테스트한다.
- 존재하지 않는 이메일, 중복 멤버, 잘못된 role 입력을 테스트한다.
- 멤버 추가 성공 audit log를 기록한다.

**하지 않는다**

- 아직 로그인하지 않은 이메일을 초대하거나 pending user를 만든다.
- 이메일 발송, 초대 토큰, 초대 수락 화면을 만든다.
- 멤버 제거 UI/API를 만든다.
- 기존 멤버 역할 변경 UI/API를 만든다.
- owner 이전 또는 마지막 owner 보호 로직을 만든다.
- 프로젝트 설정 화면 밖에 별도 멤버 관리 화면을 만든다.
- 프로젝트 전환 select를 설정 화면에 추가한다.

## 제품 동작

### 화면 위치

멤버 관리는 `ProjectSettingsPage` 하단의 별도 섹션으로 둔다. 프로젝트 설정값과 같은 프로젝트 맥락이므로 새 화면을 만들지 않는다.

섹션은 두 부분으로 구성한다.

- 멤버 목록
- 멤버 추가 폼

### 멤버 목록

목록에는 다음 값을 표시한다.

| 값 | 표시 |
| --- | --- |
| 이메일 | `admin_users.email` |
| 이름 | `admin_users.name`이 있으면 표시하고 없으면 생략 |
| 역할 | `owner`는 `소유자`, `admin`은 `관리자`, `viewer`는 `조회자` |
| 추가일 | `createdAt.slice(0, 10)` 형식의 `YYYY-MM-DD` |

목록은 모든 프로젝트 멤버가 볼 수 있다. `owner`, `admin`, `viewer` 모두 조회 가능하다. 멤버가 아닌 사용자는 기존 프로젝트 접근 규칙대로 `403 project_access_denied`를 받는다.

### 멤버 추가

멤버 추가 폼은 `owner`에게만 활성화한다.

폼 필드는 다음과 같다.

- 이메일 input
- 역할 select
  - `admin` 표시명: `관리자`
  - `viewer` 표시명: `조회자`
- `추가` 버튼

`owner`가 이메일과 역할을 입력하고 추가하면, API는 해당 이메일의 admin user가 이미 존재하는지 확인한다. 존재하고 아직 프로젝트 멤버가 아니면 membership을 생성하고 목록을 갱신한다.

`admin`과 `viewer`는 멤버 목록만 볼 수 있다. 추가 폼은 비활성화하지 않고 숨긴다. 대신 목록 아래에 `멤버 추가 권한이 없습니다.` 안내를 표시한다. 이 방식은 “할 수 없는 컨트롤”보다 현재 권한을 명확히 보여준다.

### 역할 선택

첫 사이클에서 추가 가능한 역할은 `admin`과 `viewer`뿐이다. `owner` 추가는 지원하지 않는다. owner 추가나 이전은 마지막 owner 보호, 책임 이전, audit 문구가 필요해 별도 사이클로 분리한다.

## API 설계

### `GET /admin/api/projects/:projectId/members`

현재 로그인 사용자가 프로젝트 멤버이면 멤버 목록을 반환한다.

권한:

| 역할 | 허용 |
| --- | --- |
| `owner` | 허용 |
| `admin` | 허용 |
| `viewer` | 허용 |
| 멤버 아님 | `403 project_access_denied` |

응답:

```json
[
  {
    "adminUserId": "admin_abc",
    "email": "owner@example.com",
    "name": "Owner",
    "role": "owner",
    "createdAt": "2026-08-28T00:00:00.000Z"
  }
]
```

`name`이 없으면 JSON 응답 객체에 `name` 키를 넣지 않는다. `name: undefined` 형태로 만든 뒤 직렬화 결과에 의존하지 않는다.

### `POST /admin/api/projects/:projectId/members`

기존 admin user를 프로젝트 멤버로 추가한다.

권한:

| 역할 | 허용 |
| --- | --- |
| `owner` | 허용 |
| `admin` | `403 project_role_forbidden` |
| `viewer` | `403 project_role_forbidden` |
| 멤버 아님 | `403 project_access_denied` |

요청:

```json
{
  "email": "member@example.com",
  "role": "viewer"
}
```

`role`은 `admin` 또는 `viewer`만 허용한다. `owner`나 다른 값은 `400 invalid_project_member`로 응답한다.

응답:

```json
{
  "adminUserId": "admin_def",
  "email": "member@example.com",
  "name": "Member",
  "role": "viewer",
  "createdAt": "2026-08-28T00:00:00.000Z"
}
```

오류:

| 상황 | 응답 |
| --- | --- |
| 세션 없음 | `401 admin_auth_required` |
| CSRF 실패 | 기존 POST/PATCH 규칙과 동일한 `403 csrf_*` |
| 프로젝트 없음 | `404 project_not_found` |
| 멤버 아님 | `403 project_access_denied` |
| 요청자가 owner 아님 | `403 project_role_forbidden` |
| 이메일이 기존 admin user에 없음 | `404 admin_user_not_found` |
| 이미 프로젝트 멤버 | `409 project_member_exists` |
| role/email 형식 오류 | `400 invalid_project_member` |

성공하면 `project.member_added` audit log를 남긴다.

```json
{
  "addedAdminUserId": "admin_def",
  "email": "member@example.com",
  "role": "viewer"
}
```

## Store 설계

현재 `TraceStore`에는 다음 계약이 있다.

- `addProjectMembership(input)`
- `getProjectMembership(projectId, adminUserId)`
- `listProjectMembershipsForUser(adminUserId)`
- `getAdminUser(adminUserId)`

멤버 관리에는 프로젝트 기준 목록과 이메일 lookup이 필요하므로 다음 계약을 추가한다.

```ts
getAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined>;
listProjectMemberships(projectId: string): Promise<ProjectMembershipRecord[]>;
```

`MemoryStore`와 `SqliteStore` 양쪽에 구현한다. 이메일 lookup은 기존 admin user 저장 시 소문자 정규화된 email을 쓰는 흐름과 맞춘다.

중복 멤버 확인은 route에서 `getProjectMembership(projectId, target.adminUserId)`로 먼저 수행한다. 이미 있으면 `409 project_member_exists`를 반환하고 store에는 쓰지 않는다.

## Admin UI 설계

`apps/admin/src/api.ts`에 멤버 타입과 API 함수를 추가한다.

```ts
export interface ProjectMemberResponse {
  adminUserId: string;
  email: string;
  name?: string;
  role: ProjectRole;
  createdAt: string;
}

export async function getProjectMembers(projectId: string): Promise<ProjectMemberResponse[]>;

export async function addProjectMember(
  projectId: string,
  input: { email: string; role: "admin" | "viewer" },
  csrfToken: string,
): Promise<ProjectMemberResponse>;
```

`App.tsx`의 settings 상태에 `members`, `membersLoading`, `membersError`, `memberAddError` 같은 값을 추가하는 대신, 첫 사이클에서는 설정 화면 진입 시 프로젝트 설정과 멤버 목록을 함께 로드한다.

흐름:

1. 대시보드에서 `프로젝트 설정` 클릭
2. `getProjectSettings(projectId)`와 `getProjectMembers(projectId)`를 함께 호출
3. 둘 다 성공하면 settings 화면 표시
4. 설정 조회가 실패하면 기존 설정 오류 규칙 유지
5. 멤버 목록 조회가 실패하면 설정 화면은 열지 않는다. 멤버 목록도 같은 프로젝트 접근 권한을 쓰므로 실패하면 설정 조회 실패와 같은 전역 상태로 처리한다.

설정과 멤버 목록을 함께 조회하는 중 프로젝트 전환이 일어나면, 요청을 시작한 `projectId`와 현재 `ready` 상태의 `projectId`가 같을 때만 settings 상태로 전환한다. 이전 프로젝트의 지연 응답은 성공·실패 모두 화면을 덮어쓰지 않는다.

멤버 추가 성공 시에는 반환된 멤버를 목록에 추가한다. 실패하면 폼 근처에 한국어 안내를 표시한다.

오류 메시지:

| API error | UI message |
| --- | --- |
| `admin_user_not_found` | `해당 이메일의 관리자를 찾을 수 없습니다.` |
| `project_member_exists` | `이미 이 프로젝트의 멤버입니다.` |
| `project_role_forbidden` | `멤버를 추가할 권한이 없습니다.` |
| `invalid_project_member` | `멤버 이메일 또는 역할이 올바르지 않습니다.` |
| `csrf_*` | `보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.` |
| fallback | `멤버를 추가하지 못했습니다.` |

## 테스트 설계

### Store

`apps/api/src/store/store-contract.test.ts`에 추가한다.

- email로 admin user를 찾을 수 있다.
- 없는 email은 `undefined`를 반환한다.
- 프로젝트 기준 membership 목록을 반환한다.
- 다른 프로젝트 membership은 섞이지 않는다.

### API

`apps/api/src/routes/admin.test.ts`에 추가한다.

- 프로젝트 멤버가 멤버 목록을 조회할 수 있다.
- non-member는 목록 조회에서 `403 project_access_denied`를 받는다.
- owner는 기존 admin user를 `admin`으로 추가할 수 있다.
- owner는 기존 admin user를 `viewer`로 추가할 수 있다.
- admin/viewer는 멤버 추가에서 `403 project_role_forbidden`을 받는다.
- 존재하지 않는 이메일은 `404 admin_user_not_found`를 받는다.
- 이미 멤버인 이메일은 `409 project_member_exists`를 받는다.
- `owner` role 입력은 `400 invalid_project_member`를 받는다.
- 멤버 추가 성공 시 `project.member_added` audit log를 남긴다.

### Admin UI

`apps/admin/src/App.test.tsx`와 필요 시 `ProjectSettingsPage.test.tsx`에 추가한다.

- 프로젝트 설정 화면에서 멤버 목록을 보여준다.
- owner는 이메일과 역할을 선택해 멤버를 추가할 수 있다.
- admin/viewer는 멤버 목록만 보고 추가 권한 없음 안내를 본다.
- 추가 성공 시 새 멤버가 목록에 나타난다.
- `admin_user_not_found`, `project_member_exists`, `project_role_forbidden`, `invalid_project_member`가 한국어 안내로 표시된다.
- 설정 조회 중 프로젝트 전환이 일어난 경우 기존 stale response guard가 멤버 목록 결과에도 적용된다.

## 검증 기준

- `npm run typecheck`가 통과한다.
- `npm test`가 통과한다.
- owner가 기존 admin user를 `admin` 또는 `viewer`로 추가할 수 있다.
- admin/viewer는 목록 조회만 가능하고 추가는 할 수 없다.
- 존재하지 않는 이메일과 중복 멤버가 명확한 한국어 안내로 표시된다.
- 이메일 초대, role 변경, 멤버 제거 기능은 포함되지 않는다.
