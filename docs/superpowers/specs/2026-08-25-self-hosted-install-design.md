# Trace Self-hosted 설치 경험 설계

## 목표

Trace를 낯선 사람이 받아서 자기 사이트에 붙일 수 있는 상태로 만든다. 기능을 추가하지 않고, 이미 구현된 기능이 남의 손에서 동작하게 만드는 것이 이번 범위다.

## 성공 기준

낯선 사람이 저장소를 clone해서 다음을 문서를 헤매지 않고 완료한다.

1. `npm install` 후 서버를 기동한다.
2. Google 로그인으로 관리자 세션을 만든다.
3. 관리자 화면에서 프로젝트를 만든다.
4. 화면에 표시된 스크립트 한 줄을 자기 사이트에 붙인다.
5. 첫 이벤트가 도착한 것을 화면에서 확인한다.
6. 대시보드에서 자기 사이트의 막힘 지점을 본다.

브라우저 개발자 도구 콘솔을 열거나, 환경변수를 편집하거나, 별도 데이터베이스를 설치하는 단계가 없어야 한다.

## 제품 모델: self-hosted

Trace는 사용자가 각자 자기 서버에서 운영하는 self-hosted 제품이다. Plausible, Umami, Matomo와 같은 형태다. 관리자 화면과 수집 서버가 모두 사용자 서버에 있고, 수집한 데이터는 사용자 서버를 벗어나지 않는다.

이 모델이 설계 결정 대부분을 규정한다.

- 사용자가 데이터베이스를 별도로 조달하지 않아야 한다.
- 사용자가 CDN이나 별도 정적 호스팅을 준비하지 않아야 한다.
- 수집 엔드포인트 주소가 사용자 서버 주소에 자동으로 맞아야 한다.

현재 코드가 이미 이 모델을 전제한다. 회원가입이 없고 `ADMIN_ALLOWED_EMAILS` 환경변수 허용목록으로 관리자를 정하며, `ADMIN_APP_ORIGIN`을 서버 운영자가 지정한다.

## 배경: 현재 막혀 있는 지점

### 이미 알고 있던 것

- `MemoryStore`의 `isDurable`이 `false`다. 서버를 재시작하면 수집한 데이터가 전부 사라지고, `assertDeployableTraceStore`가 `NODE_ENV=production` 기동을 거부한다.
- 설치 가능한 SDK 산출물이 없다. `examples/demo-site/index.html`이 `packages/sdk/src/index.ts`를 직접 import하므로 Vite dev server 밖에서는 동작하지 않는다.
- 프로젝트를 만드는 화면이 없다. README가 브라우저 콘솔에 `fetch`를 붙여넣도록 안내한다.

### 설계 중 발견한 결함

- **SDK가 이벤트를 서버로 전송하지 않는다.** `TraceClient.flush()`가 프로덕션 코드에서 호출되지 않는다. `client.test.ts`에서만 호출한다. 주기 타이머, `visibilitychange`, `pagehide` 핸들러가 모두 없다. `collectors.ts`가 큐에 이벤트를 쌓지만 전송하는 주체가 없다.
- **SDK 번들의 84%가 zod다.** `client.ts`가 `eventBatchSchema`를 가져와 전송 직전에 `parse()`한다. 서버가 `ingestion.ts`에서 `rawEventBatchSchema.parse(request.body)`로 이미 검증하므로 클라이언트 검증은 중복이다.

  | 상태 | minified | gzip |
  | --- | --- | --- |
  | 현재 | 70,450 B | 17,867 B |
  | zod 제거 | 6,060 B | 2,645 B |

- **`consent` 기본값이 `"pending"`이다.** `TraceClient.enqueue()`가 `consent !== "granted"`인 이벤트를 버린다. 스크립트만 붙이면 아무것도 수집되지 않는다. 데모 사이트는 `consent: "granted"`를 명시적으로 넘겨서 동작한다.

## 범위

### 포함

1. `better-sqlite3` 기반 durable store와 기본값 승격
2. 설치 가능한 SDK 번들, 자동 전송, API 서버의 번들 서빙
3. 프로젝트 생성과 설치 안내 온보딩 화면
4. README 재작성
5. 요구 Node 버전 명시(`.nvmrc`, `package.json`의 `engines`)

### 제외

- MVP 1.5차 기능 맵, 기능 이름 매핑, 개인정보 설정 UI
- PostgreSQL store
- 프로젝트 전환 드롭다운, 프로젝트 설정 편집, 프로젝트 삭제
- Docker 이미지, CI/CD, 배포 자동화
- 회원가입, 요금제, 멀티테넌시

---

## 1. 저장소: SQLite durable store

### 라이브러리 선택

`better-sqlite3`를 사용한다.

`node:sqlite`는 Node 22.5 이상에 내장되어 의존성이 0개이지만, Node 버전 하한을 강제하고 실행할 때마다 experimental 경고를 출력하며 API가 변경될 수 있다. 설치 장벽을 낮추는 것이 이번 목표이므로 성숙도를 택한다. `better-sqlite3`는 주요 플랫폼 prebuilt 바이너리를 제공하고, 동기 API여서 기존 `async` 메서드 시그니처를 그대로 감쌀 수 있다.

### SqliteStore

`apps/api/src/store/sqlite-store.ts`에 `SqliteStore`를 만들어 `TraceStore` 21개 메서드를 모두 구현하고 `isDurable = true`를 선언한다.

`MemoryStore`는 삭제하지 않고 테스트 전용으로 남긴다.

구현 규칙:

- ID 생성은 `MemoryStore`와 동일하게 `nanoid`를 쓴다. `proj_`, `admin_`, `audit_` 접두사를 유지한다.
- 집계는 SQL이 아니라 JS에서 한다. `getDashboardSummary`는 현재처럼 `listIssues` 결과를 JS로 가공한다. 이 규모에서 SQL 집계로 옮길 이유가 없다.
- `upsertAdminUserFromGoogle`의 이메일 충돌 검사(`admin_email_conflict`)를 동일하게 유지한다. `admin_users.email`에 UNIQUE 제약을 걸고, 충돌을 감지해 같은 오류를 던진다.
- `saveBatch`의 중복 `eventId` 무시 동작을 `INSERT OR IGNORE`로 구현한다.

### 스키마

`apps/api/src/db/schema.sql`을 SQLite 문법으로 옮긴 `apps/api/src/db/schema.sqlite.sql`을 만든다. PostgreSQL 스키마 파일은 나중에 `PostgresStore`를 추가할 때를 위해 남긴다.

타입 대응:

| PostgreSQL | SQLite |
| --- | --- |
| `JSONB` | `TEXT` (JSON 문자열, 읽을 때 `JSON.parse`) |
| `TIMESTAMPTZ` | `TEXT` (ISO 8601. 기존 코드가 이미 ISO 문자열만 다룬다) |
| `DOUBLE PRECISION` | `REAL` |
| `INTEGER` | `INTEGER` |
| `BOOLEAN` | `INTEGER` (0 또는 1) |

`sessions` 테이블은 옮기지 않는다. PostgreSQL 스키마에 정의되어 있으나 `TraceStore` 인터페이스의 어떤 메서드도 사용하지 않는다.

### 마이그레이션

첫 기동 시 `CREATE TABLE IF NOT EXISTS`를 실행한다. 사용자가 별도 명령을 실행할 필요가 없어야 한다.

마이그레이션 버전 관리는 이번에 도입하지 않는다. 아직 배포된 사용자가 없으므로 스키마 변경 이력을 관리할 대상이 없다.

### store 선택

`apps/api/src/server.ts`가 현재 `new MemoryStore()`를 하드코딩한다. 이를 `SqliteStore`로 바꾼다.

- 데이터베이스 파일 경로는 `TRACE_DB_PATH` 환경변수로 지정하고, 없으면 `./trace.db`를 쓴다.
- 즉 기본값이 durable이다. 사용자가 아무 설정을 하지 않아도 데이터가 남는다.
- `.gitignore`에 `trace.db`와 SQLite 부산물(`*.db-wal`, `*.db-shm`)을 추가한다.

### 테스트

현재 `admin-auth-store.test.ts`가 `MemoryStore`만 검증한다. 이를 두 구현체에 동일하게 실행하는 공유 계약 테스트로 바꾼다.

- 테스트 파일이 store 팩토리를 받아 같은 검증을 반복하는 구조로 만든다.
- `SqliteStore`는 `:memory:` 모드로 열어 파일을 만들지 않고 빠르게 실행한다.
- 두 store가 동일하게 동작한다는 것이 테스트로 보장된다.

durable 관련 회귀 테스트를 추가한다.

- `SqliteStore.isDurable === true`
- `assertDeployableTraceStore(new SqliteStore(...), { NODE_ENV: "production" })`이 예외를 던지지 않는다.

---

## 2. 설치 가능한 SDK 번들

### zod 제거

`packages/sdk/src/client.ts`에서 `eventBatchSchema.parse()` 호출을 제거하고 타입만 `import type`으로 가져온다.

`packages/shared/src/index.ts`가 `export * from "./events.js"`이므로 `@trace/shared`에서 값을 하나라도 가져오면 zod가 번들에 포함된다. `packages/shared/package.json`에 `exports` 맵을 추가해 zod를 거치지 않는 서브패스를 노출한다. 현재 이 파일에는 `main`만 있고 `exports`가 없다.

SDK의 import를 다음 두 형태로 정리한다.

- 런타임 값: `import { redactUrl, redactMetadata } from "@trace/shared/privacy"` — `privacy.ts`는 zod를 사용하지 않는다.
- 타입: `import type { EventBatch, TraceEvent } from "@trace/shared"` — 타입 전용 import는 esbuild가 제거하므로 zod가 유입되지 않는다.

`client.ts`와 `collectors.ts` 양쪽을 함께 수정한다. 두 파일 모두 현재 `@trace/shared`에서 런타임 값을 가져온다. 트리 셰이킹에 의존하지 않고 import 경계로 보장하며, 번들 크기 테스트가 회귀를 잡는다.

`redactUrl`과 `redactMetadata`는 런타임에 필요하므로 번들에 유지한다. 개인정보 마스킹은 제품의 핵심 약속이며 서버 검증으로 대체할 수 없다.

### 자동 전송

`installCollectors`가 전송 트리거를 설치한다.

| 트리거 | 조건 |
| --- | --- |
| 주기 타이머 | 5초 간격, 큐가 비어 있으면 건너뜀 |
| 큐 임계치 | 큐 길이가 20 이상 |
| `visibilitychange` | `document.visibilityState === "hidden"` |
| `pagehide` | 항상 |

`client.ts`의 `fetch`에 `keepalive: true`가 이미 있어 페이지를 떠나는 순간의 전송에 적합하다. 실패 시 큐로 되돌리는 로직(`client.ts:88`)도 이미 있다.

네트워크 실패가 고객 사이트 사용자 경험에 영향을 주지 않아야 한다. `flush()`의 모든 예외를 삼키고, 호출부는 실패를 기다리지 않는다.

### 설치 인터페이스

```html
<script src="http://localhost:4000/trace.js" data-project-id="proj_xxx"></script>
```

번들이 `document.currentScript`로 자기 `data-*` 속성을 읽어 자동으로 `init`한다.

| 속성 | 필수 | 기본값 |
| --- | --- | --- |
| `data-project-id` | 필수 | 없음. 없으면 아무것도 하지 않고 콘솔에 경고 1회 |
| `data-endpoint` | 선택 | 스크립트 `src`의 origin + `/v1/events/batch` |
| `data-consent` | 선택 | `granted` |

**엔드포인트를 스크립트 `src` origin에서 유추한다.** 위 예시는 `http://localhost:4000/v1/events/batch`가 된다. 사용자가 서버 주소를 두 번 적을 필요가 없고, 틀릴 여지가 사라진다.

현재 `index.ts:9`의 기본 엔드포인트가 상대경로 `/v1/events/batch`인데, 남의 사이트에 붙으면 그 사이트로 요청이 간다. 이 결함도 같이 해소된다.

번들러를 쓰는 사용자를 위해 `init()` 직접 호출 경로는 그대로 유지한다.

### consent 기본값

기본값을 `"granted"`로 바꾼다. `data-consent="pending"`으로 붙이면 수집을 보류하고, `window.trace.consent.grant()`로 시작할 수 있다.

근거는 현재 수집 범위다. 코드 확인 결과 다음이 성립한다.

- 쿠키, `localStorage`, `sessionStorage`, `indexedDB`를 전혀 사용하지 않는다.
- `anonymousUserId`와 `sessionId`를 페이지 로드마다 새로 생성하고 저장하지 않는다. 새로고침하면 다른 ID가 되므로 동일인 추적이 불가능하다.
- IP 주소를 저장하지 않는다. `events` 테이블에 컬럼이 없다.
- URL 경로의 식별자성 세그먼트를 `:id`로 치환한다. 이메일, 토큰, UUID, 이름이 포함된다.
- URL 쿼리 값을 전부 `[redacted]`로 치환한다.
- 요소 텍스트를 마스킹하고 500자로 제한하며, 선택자는 해시한다.
- 입력값 원문을 수집하지 않는다(`inputCapture: false` 기본).

수집을 기본 차단하면 스크립트를 붙여도 아무 일이 일어나지 않아, 설치 성공과 실패가 구분되지 않는다. `private by default` 원칙은 저장하는 내용에 대한 것이고 위 목록으로 이미 지켜지고 있다.

### 번들 빌드

esbuild(이미 설치되어 있다)로 IIFE 번들을 만든다.

- 산출물: `packages/sdk/dist/trace.js`
- `packages/sdk/package.json`의 `build` 스크립트에 번들 단계를 추가한다.
- **gzip 10KB를 초과하면 실패하는 테스트를 추가한다.** 측정값이 2,645 B이므로 여유가 크고, 무거운 의존성이 유입되면 그 자리에서 잡힌다.

### API 서버의 번들 서빙

API 서버가 `GET /trace.js`로 번들을 내려준다.

self-hosted 모델에서 이미 실행 중인 서버가 번들을 서빙하면 사용자가 CDN이나 정적 호스팅을 준비할 필요가 없다. 그리고 스크립트 `src` origin이 곧 수집 엔드포인트 origin이 되므로, 위에서 정한 엔드포인트 유추가 항상 옳게 동작한다.

CORS는 현재 설정으로 이미 통과한다. `app.ts`의 delegator가 `/auth/`와 `/admin/api/`만 origin을 제한하고 나머지는 `origin: true`다.

`Cache-Control`을 짧게 설정한다(예: `max-age=300`). 사용자가 Trace를 업그레이드했을 때 고객 사이트가 오래된 번들을 오래 붙들고 있지 않아야 한다.

### 데모 사이트 전환

`examples/demo-site/index.html`을 소스 직접 import에서 script 태그 방식으로 바꾼다.

```html
<script src="http://localhost:4000/trace.js" data-project-id="..."></script>
```

이렇게 하면 개발자가 검증하는 경로와 오픈소스 사용자가 겪는 경로가 같아진다. 사내 개발서버에 붙일 때도 같은 형태다.

`projectId`를 query string에서 읽어야 하므로 정적 script 태그로는 속성을 채울 수 없다. 인라인 스크립트가 `document.createElement("script")`로 요소를 만들어 `src`와 `data-project-id`를 설정한 뒤 삽입한다. 동적으로 삽입한 classic script도 실행 중에는 `document.currentScript`가 자기 요소를 가리키므로 속성 파싱 경로가 동일하게 동작한다.

---

## 3. 온보딩 UI

### 상태 흐름

```
loading → login → (프로젝트 없음) → create-project → install → ready
```

현재 `App.tsx`가 프로젝트가 없을 때 `empty-projects` 상태로 "연결된 프로젝트가 없습니다."만 표시하고 끝난다(`App.tsx:85`). 이 자리를 온보딩 진입점으로 바꾼다.

백엔드는 이미 준비되어 있다. `POST /admin/api/projects`가 프로젝트를 만들고 요청자에게 `owner` 멤버십을 자동 부여한다(`admin-proxy.ts`). 프론트에 `createProject` 함수가 없어서 사용하지 못하고 있을 뿐이다.

### 프로젝트 생성

`apps/admin/src/api.ts`에 `createProject`를 추가한다. `POST /admin/api/projects`에 `x-trace-csrf` 헤더와 `credentials: "include"`가 필요하다. CSRF 토큰은 `getAuthMe()`가 반환한다.

폼이 받는 값은 `createProjectSchema`가 정의한 두 개다.

| 필드 | 검증 | UI |
| --- | --- | --- |
| `name` | 최소 1자 | 자유 입력 |
| `allowedDomains` | URL 형식, 최소 1개 | "이 프로젝트의 이벤트를 받을 사이트 주소". placeholder에 `http://localhost:5174` 예시 |

`allowedDomains`는 수집 API의 검증 기준이므로 반드시 받아야 한다. 사용자가 의미를 모를 수 있으니 설명 문구를 붙인다.

### 설치 안내

프로젝트를 만들면 복사 가능한 스크립트 한 줄을 보여준다.

```html
<script src="{API_BASE}/trace.js" data-project-id="{projectId}"></script>
```

`API_BASE`는 `api.ts:3`의 `VITE_API_BASE_URL`을 그대로 쓴다.

### 첫 이벤트 도착 확인

온보딩에서 가장 이탈이 많은 지점은 "붙였는데 되는지 모르겠다"다. 그런데 현재 구조로는 확인할 방법이 없다. `DashboardSummary`가 issue 기반이므로 이벤트가 정상적으로 들어와도 감지 조건을 만족하는 문제가 없으면 모든 수치가 0이다. 설치 성공과 실패가 화면에서 구분되지 않는다.

`packages/shared/src/events.ts`의 `dashboardSummarySchema`에 이벤트 총 개수 필드를 추가한다.

```
totalEventsCount: z.number().int().nonnegative()
```

`getDashboardSummary`가 `listEvents(projectId).length`로 채운다. `MemoryStore`와 `SqliteStore` 양쪽에 반영한다.

설치 화면이 3초 간격으로 summary를 조회해 이 값이 0에서 증가하는 순간 "첫 이벤트가 도착했습니다"를 표시하고 대시보드로 넘어가는 버튼을 띄운다. 화면을 벗어나면 폴링을 중단한다.

### VITE_PROJECT_ID 제거

현재 `App.tsx:9`와 `api.ts:4`가 `VITE_PROJECT_ID` 빌드 타임 환경변수로 프로젝트를 고정한다. 온보딩이 생기면 성립하지 않는다. 프로젝트를 만들 때마다 프론트를 재빌드해야 한다는 뜻이기 때문이다.

- `VITE_PROJECT_ID` 참조를 제거한다.
- 선택한 `projectId`를 `localStorage`에 기억한다.
- `localStorage`에 값이 없으면 `auth.projects[0]`을 쓴다.
- `auth.projects`가 비어 있으면 프로젝트 생성 화면으로 보낸다.

### 재방문 경로

설치 스니펫을 다시 볼 수 있어야 한다. 대시보드 헤더에 "설치 안내" 링크를 추가해 install 화면으로 돌아갈 수 있게 한다.

프로젝트 전환 드롭다운, 프로젝트 설정 편집, 프로젝트 삭제는 이번 범위에서 제외한다.

### 테스트

`App.test.tsx`에 상태별 테스트를 추가한다.

- 프로젝트가 없으면 생성 폼이 보인다.
- 프로젝트를 만들면 설치 스니펫과 `projectId`가 보인다.
- `totalEventsCount`가 0에서 증가하면 대시보드로 넘어가는 버튼이 나타난다.

---

## 개인정보와 법적 고려

수집 범위는 위 "consent 기본값" 절의 목록과 같다. 지속 식별자가 없고, IP를 저장하지 않으며, URL과 텍스트의 식별자성 값을 치환한다.

한국 개인정보 보호법 기준으로 보면 EU ePrivacy Directive와 달리 쿠키 사전 동의 배너 의무 규정이 없고, 개인정보를 수집하는지가 판단 기준이다. 현재 수집 범위는 같은 법 제58조의2의 익명정보에 해당할 가능성이 높다.

다만 다음은 사용자가 설정으로 깨뜨릴 수 있으므로 문서에 명시한다.

- `privacyConfig.inputCapture`를 활성화하면 입력값이 수집된다.
- `track()`의 metadata에 회원번호 같은 내부 식별자를 직접 넣으면 개인정보가 될 수 있다. `redactMetadata`가 이메일 형태는 걸러내지만 임의의 내부 식별자는 걸러내지 못한다.
- 오픈소스이므로 EU, 영국 등 사전 동의를 요구하는 지역의 사용자가 있을 수 있다.

이 문서는 법률 자문이 아니다. 사내 제품에 적용할 때는 회사 개인정보보호 담당자의 확인을 받는다.

---

## 설정

새로 추가되는 환경변수는 하나다.

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `TRACE_DB_PATH` | `./trace.db` | SQLite 데이터베이스 파일 경로 |

제거되는 환경변수는 하나다.

| 변수 | 사유 |
| --- | --- |
| `VITE_PROJECT_ID` | 온보딩 화면이 프로젝트를 선택한다 |

기존 인증 관련 환경변수 14개는 변경하지 않는다.

---

## 테스트 전략

| 대상 | 검증 |
| --- | --- |
| store 계약 | `MemoryStore`와 `SqliteStore`에 동일한 테스트 실행 |
| durable 판정 | `SqliteStore.isDurable === true`, production 기동 가드 통과 |
| SDK 자동 전송 | 타이머, 큐 임계치, `visibilitychange`, `pagehide` 각각에서 전송 발생 |
| SDK 실패 내성 | 전송 실패 시 큐 복원, 예외가 호출부로 전파되지 않음 |
| SDK 설치 인터페이스 | `data-*` 속성 파싱, 엔드포인트 origin 유추, `data-project-id` 누락 시 무동작 |
| 번들 크기 | gzip 10KB 초과 시 실패 |
| 번들 서빙 | `GET /trace.js`가 200과 JavaScript content type을 반환 |
| 온보딩 UI | 프로젝트 없음 → 생성 → 스니펫 → 이벤트 도착 전이 |
| 이벤트 개수 | `totalEventsCount`가 두 store에서 동일하게 채워짐 |

전체 검증 명령은 기존과 같다.

```bash
npm test
npm run typecheck
npm run build
```

`npm test`는 Node 22 이상에서 실행해야 한다. 현재 로컬 기본 Node가 v16이면 Vite가 `crypto.getRandomValues` 오류로 기동하지 못한다. 저장소에 `.nvmrc`와 `package.json`의 `engines` 필드를 추가해 요구 버전을 명시한다.

---

## 문서 갱신

README를 다시 쓴다. 현재 README는 브라우저 콘솔에 `fetch`를 붙여넣어 프로젝트를 만들도록 안내하는데, 이번 작업으로 그 절차 전체가 사라진다.

새 README에 포함할 것.

- `npm install` → 기동 → 로그인 → 프로젝트 생성 → 스크립트 붙이기 순서
- self-hosted 모델임을 명시. 데이터가 사용자 서버를 벗어나지 않는다는 점
- 수집하는 항목과 수집하지 않는 항목 표
- `data-consent="pending"`으로 수집을 보류하는 방법. 설치 안내 바로 옆에 배치한다
- 요구 Node 버전

---

## 오픈소스 공개 준비 제약

저장소는 현재 private이지만 나중에 public으로 전환할 계획이다. 전환하면 커밋 히스토리도 함께 공개되므로, 지금부터 다음을 지킨다.

- 사내 도메인, 서버 주소, 사내 제품명, 내부 URL 패턴을 코드, 설정, 테스트 픽스처, 문서에 커밋하지 않는다.
- 환경별 값은 전부 런타임 환경변수로만 주입한다.
- 배포 관련 설정을 커밋할 때는 예시 파일(`*.example`)만 두고 실제 값은 `.gitignore`에 넣는다.

현재 `apps/api/src/auth/config.ts`가 환경변수 14개를 읽고 하드코딩된 도메인이 없어 이미 이 구조에 가깝다.

---

## 장기 방향: SaaS 전환

self-hosted를 먼저 완성하지만 추후 SaaS 전환을 고려한다. Plausible, Umami가 같은 코드베이스로 self-hosted와 SaaS를 동시에 운영하는 형태를 참고한다.

전환 시 필요한 것을 기록해 둔다. 이번 범위에서는 어느 것도 구현하지 않는다.

- **PostgreSQL store** — 여러 고객 데이터를 한 서버에서 다루려면 SQLite로는 부족하다. `TraceStore` 인터페이스를 유지하는 이유가 이것이다. `apps/api/src/db/schema.sql`도 이 목적으로 남긴다.
- **멀티테넌시 격리** — 고객 간 데이터 격리가 보안 요구사항이 된다. 현재 project와 membership 구조가 그 토대다.
- **회원가입** — 현재 `ADMIN_ALLOWED_EMAILS` 환경변수 허용목록은 서버 운영자가 직접 설정하는 방식이므로 self-hosted 전용이다. 셀프 가입, 조직 생성, 비밀번호 재설정이 필요하다.
- **요금제와 결제**
- **운영 인프라** — 24시간 운영, 모니터링, 백업, 사고 대응
- **수집 파이프라인** — 다수 고객의 이벤트를 받으려면 배치 저장을 큐 기반으로 바꿔야 한다.
- **법적 책임** — 타인의 데이터를 보관하므로 개인정보 처리 위탁 계약, 약관, 처리방침이 필요하다.

전환 시점 판단 기준은 self-hosted 사용자가 실제로 생기고, 그중 "직접 운영하기 귀찮으니 대신 돌려달라"는 요구가 나올 때다.

---

## 미결 사항

- SDK 번들 파일명을 `trace.js`로 고정한다. 버전별 파일명(`trace-0.1.0.js`)은 사용자가 업그레이드할 때 스니펫을 다시 붙여야 하므로 채택하지 않는다. 캐시는 `Cache-Control`로 관리한다.
- 프로젝트 생성 후 `allowedDomains`를 수정할 방법이 없다. 도메인을 잘못 입력하면 프로젝트를 다시 만들어야 한다. 다음 사이클에서 프로젝트 설정 화면과 함께 해소한다.
- 이벤트 보관 기간 정책이 없다. SQLite 파일이 무한히 커진다. 실제 사용자가 생긴 뒤에 정한다.
