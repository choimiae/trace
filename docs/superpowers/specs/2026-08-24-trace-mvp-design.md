# Trace MVP 설계

작성일: 2026-08-24

## 배경

Trace는 SaaS 제품 운영자와 PM을 위한 사용자 행동 분석 제품이다. 일반적인 GA식 방문자 통계보다, 제품 안에서 사용자가 어디서 막히고 헷갈리고 포기하는지를 자동으로 찾아주는 데 초점을 둔다.

첫 적용 방식은 고객 웹사이트나 SaaS 제품에 JavaScript 추적 스크립트 한 줄을 삽입하는 형태로 한다.

## 제품 방향

최종 목표는 세션 리플레이까지 포함한 행동 분석 제품이지만, 첫 버전부터 전체 리플레이를 구현하지 않는다. MVP는 실제 수집 가능한 얇은 제품으로 시작하고, 데이터 모델과 SDK 경계는 리플레이 확장을 고려해 설계한다.

핵심 포지션은 다음과 같다.

> GA보다 쉬운 운영자용 행동 분석 도구. 숫자 대시보드보다 사용자가 막힌 지점을 먼저 알려준다.

## MVP 범위

MVP 완료 기준에 포함한다.

- 고객 웹사이트에 삽입하는 JavaScript SDK
- 자동 행동 수집
- 중요 기능을 보강하는 명시 이벤트 `track()`
- 기본 마스킹과 민감정보 미수집
- dead click, rage click, 오래 정지, 오류/성능 문제 감지
- 문제 인박스 중심의 운영자 대시보드
- 문제 상세와 세션 타임라인
- 기능 맵과 기능 이름 매핑

구현은 두 단계로 자른다.

- MVP 1차: 실제 수집, 문제 인박스, 문제 상세, 세션 타임라인
- MVP 1.5차: 기능 맵, 기능 이름 매핑, 개인정보 설정 UI

MVP에서 제외한다.

- 전체 세션 리플레이
- 히트맵 고도화
- AI 요약
- Slack 알림
- 팀 권한/조직 관리 고도화
- 결제/요금제
- 대량 이벤트 파이프라인
- 고급 필터와 세그먼트

## 대시보드 정보 구조

홈은 문제 인박스로 시작한다. 운영자가 대시보드에 들어오면 이번 주 가장 심각한 막힘 이슈를 먼저 본다.

문제 인박스 상단에는 운영자가 한눈에 상태를 파악할 수 있는 통계 요약과 차트를 둔다.

- 전체 막힘 점수
- 영향받은 사용자/세션 수
- 신규 issue 수
- 해결/무시 처리된 issue 수
- 기간별 막힘 추세 라인 차트
- issue 유형별 분포 차트
- 가장 많이 막힌 화면/기능 Top N

차트는 해석 부담을 줄이는 방향으로 사용한다. 운영자가 직접 복잡한 분석을 하지 않아도, 차트 옆에 "이번 주 설정 화면의 dead click이 전주 대비 38% 증가했습니다" 같은 사람이 읽을 수 있는 요약 문장을 함께 보여준다.

기능 맵은 별도 탭으로 둔다. 기능별 사용량, 막힘 점수, 완료/중단 패턴을 확인한다.

기능 맵은 표와 차트를 함께 사용한다.

- 기능별 사용량 막대 차트
- 기능별 막힘 점수 비교
- 사용량 대비 막힘 사분면 차트
- 기능별 dead click/rage click/error 비율
- 기능별 대표 issue 목록

특히 사용량은 높지만 막힘도 높은 기능을 우선 개선 대상으로 드러낸다.

세션 근거는 문제 상세 안에 둔다. 문제를 클릭하면 대표 세션 타임라인과, 추후에는 리플레이를 확인한다.

## 핵심 사용자 흐름

1. 운영자가 프로젝트를 만든다.
2. 설치 스크립트를 확인한다.

```html
<script src="https://cdn.trace.app/sdk.js" data-project-id="..."></script>
```

3. 개발자가 주요 기능에 명시 이벤트를 추가할 수 있다.

```js
trace.track("report_export_clicked")
trace.track("member_invite_started")
```

4. 홈의 문제 인박스에서 심각도순 issue를 확인한다.
5. issue를 클릭해 발생 화면, 기능, 영향 사용자 수, 대표 세션, 이벤트 타임라인, 관련 오류/성능 지표를 확인한다.
6. 홈과 기능 맵의 차트로 기간별 추세, issue 유형 분포, 기능별 막힘 정도를 확인한다.
7. 기능 맵에서 자동 수집 요소나 명시 이벤트를 제품 기능으로 매핑한다.

## 데이터 모델

### Project

고객사가 만든 분석 프로젝트다.

- `project_id`
- `name`
- `allowed_domains`
- `created_at`
- `privacy_config`

### Session

한 사용자의 방문 단위다. MVP 기본값은 익명 사용자 기준이다.

- `session_id`
- `project_id`
- `anonymous_user_id`
- `started_at`
- `ended_at`
- `device`
- `browser`
- `os`
- `viewport`
- `country_or_region`
- `referrer`

### Event

모든 행동은 세션 안의 이벤트로 저장한다.

- `event_id`
- `project_id`
- `session_id`
- `page_id`
- `timestamp`
- `type`
- `url_path`
- `url_query_redacted`
- `title_masked`
- `element_selector_hash`
- `element_role`
- `element_text_masked_or_limited`
- `x`
- `y`
- `viewport_x`
- `viewport_y`
- `metadata`

MVP 이벤트 타입은 다음을 우선 지원한다.

- `page_view`
- `page_leave`
- `click`
- `scroll`
- `idle`
- `dead_click`
- `rage_click`
- `js_error`
- `api_error`
- `web_vital`
- `custom_event`

폼/입력 분석은 확장 모듈로 열어둔다.

- `form_start`
- `field_focus`
- `field_blur`
- `form_submit`
- `form_abandon`

입력값 원문은 저장하지 않는다.

### Issue

막힘 감지 엔진이 이벤트를 묶어서 만든 문제 후보다.

- `issue_id`
- `project_id`
- `issue_type`
- `title`
- `summary`
- `affected_sessions_count`
- `affected_users_count`
- `severity_score`
- `first_seen_at`
- `last_seen_at`
- `trend`
- `related_url_path`
- `related_feature_id`
- `example_session_ids`
- `status`

Issue 상태는 다음을 지원한다.

- `new`
- `reviewing`
- `ignored`
- `resolved`

### Feature

운영자가 이름 붙인 제품 기능이다.

- `feature_id`
- `project_id`
- `name`
- `description`
- `match_rules`
- `created_by`
- `created_at`

`match_rules`는 자동 수집 요소나 명시 이벤트를 기능으로 묶는다.

```text
name: 멤버 초대
match_rules:
- url_path: /settings
  selector_hash: abc123
- custom_event: member_invite_started
```

## 막힘 감지 로직

MVP는 규칙 기반 감지와 점수화로 시작한다. 운영자에게 왜 문제로 판단했는지 설명 가능해야 하기 때문이다.

기본 흐름은 다음과 같다.

```text
이벤트 수집
→ 세션 단위 정렬
→ 짧은 시간 창에서 패턴 감지
→ 같은 화면/요소/기능별로 묶기
→ Issue 생성
→ severity score 계산
```

### Dead Click

사용자가 클릭했지만 의미 있는 반응이 없는 경우다.

초기 기준:

- 클릭 후 2초 안에 URL 변경이 없음
- 클릭 후 2초 안에 의미 있는 DOM 변화가 없음
- 클릭 후 2초 안에 관련 `custom_event`가 없음
- 클릭 후 2초 안에 API 성공, 모달, 패널, 토스트 등 반응이 없음

### Rage Click

짧은 시간 안에 같은 위치나 같은 요소를 반복 클릭하는 경우다.

초기 기준:

- 3초 안에 같은 selector에서 3회 이상 클릭
- 또는 3초 안에 30px 반경 안에서 3회 이상 클릭

### Long Pause

사용자가 중요한 행동 후 오래 멈춘 경우다.

초기 기준:

- 클릭, 폼 포커스, `custom_event` 후 15초 이상 입력/클릭/스크롤 없음

일반 페이지 정지는 낮은 점수로 처리한다. 버튼 클릭 직후, 오류 직후, 반복 클릭 후 정지는 높은 점수로 처리한다.

### Scroll Friction

사용자가 화면에서 원하는 것을 찾지 못하는 듯한 행동이다.

초기 기준:

- 짧은 시간 안에 위/아래 방향 전환 4회 이상
- 스크롤 80% 이상 후 다시 상단 복귀
- 주요 기능 주변에서 스크롤 정지 반복

MVP에서는 보조 신호로 사용한다.

### Error Friction

JS 에러, API 실패, 성능 저하가 사용자 행동과 연결되는 경우다.

초기 기준:

- 클릭 후 5초 안에 JS error 발생
- 클릭 후 API 4xx/5xx 발생
- API 응답 3초 이상 지연 후 이탈
- INP/LCP 악화 세션에서 dead click 증가

### Form/Input Friction

확장 모듈로 둔다. 입력값은 저장하지 않고 행동만 본다.

초기 후보:

- 폼 시작 후 submit 없이 이탈
- 같은 필드 focus/blur 반복
- submit 후 오류 표시 추정
- 필드 간 왕복
- 입력 후 long pause

### Severity Score

문제 인박스 정렬을 위해 심각도 점수를 계산한다.

초기 구성 요소:

- 영향 세션 수
- 최근 증가율
- rage/dead click 강도
- 오류/성능 동반 여부
- 관련 기능 중요도
- issue 상태

운영자에게는 숫자만 보여주지 않고 근거 문장을 함께 보여준다.

```text
막힘 점수 82
42개 세션에서 같은 버튼을 반복 클릭했고,
클릭 후 화면 변화가 없었으며,
이 중 11개 세션은 20초 이상 정지 후 이탈했습니다.
```

Issue는 `project_id`, `url_path`, `selector_hash` 또는 `feature_id`, `issue_type`, 시간 범위 기준으로 묶는다.

URL의 동적 값은 정규화한다.

```text
/reports/123 → /reports/:id
/users/987/settings → /users/:id/settings
```

## 개인정보와 보안

기본 원칙은 Private by default다.

MVP에서 저장하지 않는다.

- 입력값 원문
- 비밀번호, 결제, 카드, 주소, 전화번호, 이메일 필드 값
- 전체 DOM 원문
- 전체 화면 텍스트
- 이미지와 영상 원본
- 네트워크 request/response body
- 민감 URL query value

폼 관련 행동은 저장할 수 있지만 값은 저장하지 않는다.

저장 가능:

- 필드 focus
- 필드 blur
- 입력 시작 여부
- 수정 횟수
- 제출 시도
- 제출 성공/실패 추정
- 입력 후 이탈

화면 텍스트는 제한적으로만 저장한다.

- button text
- link text
- aria-label
- role
- tag name
- selector hash

이메일, 전화번호, 긴 숫자 패턴은 redaction한다.

URL path는 저장하되 query parameter 값은 기본 redaction한다.

```text
/users/123/settings?email=choi@example.com&tab=invite
```

저장 예:

```text
url_path: /users/:id/settings
url_query_keys: ["email", "tab"]
url_query_redacted: ?email=[redacted]&tab=[redacted]
```

SDK는 고객사의 consent manager와 연동 가능해야 한다.

```js
trace.init({
  projectId: "...",
  consent: "granted"
})

trace.consent.grant()
trace.consent.deny()
```

동의 전 정책은 두 모드를 지원할 수 있다.

- `strict`: 동의 전 아무것도 수집하지 않음
- `anonymous`: 쿠키 없이 익명 page/session 단위 최소 이벤트만 수집

MVP 문서에서는 `strict`를 권장한다.

MVP 기본 식별자는 익명이다.

- `anonymous_user_id`
- `session_id`

추후 고객사가 내부 사용자 ID를 연결하려면 `identify()`를 제공한다. 이메일 같은 직접 식별자는 넣지 않도록 문서화하고, SDK에서 이메일 패턴은 거부하거나 hash 처리한다.

수집 API의 기본 보안 처리:

- `project_id` 검증
- `allowed_domains` 검증
- event batch 크기 제한
- rate limiting
- malformed event drop
- server-side redaction 2차 적용
- 관리자 인증/권한
- audit log

초기 데이터 보관 정책:

- 원시 이벤트: 30일
- issue 집계: 180일
- 세션 타임라인: 30일
- 삭제 요청: project/user/session 단위 지원

리플레이가 들어오면 replay chunk 보관 기간은 7~30일로 별도 관리한다.

## 기술 아키텍처

추천 스택:

- Frontend/Admin: React + Vite + TypeScript
- Backend/API: Node.js + Fastify + TypeScript
- Database: PostgreSQL
- Event ingestion: HTTP batch endpoint
- SDK: browser JavaScript/TypeScript package

초기에는 Kafka 같은 스트리밍 인프라를 넣지 않는다. 이벤트 양이 커지면 queue/stream으로 분리한다.

### SDK

MVP 기능:

- `init(projectId)`
- 자동 `page_view` 수집
- click 수집
- scroll depth와 scroll activity 수집
- idle/long pause 감지
- JS error 수집
- web vitals 일부 수집
- custom `track()` 지원
- consent API
- client-side redaction
- batch 전송

### 수집 API

SDK가 batch로 이벤트를 보내는 endpoint다.

```text
POST /v1/events/batch
```

처리:

- `project_id` 검증
- domain 검증
- schema validation
- server-side redaction
- rate limit
- event 저장

MVP에서는 받은 이벤트를 바로 DB에 저장한다.

### 저장소

초기 테이블:

- `projects`
- `sessions`
- `events`
- `features`
- `issues`
- `issue_events`
- `issue_sessions`

이벤트 원문은 `events.metadata` JSON에 일부 유연하게 저장하되, 공통 필드는 컬럼으로 둔다.

### 막힘 감지 엔진

MVP에서는 비동기 worker를 별도 서비스로 분리하지 않는다.

1차 구현:

- batch 수신 후 간단한 event-level 감지
- 주기적 job으로 session/issue 재계산
- 최근 이벤트를 분석해 issue upsert

이벤트가 많아지면 다음 구조로 분리한다.

```text
ingestion API
→ queue
→ detection worker
→ issue aggregator
```

### 운영자 대시보드

MVP 1차 화면:

- 프로젝트 생성/설치 안내
- 문제 인박스
- 홈 요약 통계와 기본 차트
- 문제 상세
- 세션 타임라인

MVP 1.5차 화면:

- 기능 맵
- 기능별 통계/차트
- 기능 이름 매핑
- 개인정보 설정 UI

개인정보 기본 정책은 UI가 없어도 SDK/API에 먼저 반영한다.

### API

관리자용 API:

- `POST /api/projects`
- `GET /api/projects/:id`
- `GET /api/projects/:id/issues`
- `GET /api/issues/:id`
- `GET /api/sessions/:id/timeline`
- `GET /api/projects/:id/features`
- `POST /api/projects/:id/features`

수집용 API:

- `POST /v1/events/batch`

## 리플레이 확장 포인트

MVP에서는 리플레이를 만들지 않지만 다음을 열어둔다.

- 이벤트에 `session_id`, `page_id`, `timestamp`, `selector_hash`, `viewport` 저장
- issue와 `example_session_ids` 연결
- `ReplayChunk` 테이블 추가 가능성 유지
- SDK 내부에 recorder 모듈 경계 마련
- 마스킹 정책을 SDK와 서버 양쪽에 공통 적용

추후 추가될 수 있는 replay chunk 구조:

- `replay_chunk_id`
- `session_id`
- `started_at`
- `ended_at`
- `dom_snapshot_or_mutations_masked`
- `mouse_moves_sampled`
- `viewport_changes`

## 장기 확장 방향

MVP는 실제 수집과 문제 인박스 검증에 집중한다. 이후에는 Trace를 단순 통계 도구가 아니라 제품 운영자가 사용자 막힘을 발견하고, 근거를 확인하고, 팀과 함께 개선하는 운영 플랫폼으로 확장한다.

우선 확장 후보는 다음과 같다.

- 세션 리플레이: 문제 상세의 세션 타임라인에 마스킹된 리플레이 플레이어를 연결한다.
- 히트맵과 영역 분석: 클릭, 스크롤, dead click이 특정 화면 영역에 몰리는지 시각화한다.
- AI 기반 issue 요약: 여러 세션 근거를 사람이 읽기 쉬운 원인 후보와 개선 제안으로 요약한다.
- 알림: 막힘 점수 급증, 오류 동반 이탈, 주요 기능 문제를 Slack/Email로 보낸다.
- 팀/조직 권한 관리: 프로젝트별 관리자, 읽기 전용 사용자, 개인정보 설정 권한을 분리한다.
- 요금제와 사용량 제한: 이벤트 수, 보관 기간, 리플레이 샘플링, 프로젝트 수를 요금제와 연결한다.
- 대량 이벤트 파이프라인: ingestion API 뒤에 queue/stream과 detection worker를 분리한다.
- 모바일 SDK: 웹 SDK 이후 iOS/Android 앱의 화면, 탭, 오류, 성능 막힘을 수집한다.
- 리포트 공유: 특정 issue, 기능 맵, 기간별 막힘 리포트를 링크나 PDF로 공유한다.
- 고객사별 데이터 거버넌스: 보관 기간, 삭제 요청, region, audit log, export 정책을 고객사 단위로 관리한다.

이 확장은 MVP 구현을 복잡하게 만들지 않는다. 단, MVP의 이벤트 모델, 개인정보 정책, SDK 모듈 경계, issue 구조는 위 확장과 충돌하지 않도록 유지한다.

## 테스트와 검증 기준

### SDK

- 스크립트 삽입 후 초기화된다.
- `page_view`가 수집된다.
- click이 수집된다.
- scroll depth가 수집된다.
- idle/long pause가 감지된다.
- JS error가 수집된다.
- custom `track()` 이벤트가 수집된다.
- consent denied 상태에서는 수집하지 않는다.
- batch 전송이 실패하면 재시도/드롭 정책이 동작한다.
- 입력값은 payload에 포함되지 않는다.
- URL query value는 redaction된다.

### 수집 API

- 정상 batch를 저장한다.
- 잘못된 `project_id`를 거부한다.
- 허용되지 않은 domain을 거부한다.
- schema가 틀린 이벤트를 거부하거나 drop한다.
- rate limit이 동작한다.
- server-side redaction이 한 번 더 적용된다.
- 중복 `event_id`를 안전하게 처리한다.

### 막힘 감지

- 같은 버튼 3초 내 3회 클릭은 rage click issue가 된다.
- 클릭 후 변화 없음은 dead click issue가 된다.
- 클릭 후 15초 정지는 long pause issue가 된다.
- 클릭 후 JS error는 error friction issue가 된다.
- API 500 후 이탈은 error friction issue가 된다.
- 같은 화면/요소/유형 문제는 하나의 issue로 묶인다.
- `resolved` 또는 `ignored` 처리한 issue는 홈에서 우선순위가 낮아진다.

### 대시보드

- 프로젝트를 생성하고 설치 스크립트를 볼 수 있다.
- 문제 인박스에서 심각도순 issue를 볼 수 있다.
- 홈에서 전체 막힘 점수, 영향 세션 수, 신규 issue 수를 볼 수 있다.
- 기간별 막힘 추세 차트를 볼 수 있다.
- issue 유형별 분포 차트를 볼 수 있다.
- 가장 많이 막힌 화면/기능 Top N을 볼 수 있다.
- issue를 클릭하면 왜 문제인지 근거를 볼 수 있다.
- 대표 세션 타임라인을 볼 수 있다.
- 기능 맵에서 기능별 사용량/막힘을 볼 수 있다.
- 기능별 사용량 대비 막힘 비교 차트를 볼 수 있다.
- 자동 수집 요소 또는 `custom_event`를 기능에 매핑할 수 있다.

### 개인정보

샘플 페이지에 다음을 넣고 payload를 검사한다.

- email input
- password input
- phone number text
- URL query with email/name
- safe button text
- button text containing email
- custom event metadata containing email

기대 결과:

- 입력값 없음
- password 필드 제외
- 이메일/전화번호 redacted
- query value redacted
- 안전한 버튼 텍스트만 제한 저장
- custom event metadata도 redacted

### 성능

초기 목표:

- SDK gzip 크기는 가능하면 30KB 이하
- 이벤트 전송은 batch 방식
- 메인 스레드 장기 점유 없음
- click handler는 가볍게 처리
- scroll 이벤트는 throttle/debounce
- 네트워크 실패가 사용자 경험에 영향을 주지 않음

## 초기 성공 기준

파일럿 기준:

- 스크립트 설치 후 10분 안에 이벤트가 들어온다.
- 하루 안에 문제 인박스에 최소 1개 이상의 유의미한 issue가 생긴다.
- 운영자가 issue 상세를 보고 왜 문제인지 이해할 수 있다.
- 운영자가 홈 통계와 차트만 보고 이번 주 가장 큰 사용자 막힘 영역을 파악할 수 있다.
- 개발자 없이도 자동 수집만으로 기본 막힘을 볼 수 있다.
- 중요한 기능은 `track()` 또는 기능 매핑으로 이름 붙일 수 있다.
- 민감정보가 payload에 들어가지 않는다.
