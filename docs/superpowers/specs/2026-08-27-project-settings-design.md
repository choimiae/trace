# 프로젝트 설정 화면 Design

작성일 2026-08-27 · 브랜치 `main`

## 배경

관리자 UI 정비가 끝났고, 다음 화면들을 새 토큰과 프리미티브 체계 위에 올릴 수 있게 됐다. 현재 프로젝트는 생성할 수 있지만, 생성 후 이름이나 허용 도메인을 고칠 방법이 없다. 설치 중 도메인을 잘못 넣거나 운영 도메인이 추가되면 데이터 수집 설정을 바로잡기 위해 코드나 DB를 직접 만져야 한다.

권한 모델은 이미 `owner` · `admin` · `viewer` 세 역할을 갖고 있다. 다만 현재 API는 대부분 프로젝트 멤버십 여부만 확인하고 역할별 차이를 적용하지 않는다. 프로젝트 설정 화면은 이 역할 차이를 처음으로 제품 동작에 반영하는 작은 경계가 된다.

## 목적

관리자가 프로젝트 이름과 허용 도메인을 안전하게 수정할 수 있게 한다. `owner`와 `admin`은 저장할 수 있고, `viewer`는 같은 화면을 볼 수 있지만 읽기 전용이다.

이번 작업은 프로젝트 설정 자체에 집중한다. 프로젝트 전환 UI, 멤버 관리, 권한 변경, 프로젝트 삭제는 별도 사이클에서 다룬다.

## 범위

**한다**

- 프로젝트 상세 조회 API 추가
- 프로젝트 설정 수정 API 추가
- `TraceStore` 프로젝트 수정 계약 추가
- `MemoryStore`와 `SqliteStore` 수정 구현
- 프로젝트 설정 화면 추가
- 대시보드에서 설정 화면으로 이동하는 진입점 추가
- `owner/admin/viewer/non-member` 권한 테스트
- 수정 성공 audit log 기록

**하지 않는다**

- 프로젝트 삭제
- 멤버 초대, 제거, 역할 변경
- 프로젝트 전환 드롭다운
- 개인정보 설정 UI
- 허용 도메인 와일드카드 또는 패턴 매칭
- 여러 프로젝트를 한 번에 관리하는 목록형 설정 화면

## 확정된 제품 동작

### 수정 가능한 값

설정 화면에서 다루는 값은 두 개다.

| 값 | 동작 |
| --- | --- |
| 프로젝트 이름 | 비어 있으면 저장할 수 없다 |
| 허용 도메인 | 하나 이상 필요하며 URL origin 으로 정규화하고 중복 제거한다 |

허용 도메인 정규화는 프로젝트 생성과 같은 규칙을 쓴다. 사용자가 `https://example.com/path?a=1`을 넣으면 저장값은 `https://example.com`이 된다.

### 권한

역할별 화면과 API 동작은 다음과 같다.

| 역할 | 조회 | 수정 |
| --- | --- | --- |
| `owner` | 가능 | 가능 |
| `admin` | 가능 | 가능 |
| `viewer` | 가능 | 불가 |
| 멤버 아님 | 불가 | 불가 |

`viewer`는 설정 내용을 확인해야 설치 상태나 도메인 제한을 이해할 수 있으므로 화면 접근은 허용한다. 단, 입력 필드와 저장 버튼은 비활성화하고 읽기 전용 안내를 표시한다.

## API 설계

### `GET /admin/api/projects/:projectId`

현재 로그인 사용자가 해당 프로젝트 멤버이면 프로젝트 설정 정보를 반환한다.

응답:

```json
{
  "projectId": "proj_abc",
  "name": "Marketing Site",
  "allowedDomains": ["https://example.com"],
  "role": "owner"
}
```

프로젝트가 없으면 `404`를 반환한다. 프로젝트는 있지만 멤버가 아니면 `403`을 반환하고 기존 접근 거부 audit 규칙을 따른다.

### `PATCH /admin/api/projects/:projectId`

현재 로그인 사용자가 `owner` 또는 `admin`이면 프로젝트 설정을 수정한다.

요청:

```json
{
  "name": "Marketing Site",
  "allowedDomains": ["https://example.com", "https://app.example.com"]
}
```

응답은 `GET`과 같은 프로젝트 설정 객체를 반환한다. 저장 성공 시 audit log에 `project.updated`를 기록한다. metadata에는 변경 전후 이름과 허용 도메인을 넣어 향후 운영자가 변경 이력을 추적할 수 있게 한다.

audit metadata:

```json
{
  "before": {
    "name": "Old Project",
    "allowedDomains": ["https://old.example.com"]
  },
  "after": {
    "name": "New Project",
    "allowedDomains": ["https://new.example.com"]
  }
}
```

권한 오류:

- 프로젝트 없음: `404`
- 멤버 아님: `403`
- `viewer`: `403`
- CSRF 실패: 기존 관리자 POST 계열과 동일한 `403`

검증 오류:

- `name`이 빈 문자열: `400`
- `allowedDomains`가 빈 배열: `400`
- URL로 파싱할 수 없는 값: `400`

## Store 설계

`TraceStore`에 프로젝트 수정 메서드를 추가한다.

```ts
export interface UpdateProjectInput {
  name: string;
  allowedDomains: string[];
}

updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectRecord | undefined>;
```

없는 프로젝트를 수정하면 `undefined`를 반환한다. API 계층은 이 값을 `404`로 바꾼다.

`privacyConfig`, `projectId`, `createdAt`은 수정하지 않는다. 이 작업은 이름과 허용 도메인만 바꾸는 좁은 계약이다.

`MemoryStore`는 기존 `Map`의 레코드를 교체한다. `SqliteStore`는 `projects` 테이블의 `name`, `allowed_domains`만 갱신한다. 별도 마이그레이션은 필요하지 않다.

## Admin UI 설계

### 화면 구조

`ProjectSettingsPage`를 `apps/admin/src/pages/`에 추가한다. 기존 프로젝트 생성 화면과 같은 프리미티브를 사용한다.

- 상단: 프로젝트 이름, 현재 역할, 대시보드로 돌아가기 버튼
- 본문 카드: 프로젝트 이름 필드
- 본문 카드: 허용 도메인 textarea
- 하단 액션: 저장 버튼, 저장 상태 메시지

`allowedDomains`는 기존 프로젝트 생성 화면과 같은 입력 경험을 유지한다. 한 줄에 하나의 URL을 입력하고 저장 시 배열로 변환한다.

### 진입점

대시보드 상단의 현재 프로젝트 영역에 설정 버튼을 추가한다. 아직 프로젝트 전환 UI가 없으므로, 현재 선택된 프로젝트의 설정으로만 이동한다.

별도 라우터는 도입하지 않는다. 현재 `AppState` 기반 화면 전환 방식을 유지하고, `settings` 상태를 추가한다.

### 읽기 전용

`viewer`에게는 같은 화면을 보여주되 다음을 적용한다.

- 이름 입력 비활성화
- 허용 도메인 입력 비활성화
- 저장 버튼 표시 유지, 비활성화
- 읽기 전용 안내 문구 표시

제품 카피는 한국어로 쓴다.

### 저장 후 상태

저장 성공 시 화면 안에 성공 메시지를 표시하고, 앱이 들고 있는 현재 프로젝트 표시 정보도 새 이름으로 갱신한다. 실패 시 API 오류 메시지를 기존 패턴대로 표시한다.

## 데이터 흐름

1. 사용자가 대시보드에서 설정 버튼을 누른다.
2. Admin 앱이 `GET /admin/api/projects/:projectId`를 호출한다.
3. 응답 role이 `viewer`이면 폼을 읽기 전용으로 렌더한다.
4. `owner/admin`이 값을 수정하고 저장한다.
5. Admin 앱이 CSRF 토큰과 함께 `PATCH /admin/api/projects/:projectId`를 호출한다.
6. API가 멤버십과 role을 확인한다.
7. Store가 프로젝트 이름과 허용 도메인을 갱신한다.
8. API가 `project.updated` audit log를 기록하고 갱신된 설정 객체를 반환한다.
9. Admin 앱이 화면 상태와 현재 프로젝트 표시 정보를 갱신한다.

## 오류 처리

프로젝트 상세 조회 실패는 기존 상태 화면 패턴과 맞춘다.

- `401`: 로그인 상태 재확인 흐름으로 보낸다.
- `403`: 접근 권한 없음 화면 또는 설정 화면 내 권한 없음 상태로 표시한다.
- `404`: 프로젝트를 찾을 수 없다는 상태를 표시하고 대시보드로 돌아갈 수 있게 한다.
- 네트워크 오류: 연결 실패 상태를 표시한다.

수정 실패는 설정 화면 안에 표시한다. 사용자가 입력한 값을 유지해서 다시 고칠 수 있게 한다.

## 테스트 전략

### API

`apps/api/src/routes/admin.test.ts`에 다음 케이스를 추가한다.

- 프로젝트 멤버가 `GET /admin/api/projects/:projectId`로 설정을 조회할 수 있다.
- 멤버가 아닌 사용자는 조회할 수 없고 접근 거부 audit가 남는다.
- `owner`가 `PATCH`로 이름과 허용 도메인을 수정할 수 있다.
- `admin`이 `PATCH`로 이름과 허용 도메인을 수정할 수 있다.
- `viewer`는 `PATCH`가 `403`이다.
- 수정 성공 시 `project.updated` audit log가 남는다.
- 잘못된 URL, 빈 이름, 빈 도메인 배열은 `400`이다.

### Store

`apps/api/src/store/store-contract.test.ts`에 memory/sqlite 공통 계약을 추가한다.

- `updateProject`가 이름과 허용 도메인을 갱신한다.
- `updateProject`가 `privacyConfig`, `projectId`, `createdAt`을 유지한다.
- 없는 프로젝트는 `undefined`를 반환한다.

### Admin

`apps/admin/src/App.test.tsx` 또는 페이지 테스트에 다음 케이스를 추가한다.

- 대시보드에서 설정 버튼을 눌러 설정 화면으로 이동한다.
- 설정 화면이 프로젝트 이름과 허용 도메인을 렌더한다.
- `owner/admin`은 값을 수정하고 저장할 수 있다.
- 저장 성공 후 성공 메시지와 갱신된 프로젝트 이름이 보인다.
- 검증/API 오류가 화면에 표시되고 입력값이 유지된다.
- `viewer`는 읽기 전용으로 보이며 저장할 수 없다.

## 구현 순서

1. API schema와 store 계약을 테스트로 먼저 고정한다.
2. `MemoryStore`와 `SqliteStore`에 `updateProject`를 구현한다.
3. 프로젝트 상세 조회와 수정 라우트를 추가한다.
4. Admin API 클라이언트 함수를 추가한다.
5. `ProjectSettingsPage`를 추가한다.
6. `AppState`에 설정 화면 상태와 전환 핸들러를 연결한다.
7. 전체 테스트, typecheck, build를 통과시킨다.

## 알려진 마찰

- 현재 `/auth/me`의 프로젝트 목록은 `projectId`와 `role`만 내려준다. 설정 저장 후 앱 안에서 프로젝트 이름을 보여주려면 앱 상태에 별도 이름 필드를 추가하거나 프로젝트 상세 응답으로 갱신해야 한다.
- `admin` 역할을 만드는 사용자 흐름은 아직 없다. API 테스트에서는 store에 멤버십을 직접 추가해 역할별 정책을 검증한다.
- 프로젝트 전환 UI가 없으므로 설정 진입점은 현재 선택된 프로젝트 하나에만 연결한다.
- audit log 조회 화면은 없지만, 저장 시점에 로그를 남겨 향후 운영 화면이 붙을 수 있게 한다.
