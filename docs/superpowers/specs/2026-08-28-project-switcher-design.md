# 프로젝트 전환 UI Design

작성일 2026-08-28 · 브랜치 `design/project-switcher`

## 배경

관리자 화면은 이미 여러 프로젝트를 다룰 수 있는 데이터 모델을 갖고 있다. `/auth/me` 응답은 로그인 사용자의 `projects` 배열을 내려주고, Admin UI는 `trace.selectedProjectId` localStorage 값이 현재 계정의 프로젝트 목록에 있으면 그 값을 우선 사용한다. 값이 없거나 더 이상 접근 권한이 없으면 첫 번째 프로젝트를 선택한다.

다만 현재 화면에는 선택 프로젝트를 사용자가 직접 바꾸는 진입점이 없다. 여러 프로젝트가 있는 계정은 저장된 프로젝트 또는 첫 번째 프로젝트에 묶이고, 설정 화면과 설치 안내도 그 프로젝트 기준으로만 열린다.

## 목적

대시보드 헤더에서 현재 프로젝트를 항상 확인하고 전환할 수 있게 한다. 프로젝트를 바꾸면 대시보드 데이터, 프로젝트 설정, 설치 안내가 선택된 프로젝트를 기준으로 동작해야 한다.

이번 작업은 프로젝트 전환 자체에 집중한다. 프로젝트 이름 표시, 프로젝트 생성 진입점 추가, 멤버 관리, 역할 변경, 프로젝트 삭제는 별도 사이클에서 다룬다.

## 범위

**한다**

- 대시보드 헤더에 native `<select>` 프로젝트 선택 박스를 추가한다.
- 프로젝트가 1개여도 선택 박스를 항상 노출한다.
- `/auth/me`의 프로젝트 목록을 dashboard 상태에 보존한다.
- select 변경 시 선택 프로젝트 ID를 localStorage에 저장한다.
- 선택한 프로젝트의 summary/issues를 다시 조회한다.
- 전환 후 설정 화면과 설치 안내는 새 프로젝트 ID를 사용한다.
- 단일/복수 프로젝트, 저장값, 전환, 오류 흐름을 테스트한다.

**하지 않는다**

- 커스텀 드롭다운 컴포넌트
- 별도 프로젝트 선택 화면
- 프로젝트 이름 표시를 위한 API 확장
- 설정 화면 안의 프로젝트 전환 UI
- 프로젝트 생성 버튼을 헤더에 추가
- 프로젝트 멤버 관리, 권한 변경, 삭제

## 확정된 제품 동작

### 표시

대시보드 헤더의 사용자 이메일 근처에 `프로젝트` label과 `<select>`를 표시한다. 선택지는 `/auth/me.projects`의 `projectId`를 사용한다.

프로젝트가 1개뿐이어도 select는 숨기지 않는다. 이 방식은 헤더 레이아웃을 일정하게 유지하고, 계정에 프로젝트가 추가됐을 때 UI가 갑자기 새로 생기는 느낌을 줄인다.

프로젝트 이름은 이번 범위에서 표시하지 않는다. 현재 `/auth/me` 응답은 이름을 포함하지 않고, 선택 UI를 위해 추가 API 호출을 만들면 초기 로딩과 오류 처리가 커진다. 프로젝트 이름 표시가 필요해지면 `/auth/me.projects` 응답에 이름을 포함하는 API 변경으로 별도 진행한다.

### 초기 선택

초기 로딩은 기존 규칙을 유지한다.

1. `trace.selectedProjectId`를 읽는다.
2. 저장된 ID가 `/auth/me.projects` 안에 있으면 그 프로젝트를 선택한다.
3. 저장된 ID가 없거나 현재 계정의 프로젝트가 아니면 첫 번째 프로젝트를 선택한다.
4. 프로젝트가 없으면 기존처럼 프로젝트 생성 화면으로 이동한다.

초기 선택이 정해지면 해당 프로젝트 ID를 localStorage에 다시 저장한다.

### 전환

사용자가 select에서 다른 프로젝트를 고르면 다음 순서로 처리한다.

1. 선택된 issue 상세 모달을 닫는다.
2. 새 프로젝트 ID를 localStorage에 저장한다.
3. 앱 상태를 `loading`으로 바꾼다.
4. 새 프로젝트의 summary/issues를 조회한다.
5. 성공하면 대시보드로 돌아온다.

기존 `AppState` 기반 화면 전환을 유지한다. 라우터나 전역 상태 라이브러리는 도입하지 않는다.

전환 후 대시보드에서 `프로젝트 설정`을 누르면 새 프로젝트 ID로 `GET /admin/api/projects/:projectId`를 호출한다. `설치 안내`를 누르면 새 프로젝트 ID가 들어간 스니펫을 보여준다.

### 오류 처리

프로젝트 전환 중 dashboard 데이터 조회가 실패하면 기존 초기 로딩 오류 규칙과 맞춘다.

| 오류 | 화면 |
| --- | --- |
| `401` | 로그인 화면 |
| `403` | 접근 권한 없음 화면 |
| 기타 | 연결 실패 화면 |

전환 실패 시 localStorage에는 사용자가 고른 프로젝트 ID가 남는다. 사용자가 명시적으로 선택한 값이므로, 새로고침 후에도 같은 프로젝트를 다시 시도하는 것이 자연스럽다. 만약 다음 `/auth/me`에서 그 프로젝트가 더 이상 목록에 없으면 기존 초기 선택 규칙에 따라 첫 번째 프로젝트로 fallback한다.

## UI 설계

새 UI는 대시보드 헤더 안에 둔다.

```tsx
<label className="project-switcher">
  <span>프로젝트</span>
  <select value={projectId} onChange={(event) => onSelectProject(event.currentTarget.value)}>
    <option value="proj_demo">proj_demo</option>
  </select>
</label>
```

CSS는 현재 `pages.css`의 `header-actions`, `user-email`, 버튼 톤에 맞춘다. select는 과하게 커스텀하지 않고, 현재 토큰의 border/background/text 색을 사용한다. 모바일에서는 기존 header action wrapping 안에서 자연스럽게 줄바꿈된다.

## 데이터 흐름

`AuthMeResponse["projects"]` 타입을 기준으로 `ProjectOption` alias를 둔다. 이 alias는 Admin UI 내부 props에서만 쓰고 API 응답 구조는 바꾸지 않는다.

`AppState.ready`에 다음 값을 추가한다.

```ts
type ProjectOption = AuthMeResponse["projects"][number];

projects: ProjectOption[];
```

설정 관련 상태에서도 대시보드로 돌아올 때 프로젝트 목록을 잃지 않도록 같은 목록을 보존한다.

`DashboardPage` props에는 다음을 추가한다.

```ts
projects: ProjectOption[];
projectId: string;
onSelectProject: (projectId: string) => void;
```

`App`은 `handleSelectProject`를 추가한다. 이 핸들러는 `ready` 상태에서만 동작한다.

## 테스트 설계

`apps/admin/src/App.test.tsx`에 다음 케이스를 추가한다.

- 단일 프로젝트 계정에서도 프로젝트 select가 보인다.
- 저장된 프로젝트 ID가 현재 계정 프로젝트 목록에 있으면 그 프로젝트로 대시보드를 조회한다.
- 저장된 프로젝트 ID가 현재 계정 프로젝트 목록에 없으면 첫 번째 프로젝트로 fallback한다.
- select 변경 시 새 프로젝트 ID로 summary/issues를 다시 조회한다.
- select 변경 시 `trace.selectedProjectId`가 새 프로젝트 ID로 저장된다.
- 전환 후 설치 안내 스니펫이 새 프로젝트 ID를 포함한다.
- 전환 후 프로젝트 설정 조회가 새 프로젝트 ID로 호출된다.
- 전환 중 `401`, `403`, 기타 오류가 기존 화면 규칙으로 매핑된다.

`apps/admin/src/pages/DashboardPage.test.tsx`에는 select 렌더링과 `onSelectProject` 호출을 좁게 검증한다.

## 구현 메모

초기 로딩과 프로젝트 전환 로직이 같은 일을 하므로, `App.tsx` 안에 작은 helper를 두는 것을 검토한다.

```ts
async function loadDashboard(projectId: string) {
  const data = await getDashboardData(projectId);
  return data;
}
```

다만 이번 변경에서 helper가 오히려 상태 전달을 복잡하게 만들면 인라인으로 유지한다. 우선순위는 `AppState` 전이가 명확하게 보이는 것이다.

## 검증 기준

- `npm test`가 통과한다.
- 여러 프로젝트 응답을 모킹했을 때 대시보드에서 프로젝트를 바꿀 수 있다.
- 선택한 프로젝트가 localStorage에 저장된다.
- 프로젝트 전환 뒤 설정과 설치 안내가 같은 프로젝트 ID를 쓴다.
- 프로젝트가 1개뿐이어도 헤더에 select가 보인다.
