# 프로젝트 멤버 변경/제거 Design

작성일 2026-08-31 · 브랜치 `design/project-member-actions`

## 배경

프로젝트 설정 화면에는 현재 프로젝트 멤버 목록과 기존 관리자 사용자 추가 기능이 있다. `owner`는 기존 `admin_users` 사용자를 `admin` 또는 `viewer`로 추가할 수 있고, 서버는 중복 추가를 원자적으로 거부하며 audit log를 남긴다.

하지만 멤버가 들어온 뒤 역할을 바꾸거나 더 이상 필요 없는 멤버를 제거할 방법은 아직 없다. 운영자는 프로젝트별 접근 권한을 화면에서 조정해야 하므로, 멤버 추가 다음 단계로 역할 변경과 제거를 같은 설정 화면 안에서 제공한다.

## 목적

프로젝트 설정 화면의 멤버 목록 row 안에서 `owner`가 멤버 역할을 변경하거나 멤버를 제거할 수 있게 한다. 서버는 자기 자신의 owner 권한 상실과 마지막 owner 상실을 막아 프로젝트가 항상 관리 가능한 상태로 남게 한다.

## 범위

**한다**

- 기존 프로젝트 멤버 역할 변경 API를 추가한다.
- 기존 프로젝트 멤버 제거 API를 추가한다.
- 역할 변경은 `owner`, `admin`, `viewer`를 모두 대상으로 허용한다.
- 역할 변경/제거는 `owner`만 수행할 수 있다.
- 본인 제거와 본인 owner 권한 강등을 금지한다.
- 마지막 owner 제거와 마지막 owner 강등을 금지한다.
- 프로젝트 설정 화면의 멤버 row 안에 owner 전용 역할 select와 제거 버튼을 추가한다.
- 역할 변경/제거 성공 시 멤버 목록을 즉시 갱신한다.
- 역할 변경/제거 audit log를 기록한다.
- MemoryStore와 SqliteStore 양쪽에서 역할 변경/제거 계약을 검증한다.
- API, Admin UI, App 상태 전이 테스트를 추가한다.

**하지 않는다**

- 아직 로그인하지 않은 이메일 초대나 pending invite를 만든다.
- 이메일 발송, 초대 토큰, 초대 수락 화면을 만든다.
- 멤버 검색, 페이지네이션, 정렬 변경을 만든다.
- 별도 멤버 관리 화면을 만든다.
- 조직 단위 권한, billing 권한, 프로젝트 템플릿 권한을 만든다.
- owner 이전 전용 flow를 만든다. owner 승격과 강등은 일반 역할 변경으로 처리한다.
- 마지막 owner 보호 외 복잡한 승인 workflow를 만든다.

## 제품 동작

### 화면 위치

기존 `ProjectSettingsPage` 하단의 멤버 섹션을 확장한다. 별도 화면으로 이동하지 않고 각 멤버 row에서 바로 관리한다.

### 멤버 row

모든 프로젝트 멤버는 기존처럼 목록을 볼 수 있다.

`owner`에게는 각 row 오른쪽에 다음 컨트롤을 보여준다.

- 역할 select
  - `owner`: `소유자`
  - `admin`: `관리자`
  - `viewer`: `조회자`
- 제거 버튼

`admin`과 `viewer`에게는 역할 텍스트와 추가일만 보여준다. 변경/제거 컨트롤은 숨기고, 목록 아래에는 기존 안내인 `멤버 추가 권한이 없습니다.`를 유지한다.

### 역할 변경

`owner`가 역할 select를 바꾸면 즉시 API를 호출한다. 성공하면 해당 멤버 row의 역할을 서버 응답 기준으로 갱신한다. 실패하면 select 값을 기존 역할로 되돌리고 row 또는 멤버 섹션에 오류 메시지를 표시한다.

역할 변경 중인 row는 select와 제거 버튼을 disabled 처리한다. 다른 row는 계속 조작할 수 있다.

역할 변경 허용 범위:

| 대상 변경 | 허용 |
| --- | --- |
| 다른 멤버를 `owner`로 승격 | 허용 |
| 다른 owner를 `admin` 또는 `viewer`로 강등 | 허용, 단 마지막 owner이면 금지 |
| 자기 자신을 `admin` 또는 `viewer`로 강등 | 금지 |
| 자기 자신을 `owner`로 유지 | 변경 없음으로 처리 |
| 존재하지 않는 역할 | `400 invalid_project_member` |

동일 역할로 변경 요청이 들어오면 서버는 변경 없이 현재 멤버 응답을 반환하고 audit log를 남기지 않는다. UI는 성공으로 간주하고 오류를 지운다.

### 멤버 제거

`owner`가 제거 버튼을 누르면 브라우저 확인창을 띄운다.

```text
이 멤버를 프로젝트에서 제거할까요?
```

확인하면 `DELETE` API를 호출한다. 성공하면 목록에서 해당 멤버를 제거한다. 취소하면 API를 호출하지 않는다.

제거 금지 범위:

| 대상 | 결과 |
| --- | --- |
| 자기 자신 | `403 self_owner_change_forbidden` |
| 마지막 owner | `403 last_owner_forbidden` |
| 존재하지 않는 멤버 | `404 project_member_not_found` |

제거 중인 row는 select와 제거 버튼을 disabled 처리한다.

## API 설계

### 공통 권한

역할 변경/제거 API는 모두 기존 Admin BFF 아래에 둔다.

권한:

| 요청자 | 결과 |
| --- | --- |
| `owner` | 허용 |
| `admin` | `403 project_role_forbidden` |
| `viewer` | `403 project_role_forbidden` |
| 멤버 아님 | `403 project_access_denied` |

프로젝트가 없으면 `404 project_not_found`를 반환한다. 세션이 없으면 `401 admin_auth_required`를 반환한다. 변경 요청이므로 CSRF 검증은 기존 POST/PATCH/DELETE 규칙을 따른다.

### `PATCH /admin/api/projects/:projectId/members/:adminUserId`

프로젝트 멤버 역할을 변경한다.

요청:

```json
{
  "role": "admin"
}
```

`role`은 `owner`, `admin`, `viewer`만 허용한다.

응답:

```json
{
  "adminUserId": "admin_def",
  "email": "member@example.com",
  "name": "Member",
  "role": "admin",
  "createdAt": "2026-08-28T00:00:00.000Z"
}
```

오류:

| 상황 | 응답 |
| --- | --- |
| 세션 없음 | `401 admin_auth_required` |
| CSRF 실패 | 기존 규칙과 동일한 `403 csrf_*` |
| 프로젝트 없음 | `404 project_not_found` |
| 요청자가 프로젝트 멤버 아님 | `403 project_access_denied` |
| 요청자가 owner 아님 | `403 project_role_forbidden` |
| 대상 멤버 없음 | `404 project_member_not_found` |
| role 형식 오류 | `400 invalid_project_member` |
| 자기 자신 owner 권한 강등 | `403 self_owner_change_forbidden` |
| 마지막 owner 강등 | `403 last_owner_forbidden` |

성공적으로 역할이 바뀌면 `project.member_role_updated` audit log를 남긴다.

```json
{
  "targetAdminUserId": "admin_def",
  "email": "member@example.com",
  "beforeRole": "viewer",
  "afterRole": "admin"
}
```

동일 역할 요청은 현재 멤버 응답을 반환하고 audit log를 남기지 않는다.

### `DELETE /admin/api/projects/:projectId/members/:adminUserId`

프로젝트 멤버를 제거한다.

성공 응답은 body 없는 `204`이다.

오류:

| 상황 | 응답 |
| --- | --- |
| 세션 없음 | `401 admin_auth_required` |
| CSRF 실패 | 기존 규칙과 동일한 `403 csrf_*` |
| 프로젝트 없음 | `404 project_not_found` |
| 요청자가 프로젝트 멤버 아님 | `403 project_access_denied` |
| 요청자가 owner 아님 | `403 project_role_forbidden` |
| 대상 멤버 없음 | `404 project_member_not_found` |
| 자기 자신 제거 | `403 self_owner_change_forbidden` |
| 마지막 owner 제거 | `403 last_owner_forbidden` |

성공하면 `project.member_removed` audit log를 남긴다.

```json
{
  "targetAdminUserId": "admin_def",
  "email": "member@example.com",
  "role": "viewer"
}
```

## Store 설계

기존 `TraceStore`는 멤버 추가를 위해 `addProjectMembershipWithAudit`을 갖고 있다. 변경/제거도 audit와 멤버십 변경을 함께 다뤄야 하므로 다음 계약을 추가한다.

```ts
updateProjectMembershipRoleWithAudit(
  input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    role: AdminRole;
    auditLog?: CreateAuditLogInput;
  },
): Promise<ProjectMembershipRecord | undefined>;

removeProjectMembershipWithAudit(
  input: {
    projectId: string;
    targetAdminUserId: string;
    requestedByAdminUserId: string;
    auditLog: CreateAuditLogInput;
  },
): Promise<boolean>;
```

스토어 메서드는 다음 보호 규칙을 membership 변경과 같은 원자 구간에서 검사한다.

| 조건 | 동작 |
| --- | --- |
| 대상 멤버가 없음 | `undefined` 또는 `false` 반환, audit 없음 |
| 자기 자신을 `admin/viewer`로 강등 | `self_owner_change_forbidden` throw, 변경 없음, audit 없음 |
| 자기 자신 제거 | `self_owner_change_forbidden` throw, 변경 없음, audit 없음 |
| 마지막 owner를 `admin/viewer`로 강등 | `last_owner_forbidden` throw, 변경 없음, audit 없음 |
| 마지막 owner 제거 | `last_owner_forbidden` throw, 변경 없음, audit 없음 |
| 동일 역할 변경 | 현재 멤버 반환, audit 없음 |
| 정상 역할 변경/제거 | membership 변경과 audit 저장을 같은 원자 구간에서 수행 |

`SqliteStore`는 transaction 안에서 대상 멤버 조회, owner 수 확인, update/delete, audit insert를 처리한다. `MemoryStore`는 같은 synchronous section에서 membership map과 audit map을 변경한다. route가 사전 검사를 일부 수행할 수는 있지만, 최종 self/last-owner 보호는 store 메서드가 다시 강제하고 route는 store error를 HTTP 오류로 변환해야 한다.

스토어 오류 문자열은 API 오류 코드와 동일하게 둔다.

```ts
"self_owner_change_forbidden";
"last_owner_forbidden";
```

## Admin UI 설계

`apps/admin/src/api.ts`에 다음 함수를 추가한다.

```ts
export async function updateProjectMemberRole(
  projectId: string,
  adminUserId: string,
  input: { role: ProjectRole },
  csrfToken: string,
): Promise<ProjectMemberResponse>;

export async function removeProjectMember(
  projectId: string,
  adminUserId: string,
  csrfToken: string,
): Promise<void>;
```

`ProjectSettingsPage`는 멤버 row별 작업 상태를 props로 받는다.

```ts
currentAdminUserId: string;
memberActionInFlight?: string | undefined;
onUpdateMemberRole: (adminUserId: string, role: ProjectRole) => void;
onRemoveMember: (adminUserId: string) => void;
```

row의 `adminUserId`가 `memberActionInFlight`와 같으면 역할 select와 제거 버튼을 disabled 처리한다.

`owner`만 row action을 볼 수 있다. `admin/viewer`는 기존처럼 목록과 read-only 안내만 본다.

UI도 명백히 실패할 작업은 비활성화한다.

- 현재 사용자 row의 제거 버튼은 disabled 처리한다.
- 현재 사용자 row가 `owner`이면 `admin/viewer` option을 disabled 처리한다.
- owner가 한 명뿐이고 대상 row가 `owner`이면 제거 버튼과 `admin/viewer` option을 disabled 처리한다.
- 이 UI 제한은 편의 장치이고, 서버 보호 규칙이 최종 기준이다.

## App 상태 설계

`App.tsx`의 settings 상태에 다음 값을 추가한다.

```ts
currentAdminUserId: string;
memberActionInFlight?: string | undefined;
memberActionError?: string | undefined;
memberActionSavedMessage?: string | undefined;
```

역할 변경 성공:

- `members` 배열에서 해당 `adminUserId` 항목을 서버 응답으로 교체한다.
- `memberActionSavedMessage`는 `멤버 역할을 변경했습니다.`로 표시한다.

역할 변경 실패:

- 기존 `members` 배열을 유지한다.
- `memberActionError`에 한국어 메시지를 표시한다.

제거 성공:

- `members` 배열에서 해당 `adminUserId`를 제거한다.
- `memberActionSavedMessage`는 `멤버를 제거했습니다.`로 표시한다.

제거 실패:

- 기존 `members` 배열을 유지한다.
- `memberActionError`에 한국어 메시지를 표시한다.

설정 화면에서 대시보드로 돌아가거나 로그아웃, 프로젝트 전환이 발생하면 pending response는 현재 `state.type === "settings" && state.projectId === capturedProjectId` guard로 무시한다.

## 오류 메시지

역할 변경:

| 오류 코드 | 문구 |
| --- | --- |
| `project_role_forbidden` | `멤버를 관리할 권한이 없습니다.` |
| `project_member_not_found` | `멤버를 찾을 수 없습니다.` |
| `last_owner_forbidden` | `마지막 소유자는 변경하거나 제거할 수 없습니다.` |
| `self_owner_change_forbidden` | `내 소유자 권한은 직접 변경할 수 없습니다.` |
| `invalid_project_member` | `멤버 역할이 올바르지 않습니다.` |
| `csrf_origin_invalid` / `csrf_token_invalid` | `보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.` |
| fallback | `멤버를 변경하지 못했습니다.` |

제거:

| 오류 코드 | 문구 |
| --- | --- |
| `project_role_forbidden` | `멤버를 관리할 권한이 없습니다.` |
| `project_member_not_found` | `멤버를 찾을 수 없습니다.` |
| `last_owner_forbidden` | `마지막 소유자는 변경하거나 제거할 수 없습니다.` |
| `self_owner_change_forbidden` | `내 소유자 권한은 직접 변경할 수 없습니다.` |
| `csrf_origin_invalid` / `csrf_token_invalid` | `보안 확인에 실패했습니다. 새로고침 후 다시 시도해주세요.` |
| fallback | `멤버를 제거하지 못했습니다.` |

## 테스트 전략

### Store

`store-contract.test.ts`에서 MemoryStore와 SqliteStore 공통 계약으로 검증한다.

- 역할 변경 성공 시 role만 바뀌고 `createdAt`은 유지된다.
- 동일 역할 변경은 멤버를 반환하고 audit log를 추가하지 않는다.
- 없는 멤버 역할 변경은 `undefined`를 반환한다.
- 제거 성공 시 멤버십이 사라지고 audit log가 남는다.
- 없는 멤버 제거는 `false`를 반환하고 audit log를 남기지 않는다.
- 자기 자신 owner 강등/제거는 store 원자 구간에서 거부되고 기존 membership과 audit log가 유지된다.
- 마지막 owner 강등/제거는 store 원자 구간에서 거부되고 기존 membership과 audit log가 유지된다.

### API

`admin.test.ts`에서 검증한다.

- owner가 다른 멤버를 `owner/admin/viewer`로 변경할 수 있다.
- admin/viewer는 역할 변경과 제거가 `403 project_role_forbidden`이다.
- non-member는 기존처럼 `403 project_access_denied`이다.
- 없는 대상 멤버는 `404 project_member_not_found`이다.
- 잘못된 role은 `400 invalid_project_member`이다.
- 자기 자신 강등은 `403 self_owner_change_forbidden`이다.
- 자기 자신 제거는 `403 self_owner_change_forbidden`이다.
- 마지막 owner 강등과 제거는 `403 last_owner_forbidden`이다.
- 역할 변경 성공 audit log는 `project.member_role_updated`와 `{ targetAdminUserId,email,beforeRole,afterRole }` metadata를 갖는다.
- 제거 성공 audit log는 `project.member_removed`와 `{ targetAdminUserId,email,role }` metadata를 갖는다.
- 동일 역할 변경은 audit log를 추가하지 않는다.

### Admin UI

`ProjectSettingsPage.test.tsx`에서 검증한다.

- owner row에는 역할 select와 제거 버튼이 보인다.
- admin/viewer row에는 변경/제거 컨트롤이 보이지 않는다.
- 역할 select 변경 시 `onUpdateMemberRole(adminUserId, role)`이 호출된다.
- 제거 버튼 클릭 후 confirm 취소 시 `onRemoveMember`가 호출되지 않는다.
- confirm 승인 시 `onRemoveMember(adminUserId)`가 호출된다.
- `memberActionInFlight` 대상 row 컨트롤은 disabled 된다.
- 자기 자신 owner row의 제거 버튼과 `admin/viewer` option이 disabled 된다.
- 마지막 owner row의 제거 버튼과 `admin/viewer` option이 disabled 된다.
- 오류/성공 메시지가 표시된다.

`App.test.tsx`에서 검증한다.

- 역할 변경 성공 시 멤버 목록 역할이 갱신된다.
- 역할 변경 실패 시 한국어 오류 메시지가 표시되고 기존 역할이 유지된다.
- 제거 성공 시 멤버가 목록에서 사라진다.
- 제거 실패 시 한국어 오류 메시지가 표시되고 멤버가 유지된다.
- 역할 변경/제거 중 로그아웃 또는 대시보드 복귀 후 지연 응답이 settings 화면을 다시 쓰지 않는다.

## 마이그레이션과 호환성

DB schema 변경은 없다. 기존 `project_memberships` primary key와 `audit_logs` 테이블을 그대로 사용한다.

새 API와 UI는 기존 멤버 추가 기능을 보존한다. 기존 멤버 목록 응답 shape도 바꾸지 않는다.

## 완료 기준

- owner가 설정 화면에서 멤버 역할을 변경하고 제거할 수 있다.
- admin/viewer는 멤버 목록만 볼 수 있고 변경/제거 컨트롤은 보지 못한다.
- 본인 owner 권한 상실과 마지막 owner 상실이 서버에서 차단된다.
- 성공/실패 audit log와 오류 응답이 설계와 일치한다.
- `npm run typecheck`, `npm test`, `git diff --check`가 통과한다.
