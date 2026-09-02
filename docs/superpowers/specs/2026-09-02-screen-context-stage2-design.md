# 화면 맥락 2단계 설계 — 주변 구조와 안전한 오류 식별자

## 배경

1단계(`2026-09-02-screen-context-friction-dashboard-design.md`)로 클릭 대상의 rect·role·마스킹 텍스트·viewport 를 수집해 저장하고, 대시보드 첫 화면과 이슈 상세에 미리보기를 붙였다. 구현은 완료됐고 병합됐다.

그런데 실제 화면은 설계 목업(`.superpowers/visualizations/screen-context-layouts.html` 의 G 안, spec 이 "추천 레이아웃"으로 지정한 것)과 다르다. 이유가 두 가지다.

첫째, `layoutHints` 는 계약·스키마·서버 sanitize·렌더링이 모두 구현돼 있으나 **생산자가 없다.** SDK 는 항상 `layoutHints: []` 를 보낸다. 그래서 프로덕션 미리보기는 프레임 하나와 타겟 박스 하나뿐이고, 목업이 보여주는 nav·폼 영역·마스킹된 입력 필드가 없다. 1단계 검수에 쓴 스크린샷은 손으로 넣은 힌트 데이터였다.

둘째, 목업의 근거 패널은 `화면 / 클릭 / 패턴 / 오류 / 영향` 5행 표인데 구현은 한 문장이다. 그중 `오류` 는 데이터 자체가 없다 — SDK 가 `window.onerror` 를 잡지만 `metadata: { errorType: "js_error" }` 만 보내고 오류 종류·파일·라인을 전부 버린다.

이 문서는 그 간극을 메우는 2단계 범위를 확정한다.

## 목표

- 미리보기가 "어느 화면인지"와 "그 화면의 어디를 눌렀는지"를 라벨 없이도 전달한다.
- 오류 기반 막힘에서 개발자가 원인을 찾기 시작할 수 있는 최소 식별자를 제공한다.
- 첫 화면 근거 패널을 목업의 항목별 표로 정렬한다.

## 목표가 아닌 것

- 필름스트립(spec 3단계) 및 세션 리플레이(4단계).
- 오류 **메시지 본문**과 스택 수집. 메시지는 사용자 입력과 레코드 주체를 자주 담고(`Failed to save 김철수: duplicate email choi@example.com`), `redactText` 는 이메일·전화·9자리+ 숫자만 잡아 이름을 못 걸러낸다. 별도 마스킹 정책 설계가 필요하다.
- `api_error` 발행. enum 에 있으나 발행하는 코드가 없다. fetch/XHR 래핑은 별도 작업이며, 이번에는 `api_error` 이벤트가 들어올 경우의 처리 경로만 열어 둔다.
- 페이지 제목(`titleMasked`) 재수집. 업무 화면 제목이 레코드 주체를 담아 수집을 중단한 결정을 유지한다.

## 1. layout hints 생산자

### 선별 규칙

계약이 이미 `max(12)` 를 고정한다. 12 슬롯을 두 목적으로 나눈다.

**랜드마크 최대 4개** — `header`, `nav`, `main`, `aside` 및 대응 `role`(`banner`, `navigation`, `main`, `complementary`). 문서 순서로, 뷰포트와 교차하는 것만. 이것이 "어느 화면인지"를 전달한다.

**타겟 이웃 최대 8개** — 타겟에서 위로 올라가 가장 가까운 컨테이너(랜드마크·`form`·`section`, 최대 3단계)를 찾고, 그 안에서 `button`, `a[href]`, `input`, `select`, `textarea`, `[role=button|link|tab]` 을 채운다.

거리는 **타겟 rect 중심과 후보 rect 중심 사이의 유클리드 거리**로 정하고, 같은 거리면 문서 순서를 쓴다(정렬이 안정적이어야 테스트가 고정된다).

후보 검사 상한은 **60개**다. 그 이상은 보지 않는다. 타겟 자신은 제외한다(별도 렌더). rect 가 동일한 힌트는 중복 제거한다. 뷰포트와 교차하지 않는 요소는 제외한다.

### 힌트별 필드

| 필드 | 규칙 |
|---|---|
| `rect` | 타겟과 동일한 `clampRectValue` 재사용 |
| `tagName` | `SAFE_TAG_NAME_PATTERN` 통과분만 |
| `role` | 기존 `safeRole` 재사용 |
| `masked` | 입력 계열(`input`/`textarea`/`contenteditable`) 또는 `isSensitiveField` 판정 시 `true` |
| `textMaskedOrLimited` | **`masked` 가 아니고** role 이 화이트리스트일 때만 |
| `selectorHash` | 넣지 않는다 (렌더링에 불필요) |

**텍스트 화이트리스트** — `role` 값과 `tagName` 을 함께 본다. 기존 `getElementMetadata` 는 `role` 을 `getAttribute("role") ?? tagName.toLowerCase()` 로 계산하므로, `<a href>` 는 role 이 `link` 가 아니라 `a` 이고 `<h2>` 는 `heading` 이 아니라 `h2` 다. 화이트리스트를 role 이름만으로 쓰면 대부분 걸리지 않는다.

허용 집합: 명시 role `button`, `link`, `tab`, `heading` **또는** tagName `button`, `a`, `h1`, `h2`, `h3`.

컨테이너와 입력 필드는 텍스트 없음. 값은 `redactScreenText`(2회 마스킹 — `redactText` 가 자체 slice 경계에서 멱등이 아니다) 를 통과한다. 길이 상한은 타겟 텍스트와 동일하게 `safeScreenTextSchema` 의 120자를 그대로 상속한다.

이 정책은 타겟 하나에 이미 적용 중인 규칙을 주변 요소로 확장한 것이다. 새로운 노출 **종류**는 없고, 같은 종류가 클릭당 최대 12개 요소로 늘어난다. 버튼·네비 라벨이 레코드 주체를 담을 수 있다는 잔여 위험은 수용한다 — 컨테이너와 입력 필드를 제외하고 role 을 화이트리스트로 묶은 것이 그 위험을 좁히는 장치다.

### 서버 집행

현재 `sanitizeScreenContext` 는 힌트별 필드를 정리하지만 **`masked: true` 인 힌트의 텍스트를 지우지 않는다.** SDK 를 신뢰하는 구조다.

`masked` 가 `true` 면 서버가 `textMaskedOrLimited` 를 삭제한다. 정책을 생산자와 경계 양쪽에서 집행한다.

### throttle 판단

1단계 spec 의 전역 제약은 "layout snapshot 은 throttle/debounce 대상"이라고 한다. **시간 기반 throttle 을 넣지 않는다.**

근거: 클릭은 사용자 속도로 제한되고(rage click 최악이 3초에 7회), 후보 상한 60으로 클릭당 작업량이 이미 묶인다. 시간 throttle 을 넣으면 rage click 의 2번째 이후 클릭에서 힌트가 사라져, 정작 이 기능이 가장 필요한 이슈에서 화면이 빈다.

spec 문장에서 의도적으로 벗어나는 지점이다. 실측 후 클릭당 수집 비용이 문제가 되면 그때 도입한다.

## 2. 안전한 오류 식별자

### 수집

`window.onerror` 의 `ErrorEvent` 에서 세 가지만 수집한다.

| 값 | 출처 | 처리 |
|---|---|---|
| 오류 종류 | `event.error?.name` | 안전 패턴 검증. 없으면(cross-origin `Script error.`) 생략 |
| 스크립트 | `event.filename` | `redactUrl(filename).urlPath` — origin 과 쿼리를 버리고 경로만 저장한다. `filename` 은 `https://app.example.com/assets/checkout.js?v=2` 같은 전체 URL 이고 쿼리에 토큰이 실릴 수 있다 |
| 라인 | `event.lineno` | 양의 정수 |

`event.message` 와 `error.stack` 은 수집하지 않는다.

### 계약

`metadata` 허용목록에 맡기지 않고 `traceEventSchema` 에 타입 필드를 추가한다.

```
errorName?    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
errorSource?  경로 형태, 길이 상한 256
errorLine?    z.number().int().positive()
```

`redactMetadata` 는 `eventName`/`feature`/`target`/`errorType`/`metric`/`source`/`status`/`method`/`durationMs`/`responseMs`/`score` 만 통과시키는 엄격한 허용목록이고, **모르는 키를 조용히 버린다.** 값도 `isSafeAnalyticsIdentifier` 를 통과해야 해서 파일 경로가 탈락할 가능성이 높다. 조용히 버려지는 경로에 새 필드를 얹으면 실패가 눈에 보이지 않는다 — 검증은 눈에 보이는 곳에 둔다.

### 저장과 승격

`events` 테이블에 `error_name`, `error_source`, `error_line` 컬럼을 추가한다. 기존 `hasColumn` 가드 마이그레이션 패턴을 따른다.

`issueSchema` 에 `relatedErrorSignature?` 를 추가하고 `detectErrorFriction` 이 조립한다. **저장은 경로 전체**(`TypeError · /assets/checkout.js:412`)로 하고, 화면에서 파일명만 줄여 보여주는 것은 렌더링 책임이다 — 저장 단계에서 basename 으로 줄이면 같은 이름의 다른 경로를 구분할 수 없다. `relatedUrlPath`/`relatedFeatureId` 와 같은 성격의 파생 필드다. `issues` 테이블에 컬럼 하나를 추가한다.

## 3. 첫 화면 레이아웃

### 근거 5행 표

현재 한 문장(`세션 2개, 사용자 2명 영향`)을 목업의 항목별 표로 바꾼다.

| 행 | 값 |
|---|---|
| 화면 | `issue.relatedUrlPath` |
| 클릭 | `representativeEvent.screenContext.target` 의 `tagName` 과 `textMaskedOrLimited` |
| 패턴 | `issue.issueType` 한글 라벨 |
| 오류 | `issue.relatedErrorSignature` — 없으면 이 행을 숨긴다 |
| 영향 | `affectedSessionsCount` 세션 · 사용자 `affectedUsersCount` 명 · 최근 `lastSeenAt` |

`패턴` 은 이슈당 한 종류다. 목업은 `rage click + dead click` 을 병합해 보여주지만, 이 코드베이스는 (경로, selector, 타입) 단위로 이슈를 만든다. 데이터 모델 차이이므로 목업을 따르지 않는다.

### 이벤트 캡션

미리보기 **아래**에 한 줄을 둔다(`representativeEvent.timestamp` + `issue.summary` 조립). 목업은 화면 안에 `tooltip` 을 올리지만, 1단계 spec 의 전역 제약이 "화면 위에는 복잡한 말풍선을 올리지 않는다. 클릭 위치 표시만 화면 내부에 두고, 설명은 우측 근거 패널 또는 하단 이벤트 흐름에 둔다"이다. spec 문장을 따른다.

### hero 점수 필

헤드라인 옆에 `severityScore` 와 심각도 라벨을 배치한다(목업의 `개선 우선 82`).

### priority-issue 카드 수정

`.priority-issue` 는 `grid-template-columns: 72px minmax(0, 1fr)` 인데 1단계에서 왼쪽 문구(`priority-issue-copy`)를 중복 제거로 걷어내 오른쪽 칼럼이 비었다. 점수·상태·추세·메타가 자연스럽게 채우도록 그리드를 재구성한다.

### 페이지 순서

현재 순서(hero → 한눈에 보기 → 지표 → 인사이트 → 차트)를 유지한다. 목업의 페이지는 `헤드라인 → screen-first → 필름스트립 → 증거` 이고 지표 카드도 인사이트 배너도 없다. 현재 순서가 목업에 더 가깝다.

## 테스트

**힌트 생산자** — 적대적 DOM 에 대한 생산자↔소비자 왕복 검증: `screenContextSchema.safeParse(getScreenContext(el)).success === true` 가 중첩 랜드마크, `contenteditable` 안의 버튼, 뷰포트 밖 요소, 60개 초과 후보, 랜드마크가 없는 문서에서 모두 성립해야 한다. 1단계에서 이 왕복 검증이 없어 프로덕션 400 결함(C1)을 놓쳤다.

**텍스트 정책** — `masked` 힌트에 텍스트가 없음, 화이트리스트 밖 role 에 텍스트가 없음, 컨테이너에 텍스트가 없음.

**서버 집행** — `masked: true` 이면서 텍스트를 실은 힌트를 보내면 서버가 텍스트를 지우고 배치는 202 로 받는다.

**오류 식별자** — cross-origin `Script error.`(`error` 가 `null`)에서 필드를 생략하고 이벤트는 정상 전송된다. 쿼리를 가진 `filename` 이 경로만 남는다. 두 스토어 계약 테스트로 컬럼 왕복을 검증한다.

**렌더링** — 힌트가 실제로 그려지고, 마스킹 블록에 텍스트가 나오지 않으며, 근거 표의 `오류` 행이 값 없을 때 숨겨진다.

## 성공 기준

- 데모 사이트 클릭 하나로 수집한 실제 데이터에서, 미리보기가 nav·폼 영역·입력 필드 위치를 담아 "어느 화면인지" 읽힌다. 손으로 넣은 시드 데이터가 아니어야 한다.
- 오류 기반 막힘 이슈의 근거 표에 오류 종류·파일·라인이 표시된다.
- 저장된 어떤 힌트도 입력 필드·컨테이너의 텍스트를 담지 않는다.
- SDK 번들이 gzip 예산 10KB 안에 남는다.
