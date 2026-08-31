# 프로젝트 멤버 후보 검색 Design

작성일 2026-08-31 · 브랜치 `design/project-member-candidates`

## 배경

프로젝트 설정 화면에는 멤버 목록, 기존 관리자 사용자 이메일 입력 기반 멤버 추가, 역할 변경, 제거가 있다. 현재 멤버 추가는 owner가 대상 사용자의 이메일을 정확히 알고 입력해야 한다. 대상이 이미 admin user로 존재하는지, 이미 프로젝트 멤버인지도 제출 전에는 알기 어렵다.

다음 작은 개선은 초대 시스템으로 확장하지 않고, 이미 존재하는 admin user를 검색해서 선택한 뒤 프로젝트 멤버로 추가하는 흐름을 제공하는 것이다.

## 목적

프로젝트 owner가 프로젝트 설정 화면에서 기존 관리자 사용자를 이름/이메일로 검색하고, 검색 결과에서 멤버 여부를 확인한 뒤 아직 멤버가 아닌 사용자만 선택해 추가할 수 있게 한다.

이미 프로젝트에 속한 사용자는 검색 결과에서 숨기지 않는다. 대신 `이미 멤버` 상태를 표시하고 선택할 수 없게 한다. 사용자가 검색한 사람이 왜 추가 대상에 없는지 혼란스럽지 않게 만드는 것이 핵심이다.

## 범위

**한다**

- 프로젝트별 멤버 후보 검색 API를 추가한다.
- 검색 대상은 기존 `admin_users`에 존재하는 사용자로 제한한다.
- 검색 결과에는 이미 프로젝트 멤버인 사용자도 포함한다.
- 이미 멤버인 사용자에는 `이미 멤버` 상태와 기존 역할을 표시한다.
- 이미 멤버인 사용자는 선택과 추가를 막는다.
- 아직 멤버가 아닌 사용자만 선택할 수 있다.
- owner만 멤버 후보를 검색하고 추가할 수 있다.
- 프로젝트 설정 화면의 멤버 추가 폼을 이메일 직접 입력 중심에서 사용자 검색/선택 중심으로 바꾼다.
- 선택한 사용자의 이메일과 이름을 요약 표시하고, 역할 선택 후 기존 멤버 추가 API로 추가한다.
- 기존 중복 추가, 존재하지 않는 사용자, CSRF, 권한 오류 방어는 서버에 유지한다.
- Store, API, Admin UI, App 상태 전이 테스트를 추가한다.

**하지 않는다**

- 아직 로그인하지 않은 이메일 초대나 pending invite를 만든다.
- 이메일 발송, 초대 토큰, 초대 수락 화면을 만든다.
- admin user 생성 flow를 만든다.
- 전체 사용자 관리 화면을 만든다.
- 프로젝트 멤버 목록 자체의 검색, 페이지네이션, 정렬을 만든다.
- 선택한 이미 멤버의 역할 변경 shortcut을 검색 결과에 넣지 않는다. 역할 변경은 기존 멤버 row에서 수행한다.
- owner가 아닌 사용자에게 admin user 검색 기능을 제공하지 않는다.

## 제품 동작

### 화면 위치

기존 `ProjectSettingsPage` 하단 멤버 섹션의 owner 전용 추가 영역을 바꾼다. 멤버 목록과 row action은 유지한다.

owner는 멤버 목록 아래에서 다음 순서로 본다.

1. 사용자 검색 입력
2. 검색 결과 목록
3. 선택된 사용자 요약
4. 역할 select
5. `멤버 추가` 버튼

admin/viewer는 기존처럼 멤버 목록만 보고 `멤버 추가 권한이 없습니다.` 안내를 본다.

### 검색 입력

검색 입력의 안내 문구는 `이름 또는 이메일로 검색`으로 둔다.

검색어가 비어 있어도 후보를 보여준다. 처음 화면에 들어왔을 때 owner가 곧바로 선택할 수 있도록, 서버는 기본 후보를 최대 20명 반환한다. 기본 후보는 이메일 오름차순으로 정렬한다.

검색어가 있으면 이름 또는 이메일에 부분 일치하는 사용자를 최대 20명 반환한다. 검색어는 trim하고 대소문자를 구분하지 않는다.

### 검색 결과

각 검색 결과 row는 다음 정보를 표시한다.

- 이름이 있으면 이름
- 이메일
- 현재 프로젝트 멤버 상태

상태 표시는 다음과 같다.

| 상태 | 표시 | 선택 가능 |
| --- | --- | --- |
| 현재 프로젝트 멤버 아님 | `추가 가능` | 가능 |
| 현재 프로젝트 `owner` | `이미 멤버 · 소유자` | 불가 |
| 현재 프로젝트 `admin` | `이미 멤버 · 관리자` | 불가 |
| 현재 프로젝트 `viewer` | `이미 멤버 · 조회자` | 불가 |

이미 멤버인 row는 disabled 스타일을 적용한다. 클릭해도 선택 상태가 바뀌지 않는다.

검색 결과가 없으면 `검색 결과가 없습니다.`를 보여준다.

검색 실패 시 `사용자를 검색하지 못했습니다.`를 보여주고 기존 선택 상태는 유지한다.

### 사용자 선택과 추가

owner가 `추가 가능` 사용자를 선택하면 선택된 사용자 요약을 보여준다.

```text
선택됨: Member Name · member@example.com
```

이메일 input 직접 입력은 제거한다. 선택된 사용자가 없으면 `멤버 추가` 버튼은 disabled이다.

역할 select는 기존 추가 흐름처럼 `admin`, `viewer`만 제공한다. 기본값은 `viewer`이다. `owner` 추가는 검색/선택 추가에서는 제공하지 않는다. owner 승격은 기존 멤버 row의 역할 변경에서 수행한다.

추가 성공 시:

- 기존 멤버 목록에 서버가 반환한 member를 추가한다.
- 선택된 사용자를 해제한다.
- 검색 결과에서 해당 사용자를 `이미 멤버 · <역할>` 상태로 갱신한다.
- 성공 메시지 `멤버를 추가했습니다.`를 표시한다.

추가 실패 시:

- 선택 상태는 유지한다.
- 기존 오류 메시지 매핑을 사용한다.
- 중복 추가가 서버에서 반환되면 `이미 이 프로젝트의 멤버입니다.`를 표시한다. 검색 결과 상태는 별도 추측으로 바꾸지 않고, 다음 후보 검색 응답에서 서버 기준 상태를 반영한다.

## API 설계

### `GET /admin/api/projects/:projectId/member-candidates`

기존 admin user 중 프로젝트 멤버 추가 후보를 반환한다.

Query:

| 이름 | 설명 |
| --- | --- |
| `query` | 선택. 이름 또는 이메일 부분 검색어. trim 후 빈 문자열이면 기본 후보를 반환한다. |
| `limit` | 선택. 1-50 사이 숫자. 기본 20. UI는 20을 사용한다. |

권한:

| 요청자 | 결과 |
| --- | --- |
| `owner` | 허용 |
| `admin` | `403 project_role_forbidden` |
| `viewer` | `403 project_role_forbidden` |
| 멤버 아님 | `403 project_access_denied` |

프로젝트가 없으면 `404 project_not_found`를 반환한다. 세션이 없으면 `401 admin_auth_required`를 반환한다. 조회 API이므로 CSRF는 요구하지 않는다.

응답:

```json
[
  {
    "adminUserId": "admin_abc",
    "email": "owner@example.com",
    "name": "Owner",
    "membership": {
      "role": "owner"
    }
  },
  {
    "adminUserId": "admin_def",
    "email": "member@example.com",
    "name": "Member"
  }
]
```

`membership`이 있으면 현재 프로젝트 멤버이다. `membership`이 없으면 추가 가능 사용자이다. 응답은 이메일 오름차순으로 정렬한다.

오류:

| 상황 | 응답 |
| --- | --- |
| 세션 없음 | `401 admin_auth_required` |
| 프로젝트 없음 | `404 project_not_found` |
| 요청자가 프로젝트 멤버 아님 | `403 project_access_denied` |
| 요청자가 owner 아님 | `403 project_role_forbidden` |
| `limit`이 범위를 벗어남 | `400 invalid_member_candidate_search` |

## Store 설계

`TraceStore`에 admin user 검색 계약을 추가한다.

```ts
searchAdminUsers(input: {
  query: string;
  limit: number;
}): Promise<AdminUserRecord[]>;
```

스토어 책임:

- `query`는 호출자가 trim한 문자열을 받는다.
- 빈 query면 전체 admin user 중 이메일 오름차순 첫 `limit`개를 반환한다.
- query가 있으면 email 또는 name에 case-insensitive 부분 일치하는 사용자를 반환한다.
- 결과는 이메일 오름차순이다.
- membership 여부 계산은 route에서 기존 `listProjectMemberships(projectId)`와 합쳐 만든다.

SQLite는 `LOWER(email) LIKE ? OR LOWER(name) LIKE ?` 조건과 `ORDER BY email ASC LIMIT ?`를 사용한다. MemoryStore는 array filter/sort/slice로 같은 계약을 맞춘다.

## Admin API Client 설계

`apps/admin/src/api.ts`에 타입과 함수를 추가한다.

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

UI는 query 변경 시 이 함수를 호출한다. query는 client에서 trim하지 않아도 되고, 서버가 최종 정규화한다.

## Admin UI 설계

`ProjectSettingsPage`는 후보 목록과 선택 상태를 props로 받는다. 검색 입력의 local state는 페이지 컴포넌트가 갖고, 실제 검색 호출은 `onSearchMemberCandidates(query)`로 상위 App에 위임한다.

추가 props:

```ts
memberCandidates: ProjectMemberCandidateResponse[];
memberCandidateSearchLoading?: boolean;
memberCandidateSearchError?: string | undefined;
selectedMemberCandidate?: ProjectMemberCandidateResponse | undefined;
onSearchMemberCandidates: (query: string) => void;
onSelectMemberCandidate: (candidate: ProjectMemberCandidateResponse) => void;
```

기존 `onAddMember(input)`은 유지하되, `ProjectSettingsPage`가 선택된 후보 이메일과 선택 role로 호출한다.

```ts
onAddMember({
  email: selectedMemberCandidate.email,
  role: memberRole,
});
```

이미 멤버인 후보는 다음 조건으로 선택을 막는다.

```ts
const alreadyMember = candidate.membership !== undefined;
```

검색 입력 변경은 debounce 없이 즉시 상위 handler를 호출한다. 이 프로젝트의 UI는 테스트와 상태 전이가 단순한 직접 호출 패턴을 주로 사용하므로, debounce는 이번 범위에서 제외한다. App은 stale response guard로 늦은 검색 결과를 무시한다.

## App 상태 설계

`App.tsx` settings state에 다음 값을 추가한다.

```ts
memberCandidates: ProjectMemberCandidateResponse[];
memberCandidateQuery: string;
memberCandidateSearchRequestId: number;
memberCandidateSearchLoading: boolean;
memberCandidateSearchError?: string | undefined;
selectedMemberCandidate?: ProjectMemberCandidateResponse | undefined;
```

설정 화면 진입 시:

- 멤버 목록과 프로젝트 설정을 로드한 뒤, 프로젝트 role이 `owner`이면 후보 검색도 빈 query로 한 번 수행한다.
- 후보 검색이 실패해도 설정 화면 진입 자체는 유지한다.
- 실패 시 `사용자를 검색하지 못했습니다.`를 멤버 추가 영역에 표시한다.

검색어 변경 시:

- `memberCandidateQuery`를 갱신한다.
- `memberCandidateSearchRequestId`를 증가시킨다.
- `searchProjectMemberCandidates(projectId, query)`를 호출한다.
- 응답이 돌아왔을 때 `state.type`, `projectId`, `settingsSessionId`, request id가 모두 일치할 때만 후보 목록을 갱신한다.

후보 선택 시:

- `membership`이 있는 후보는 무시한다.
- 추가 가능한 후보만 `selectedMemberCandidate`로 저장한다.

멤버 추가 성공 시:

- 기존 `members` 배열에 추가된 멤버를 append한다.
- `selectedMemberCandidate`를 비운다.
- `memberCandidates`에서 같은 `adminUserId` 후보의 `membership`을 추가된 role로 갱신한다.

멤버 추가 실패 시:

- 선택은 유지한다.
- 오류 메시지는 기존 `describeProjectMemberError`를 사용한다.

로그아웃, 프로젝트 전환, 설정 화면 이탈 후 늦은 검색 응답은 기존 settings session guard로 무시한다.

## 오류 메시지

| 상황 | 문구 |
| --- | --- |
| 후보 검색 실패 | `사용자를 검색하지 못했습니다.` |
| owner 아님 | `멤버를 검색할 권한이 없습니다.` |
| 검색 조건 오류 | `검색 조건이 올바르지 않습니다.` |
| 일반 실패 | `사용자를 검색하지 못했습니다.` |

기존 멤버 추가 오류 문구는 유지한다.

## 테스트 전략

### Store

`store-contract.test.ts`에서 MemoryStore와 SqliteStore 공통 계약으로 검증한다.

- 빈 query는 이메일 오름차순으로 최대 limit만 반환한다.
- email 부분 검색은 대소문자를 구분하지 않는다.
- name 부분 검색은 대소문자를 구분하지 않는다.
- 검색 결과는 이메일 오름차순이다.
- limit이 적용된다.

### API

`admin.test.ts`에서 검증한다.

- owner가 빈 query로 후보를 조회할 수 있다.
- owner가 이름/이메일 query로 후보를 검색할 수 있다.
- 현재 프로젝트 멤버는 `membership.role`과 함께 반환된다.
- 현재 프로젝트 멤버가 아닌 사용자는 `membership` 없이 반환된다.
- admin/viewer는 `403 project_role_forbidden`이다.
- non-member는 `403 project_access_denied`이다.
- 없는 프로젝트는 `404 project_not_found`이다.
- 잘못된 limit은 `400 invalid_member_candidate_search`이다.

### Admin UI

`ProjectSettingsPage.test.tsx`에서 검증한다.

- owner에게 검색 입력과 후보 목록이 보인다.
- admin/viewer에게 검색 입력과 후보 목록이 보이지 않는다.
- 검색 입력 변경 시 `onSearchMemberCandidates(query)`가 호출된다.
- 추가 가능한 후보 클릭 시 `onSelectMemberCandidate(candidate)`가 호출된다.
- 이미 멤버 후보는 `이미 멤버 · <역할>`을 표시하고 클릭해도 선택되지 않는다.
- 선택된 후보가 없으면 `멤버 추가` 버튼이 disabled이다.
- 선택된 후보와 역할로 `onAddMember({ email, role })`이 호출된다.
- 검색 loading/error 상태가 표시된다.

### App

`App.test.tsx`에서 검증한다.

- 설정 진입 시 빈 query 후보 검색을 수행하고 후보 목록을 표시한다.
- 검색어 변경 시 후보 검색 API를 호출하고 결과를 갱신한다.
- 늦은 후보 검색 응답은 request id와 settings session guard로 무시된다.
- 후보 선택 후 멤버 추가 성공 시 멤버 목록과 후보 상태가 함께 갱신된다.
- 멤버 추가 실패 시 선택 상태가 유지되고 기존 오류 문구가 표시된다.
- owner가 아닌 설정 화면에서는 후보 검색 API를 호출하지 않는다.

## 마이그레이션과 호환성

DB schema 변경은 없다. 기존 `admin_users`와 `project_memberships`를 조회해서 후보 상태를 구성한다.

기존 `POST /admin/api/projects/:projectId/members`는 유지한다. 새 검색 UI도 최종 추가는 기존 POST API를 사용하므로 서버 중복 방어와 audit log 흐름은 그대로 유지된다.

## 완료 기준

- owner가 설정 화면 진입 직후 기존 admin user 후보를 볼 수 있다.
- 검색 결과에는 이미 멤버와 추가 가능한 사용자가 모두 표시된다.
- 이미 멤버는 선택할 수 없고, 추가 가능한 사용자만 선택 후 `admin` 또는 `viewer`로 추가할 수 있다.
- 검색/선택/추가 성공과 실패 상태가 한국어 메시지와 함께 동작한다.
- admin/viewer는 후보 검색 기능을 사용할 수 없다.
- `npm run typecheck`, `npm test`, `git diff --check`가 통과한다.
