# ③-1 서버 집계 API

작성일: 2026-10-10

[제품 재정의 설계](2026-09-30-behavior-analytics-redefinition-design.md)의 ③ 세 화면을 세 묶음으로 나눈 첫 번째다. 이 문서는 재정의 설계의 "집계 기준"을 서버 API로 옮기는 범위와, 그 설계가 정하지 않은 부분을 정한다. 집계 기준 자체(기능 하나의 정의, 경로 순위 규칙, 화면 이름 규칙)는 재정의 설계를 따르며 여기서 다시 정의하지 않는다.

## ③을 나눈 방식

| 묶음 | 범위 | 끝났을 때 |
|---|---|---|
| **③-1 서버 집계** (이 문서) | 기능 사용·경로 순위 API, 세션 목록의 기간과 필터, 인덱스 | API와 테스트만 바뀌고 화면은 그대로 |
| ③-2 화면 | 라우팅, 왼쪽 메뉴, 기간 공유, `App.tsx` 쪼개기, 세 화면, `DashboardPage`·`PageStatsPage`·`page-stats` API 정리 | 목업대로 화면 이동이 동작 |
| ③-3 세션 창과 마무리 | 타임라인 항목을 누르면 재생 위치 이동, 화면 전환 눈금, README | 재정의 설계의 ③ 완료 |

묶음마다 계획 → 구현 → 로컬 main 머지를 따로 한다. ③-1을 먼저 하는 이유는 경로 순위처럼 규칙이 까다로운 부분을 화면 없이 테스트로 굳히기 위해서다.

## 재정의 설계에 더하거나 좁힌 결정

| # | 질문 | 결정 |
|---|---|---|
| 1 | 화면 행의 [세션 보기]는 무엇으로 거르나 | **화면 필터**를 더한다. "그 화면을 한 번이라도 연 세션". 재정의 설계의 세션 필터 목록(없음·기능·경로)에 빠져 있었다 |
| 2 | 화면별 스크롤 도달 비율(`scrollReach`, 25·50·75·100%)을 새 API에 넣나 | **넣지 않는다.** 새 기능 사용 표에 그 열이 없다. 스크롤 이벤트 수집·저장과 타임라인의 "스크롤 도달" 항목은 그대로다 |
| 3 | 기간에 세션을 어떻게 넣나 | **기간 안에 시작한 세션만 넣고, 넣은 세션은 이벤트 전부를 센다.** 세 화면의 세션 수가 같은 집합에서 나오고, 경로 자르기와 이탈을 잘리지 않은 세션으로 계산하기 위해서다. 경계 직전에 시작한 세션이 빠지지만, 탭 세션은 30분 무활동이면 끝나 영향은 가장자리 몇 분이다 |
| 4 | 경로 계산을 어디서 하나 | SQL은 기간 세션의 `page_view`에서 `(session_id, url_path, timestamp)`만 꺼내고, 합치기·자르기·이탈 붙이기는 **TypeScript 순수 함수 하나**가 한다. 순위, 경로 필터, 세션 행의 지나간 화면이 이 함수를 같이 써서 숫자가 서로 맞는다 |
| 5 | 세션 목록을 몇 개 주나 | 최근 순 50개와 조건에 맞는 전체 수(`total`). 페이지 넘기기는 넣지 않는다 |

시각은 모두 이벤트의 `timestamp`(브라우저 시계)로 판단한다. 지금 세션 목록의 정렬 기준과 같고, `(project_id, timestamp)` 인덱스가 이미 있다.

## API

세 API 모두 관리자 인증과 프로젝트 확인을 지금 관리자 API(`routes/admin-proxy.ts`)와 같은 방식으로 한다. 응답에는 `cache-control: no-store`를 붙인다.

**기간:** `?days=1|7|30`. 없으면 7이다. 그 밖의 값이면 400 `{ "error": "invalid_period" }`. 라우트가 서버 시계에서 `days`일을 빼 기준 시각 `since`(ISO 문자열)를 만들고 저장소에 넘긴다.

**화면 이름:** 세 응답 모두 재정의 설계의 규칙을 쓴다. 경로마다 기간 세션 안에서 가장 많이 나온 `titleMasked`이고, 횟수가 같으면 가나다순(문자열 비교)으로 앞선 제목, 제목이 하나도 없으면 경로 그대로다.

### 기능 사용 — `GET /admin/api/projects/:projectId/features`

```json
{
  "summary": { "visitors": 290, "sessions": 412, "averageSessionMs": 361000 },
  "screens": [
    {
      "urlPath": "/quote",
      "name": "견적 목록",
      "views": 1850,
      "visitors": 290,
      "averageDwellMs": 100000,
      "exitRate": 0.12,
      "features": [
        { "elementKey": "a1b2…", "name": "신규 등록", "role": "button", "clicks": 410, "visitors": 180 }
      ]
    }
  ]
}
```

- `summary.visitors`: 기간 세션의 서로 다른 `anonymousUserId` 수. `sessions`: 기간 세션 수. `averageSessionMs`: 세션마다 마지막 이벤트와 첫 이벤트의 시간 차의 평균. 세션이 없으면 0이다.
- 화면: `views`는 `page_view` 수, `visitors`는 그 화면을 연 서로 다른 방문자 수. `averageDwellMs`와 `exitRate`는 지금 `store/page-stats.ts`의 정의 그대로다. 체류를 잴 짝이 하나도 없으면 `averageDwellMs`는 빠진다(0과 구분).
- 기능: `click`을 `(url_path, element_key)`로 묶는다. `name`은 `element_text_masked_or_limited`, 없으면 `element_role`. `role`은 `element_role`. `element_key`가 없는(선택자 해시가 없는) 클릭은 세지 않는다.
- 정렬과 상한: 화면은 방문 수 순으로 최대 100개, 화면 안의 기능은 클릭 수 순으로 최대 30개. 클릭은 있는데 `page_view`가 없는 경로는 `views: 0`인 화면 행으로 넣는다.

### 이동 흐름 — `GET /admin/api/projects/:projectId/paths`

```json
{
  "totalSessions": 412,
  "paths": [
    { "steps": ["/quote", "/quote/new"], "exited": true, "sessions": 120, "ratio": 0.29 }
  ],
  "names": { "/quote": "견적 목록", "/quote/new": "견적 등록" }
}
```

- `?start=<urlPath>`: 시작 화면. 없으면 "전체"다.
- `totalSessions`: 시작 화면으로 자른 뒤 남은 대상 세션 수. `ratio`의 분모다.
- `exited`: 경로가 5개 화면 안에서 끝났는지. "이탈"을 `steps`에 문자열로 넣지 않는다.
- `paths`: 같은 `(steps, exited)`끼리 묶어 세션 수가 많은 순 상위 20개. 세션 수가 같으면 `steps`를 이은 문자열 순으로 정해 결과를 고정한다.
- `names`: 기간 세션의 모든 경로의 화면 이름. 시작 화면 선택지로도 쓴다.

### 세션 — `GET /admin/api/projects/:projectId/sessions` (기존 확장)

필터는 하나만 건다.

| 필터 | 쿼리 | 조건 |
|---|---|---|
| 없음 | — | 기간 세션 전부 |
| 화면 | `screen=/quote` | 그 경로의 `page_view`가 있는 세션 |
| 기능 | `featurePath=/quote&featureKey=a1b2…` | 그 `(url_path, element_key)`의 `click`이 있는 세션 |
| 경로 | `step=/quote&step=/quote/new&exited=true`, 선택으로 `start=/quote` | 경로 순위와 같은 함수로 잘랐을 때 `steps`와 `exited`가 모두 같은 세션. `exited`를 빼면 `false`다 |

필터를 둘 이상 섞거나, `featurePath`·`featureKey` 중 하나만 오거나, `start`·`exited`가 `step` 없이 오면 400 `{ "error": "invalid_session_filter" }`.

```json
{
  "total": 180,
  "sessions": [
    {
      "sessionId": "…",
      "anonymousUserId": "anon_7f3a…",
      "startedAt": "…",
      "lastSeenAt": "…",
      "durationMs": 362000,
      "screenCount": 4,
      "screens": ["/", "/quote", "/quote/new"],
      "eventCount": 37,
      "hasRecording": true
    }
  ],
  "names": { "/": "홈", "/quote": "견적 목록" }
}
```

- `sessions`: 시작 시각 최근 순 50개(시작 시각이 같으면 `sessionId` 순). `total`: 조건에 맞는 전체 세션 수.
- `screenCount`: 연달아 나온 같은 화면을 합친 화면 수. `screens`: 그 앞 5개. 화면은 `screenCount`가 5 이하면 끝에 "이탈"을, 넘으면 "…"을 붙인다(③-2).
- `names`: 응답에 든 `screens`의 화면 이름.
- 기존 필드(`sessionId`, `startedAt`, `lastSeenAt`, `eventCount`, `hasRecording`)는 그대로 둬서 ③-2 전까지 `DashboardPage`가 깨지지 않는다. 바뀌는 동작은 "최근 7일에 시작한 세션만 나온다" 하나다.

### `page-stats`

③-1에서는 건드리지 않는다. ③-2에서 `PageStatsPage`와 함께 지운다.

## 계산

### 기간 세션

세 API가 같은 방법으로 정한다.

1. `(project_id, timestamp)` 인덱스로 `timestamp >= since`인 이벤트가 있는 세션을 찾는다.
2. 그중 `timestamp < since`인 이벤트가 있는 세션을 `NOT EXISTS`로 뺀다(`(project_id, session_id, timestamp)` 인덱스).

프로젝트 이벤트 전부를 `GROUP BY` 하지 않는다. SQL에서는 공통 테이블 식(CTE) 하나로 두고 세 쿼리가 같이 쓴다.

### 기능 사용

전부 SQL로 계산한다.

- 화면 행: 기간 세션의 `page_view`에 `LEAD()`로 같은 세션의 다음 `page_view` 시각을 붙인다. 다음이 없으면 이탈이다. 체류는 이번 `page_view`부터 다음 `page_view`까지(양 끝 포함, `<=`) 사이에서 같은 경로의 가장 이른 `page_leave`까지의 시간이다. 경계를 포함하는 이유는 `page-stats.ts`의 주석에 있다(라우팅 이동 때 `page_leave`와 다음 `page_view`가 같은 밀리초를 찍는다).
- 기능 행: `click`을 `(url_path, element_key)`로 묶어 센다.
- ③-2에서 `page-stats.ts`를 지우기 전까지, 같은 픽스처로 `computePageStats`와 새 SQL의 방문·체류·이탈이 같은지 비교하는 테스트를 둔다.

### 경로

`store/route.ts`의 순수 함수가 한 세션의 `page_view` 경로 배열(시간순)과 시작 화면을 받아 결과를 낸다.

```
세션 기록:      /   →  /quote  →  /quote(새로고침)  →  /quote/new  → (끝)
연달아 합치기:   /   →  /quote  →  /quote/new                       screenCount 3
시작 "전체":     /   ›  /quote  ›  /quote/new  ›  이탈              (exited: true)
시작 /quote:     /quote ›  /quote/new  ›  이탈
시작 /pay:       (대상에서 빠짐)
```

1. 연달아 같은 경로를 하나로 합친다. 떨어져서 다시 나온 경로는 합치지 않는다(`/a /b /a`는 그대로).
2. 시작 화면이 있으면 합친 배열에서 그 화면이 처음 나온 지점부터 자른다. 없으면 대상에서 뺀다.
3. 앞의 5개를 `steps`로 쓴다. 자른 배열이 5개 이하면 `exited: true`.
4. `screenCount`는 1의 길이(자르기 전)다.

SQL은 기간 세션의 `page_view`에서 세 열만 `session_id, timestamp` 순으로 꺼낸다. 시각이 같으면 저장된 순서(`rowid`)로 정한다. 클릭과 스크롤 이벤트는 읽지 않는다.

### 세션 목록

- 화면·기능 필터는 SQL의 `EXISTS` 조건이다.
- 경로 필터는 위 함수로 맞는 세션 ID를 고른 뒤 `json_each(?)`로 SQL에 넘긴다.
- 요약 50개를 가져온 다음, 그 50개의 `page_view`만 한 번 더 읽어 `screens`·`screenCount`를 채운다.

### 저장소 인터페이스

- 새로 만듦: `getFeatureUsage(projectId, since)`, `getPathRanking(projectId, since, start?)`
- 바꿈: `listSessions(projectId, query)`. `query`는 `since`와 필터 하나. 지금 부르는 곳은 라우트 한 곳이다.
- 화면 이름은 함수 하나로 두고 세 메서드가 같이 쓴다.
- 응답 타입은 `store/types.ts`에 두고, 관리자 앱의 `api.ts`에는 ③-2에서 필요한 만큼 옮긴다(지금처럼 공유 패키지에 두지 않는다).

## 인덱스

지금 있는 것: `(project_id, timestamp)`, `(project_id, session_id)`, `(project_id, session_id, timestamp)`.

계획 단계에서 데모 규모의 데이터를 넣고 새 쿼리마다 `EXPLAIN QUERY PLAN`을 본다. 테이블 전체를 훑는 쿼리에만 인덱스를 더하고, 그 결과를 계획에 근거로 남긴다.

- 첫 후보: `(project_id, session_id, type, timestamp)`. 세션별 `page_view`·`click`을 찾을 때 쓴다.
- `(project_id, session_id)`는 `(project_id, session_id, timestamp)`의 앞부분과 겹친다. 쓰는 쿼리가 없으면 지운다.

`CREATE INDEX IF NOT EXISTS`만 더하므로 이미 만든 로컬 DB를 그대로 쓴다. 인덱스를 지울 때는 `DROP INDEX IF EXISTS`를 스키마에 함께 둔다.

## 실패 처리

- 잘못된 기간: 400 `invalid_period`. 잘못된 필터 조합: 400 `invalid_session_filter`. 지금 관리자 API처럼 원인별 오류 코드를 쓴다.
- 인증 없음: 401. 없는 프로젝트: 지금 관리자 API의 `getProjectAccess` 응답 그대로.
- 집계 결과가 없으면 빈 배열과 0을 돌려준다. 빈 상태 화면은 ③-2에서 만든다.

## 테스트

vitest와 SQLite 메모리 DB를 쓴다.

- **`route.ts` 단위:** 연달아 합치기, 떨어진 반복은 유지, 시작 화면의 첫 등장에서 자르기, 시작 화면이 없는 세션 제외, 5개 자르기와 `exited`, 자르기 전 길이인 `screenCount`.
- **저장소:** 화면 순서를 정해 둔 샘플 세션으로
  - 기간: 기준 시각 전에 시작한 세션은 통째로 빠지고, 기간 안에 시작한 세션은 이후 이벤트까지 센다
  - 기능 사용: 요약 지표, 화면 행, 기능 행, 이름이 없을 때 역할로 대체, `element_key` 없는 클릭 제외, `page_view` 없는 경로의 화면 행, 다른 프로젝트 데이터 제외
  - `computePageStats`와 방문·체류·이탈 비교
  - 경로 순위: 묶어 세기, 비율, 상위 20개, 같은 수일 때 순서, 시작 화면 필터
  - 세션 필터 네 경우: 결과 집합, `total`, 최근 순 50개, `screens`·`screenCount`, `names`
  - 경로 순위의 `sessions` = 같은 경로로 필터한 세션 목록의 `total`
  - 화면 이름: 가장 많은 제목, 같은 횟수일 때 규칙, 제목이 없을 때 경로
- **라우트:** `days` 기본값과 400, 필터 조합 400, 401, 없는 프로젝트, 기존 `/sessions` 필드 유지.

## 끝났을 때 상태

- `features`, `paths` API와 확장한 `sessions` API가 동작하고, 테스트·build·typecheck가 모두 통과한다.
- 관리자 화면은 지금과 같다. 세션 목록이 최근 7일로 줄어드는 것만 다르다.
- 인덱스는 `EXPLAIN QUERY PLAN` 근거와 함께 계획에 남는다.
- 데모 사이트(`npm run dev:demo`, 포트 3000)에서 몇 화면을 돌아다닌 뒤 세 API를 직접 불러, 응답 JSON의 숫자가 돌아다닌 순서와 맞는지 본다.

## 이번 범위에서 제외

- 화면 작업 전부(③-2), 세션 창 개선과 README(③-3)
- 세션 목록 페이지 넘기기, 화면별 스크롤 도달 비율, 미리 집계하는 테이블
