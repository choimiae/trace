# trace

사이트에 스크립트 한 줄을 붙이면 사용자가 막히는 지점을 관리자 페이지에서 통계, 차트, 세션 타임라인으로 확인할 수 있습니다.

Trace는 self-hosted 제품입니다. 서버와 관리자 페이지를 직접 운영하고, 수집한 데이터는 여러분의 서버를 벗어나지 않습니다.

## 요구 사항

- Node 22.5 이상 (`.nvmrc` 참고)
- Google 계정 (운영 배포 또는 Google 로그인에 사용합니다)

## 시작하기

### 1. 설치

```bash
npm install
npm run build
```

### 2. 로그인 방식 선택

로컬에서 먼저 체험할 때는 Google OAuth 없이 `LOCAL_ADMIN_LOGIN=true`를 쓸 수 있습니다. 이 방식은 `NODE_ENV=development` 또는 `test`에서만 동작하며, 서버에 올릴 때는 사용할 수 없습니다.

운영 배포 또는 실제 Google 로그인을 확인하려면 Google OAuth를 준비합니다. Google Cloud Console에서 OAuth 2.0 클라이언트 ID를 하나 만들고, 승인된 리디렉션 URI에 아래 주소를 등록합니다.


```text
http://localhost:4000/auth/google/callback
```

### 3. 로컬 환경변수 설정

루트 `.env`와 `apps/api/.env`는 API 서버가 시작할 때 자동으로 읽습니다.

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

로컬 간편 로그인만 사용할 때는 `apps/api/.env`에 세션 키와 관리자 이메일만 채웁니다.

```env
SESSION_SECRET=<32자 이상 임의 문자열>
ADMIN_ALLOWED_EMAILS=admin@example.com
```

Google 로그인을 함께 쓰려면 Google Cloud Console에서 받은 값도 추가합니다.

```env
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
```

`SESSION_SECRET`은 Google에서 받는 값이 아니라 세션 쿠키 서명용 랜덤 문자열입니다.

```bash
openssl rand -base64 32
```

루트 `.env`의 로컬 기본값은 아래와 같습니다.

```env
NODE_ENV=development
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
ADMIN_APP_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
LOCAL_ADMIN_LOGIN=true
TRACE_DB_PATH=./trace.db
```

`COOKIE_SECURE=false`와 `LOCAL_ADMIN_LOGIN=true`는 `NODE_ENV`가 `development`나 `test`일 때만 허용됩니다.

### 4. API 서버 실행

```bash
npm run dev:api
```

데이터는 `TRACE_DB_PATH`에 지정한 SQLite 파일에 저장되고 서버를 재시작해도 남습니다.

`events.timestamp`는 SDK가 기록한 이벤트 발생 시각이며 UTC ISO 문자열로 저장합니다. 서버가 받은 시각은
`events.received_at`에 UTC로 저장합니다. DB Browser에서 한국시간 기준으로 확인하려면 `events_debug`
view를 열면 됩니다. 이 view에는 `occurred_at_kst`, `received_at_kst` 컬럼이 포함됩니다.

`EVENT_RETENTION_DAYS`를 설정하면 지정한 일수보다 오래된 원본 이벤트만 자동 삭제합니다. 예를 들어 `EVENT_RETENTION_DAYS=30`이면 30일보다 오래된 `events` 행을 서버 시작 시와 이벤트 수집 후 정리합니다. `issues`, 관리자 활동 이력, 프로젝트, 사용자, 세션 데이터는 이 설정으로 삭제하지 않습니다.

### 5. 관리자 페이지 실행

```bash
npm run dev:admin
```

`http://localhost:5173`을 엽니다. 로컬 간편 로그인이 켜져 있으면 `로컬로 시작하기`를 누릅니다. Google OAuth를 설정했다면 `Google로 로그인`도 사용할 수 있습니다. 로그인하면 프로젝트 생성 화면이 나오고, 이름과 허용 도메인을 입력하면 사이트에 붙일 스크립트를 알려줍니다.

```html
<script src="http://localhost:4000/trace.js" data-project-id="proj_xxxxxxxxxx"></script>
```

허용 도메인은 이벤트를 받을 사이트의 origin입니다. 로컬 데모 사이트로 확인하려면 `http://localhost:5174`를 입력합니다.

세션 리플레이를 켜도 설치는 같은 한 줄입니다. `trace.js`가 프로젝트 설정을 받아 켜진 경우에만 `trace-replay.js`를 스스로 불러옵니다. 둘 다 trace API가 직접 서빙하므로 CSP에 추가할 항목이 없습니다. 무엇을 저장하고 무엇이 가려지지 않는지는 [세션 리플레이가 가리지 못하는 것](#세션-리플레이가-가리지-못하는-것)을 보세요.

## 데모 사이트로 확인하기

붙일 사이트가 아직 없으면 포함된 데모 사이트로 확인할 수 있습니다.

```bash
npm run dev:demo
```

프로젝트 생성 후 표시된 프로젝트 ID를 query string으로 넘깁니다.

```text
http://localhost:5174/?projectId=<projectId>
```

데모 사이트에서 버튼을 몇 번 클릭하면 관리자 페이지의 설치 화면이 첫 이벤트 도착을 알려줍니다. 이후 대시보드에서 수집된 이벤트와 감지된 문제를 확인할 수 있습니다.

## 수집하는 것과 수집하지 않는 것

개인을 식별할 수 있는 정보는 최소한으로만 수집합니다. 다만 **화면에 보이는 글자는 저장됩니다** — 이름·고객명이 화면에 떠 있는 사이트라면 그것도 들어갑니다. 아래 표의 `요소 텍스트` 항목을 보세요.

| 항목 | 동작 |
| --- | --- |
| 쿠키, localStorage, sessionStorage | 사용하지 않습니다 |
| 방문자 ID | 페이지를 열 때마다 새로 만들고 저장하지 않습니다. 새로고침하면 다른 ID가 됩니다 |
| IP 주소 | 저장하지 않습니다 |
| URL 경로 | 식별자로 보이는 부분을 `:id`로 바꿉니다. `/users/alice/settings` -> `/users/:id/settings` |
| URL 쿼리 | 값을 전부 `[redacted]`로 바꿉니다 |
| 요소 텍스트 | 마스킹하고 120자로 제한합니다. 선택자는 해시로 저장합니다. **클릭한 요소와 그 주변 상자의 글자를 태그 종류와 무관하게 저장합니다** — 화면에 보이는 사람 이름·고객명이 있으면 그것도 저장됩니다 |
| 페이지 제목 | 마스킹하고 120자로 제한합니다. 제목에 사람 이름이 들어가는 사이트라면 그 이름은 저장됩니다 |
| 입력값 원문 | 수집하지 않습니다 |
| 클릭 좌표, 화면 크기 | 수집합니다 |
| 세션 리플레이 | 기본으로 꺼져 있고 운영자가 프로젝트마다 켭니다. 켜도 트리거(같은 자리 연속 클릭·JS 오류·반응 없는 클릭)가 걸린 세션만 올라갑니다. 입력값은 `input`·`textarea`·`select`·`password`를 모두 마스킹하고(`<textarea>`는 HTML에 적혀 온 초기 내용까지), 화면 텍스트는 이메일·한국 휴대폰·9자리 이상 숫자를 `[redacted]`로 바꿉니다. 운영자가 지정한 마스킹 셀렉터에 걸린 텍스트는 통째로 `*`로 가립니다. 기본 7일 뒤 삭제합니다(`SESSION_RECORDING_RETENTION_DAYS`). 가려지지 않는 자리는 아래 절에 따로 적었습니다 |

> **주변 상자 글자 수집은 임시로 넓혀 둔 상태입니다(2026-09-14).** 원래는 `button`·`a`·`h1~h3` 에만 글자를 담았는데, 메뉴가 `span` 이고 버튼이 `div` 인 화면에서 글자가 **0건**이라 미리보기로 어느 화면인지 알아볼 수 없었습니다. 먼저 넓혀서 미리보기 품질을 확인하고, 그다음 걷을 대상을 좁히는 순서입니다. 좁힐 때 손댈 곳은 세 군데입니다 — `packages/sdk/src/dom.ts` 의 `ownElementText`, `apps/api/src/routes/ingestion.ts` 의 힌트 텍스트 게이트, 그리고 이 표의 `요소 텍스트` 행.
>
> 입력값은 이 변경과 무관하게 수집하지 않습니다. `input`·`select`·`textarea`·편집영역은 항상 마스킹되고, 서버가 경계에서 한 번 더 판정합니다.

`track()`으로 직접 넘기는 metadata에 회원번호 같은 내부 식별자를 넣으면 그것은 저장됩니다. 이메일 형태는 자동으로 걸러내지만 임의의 내부 식별자는 걸러낼 수 없습니다.

## 세션 리플레이가 가리지 못하는 것

세션 리플레이는 **기본으로 꺼져 있습니다.** 운영자가 프로젝트 설정에서 켠 프로젝트만 화면을 기록하고, 켜도 트리거가 걸린 세션만 서버로 올라갑니다. 올라온 기록은 기본 7일 뒤 삭제합니다(`SESSION_RECORDING_RETENTION_DAYS`).

> **리플레이 마스킹의 정본은 SDK 한 곳입니다.** 다른 필드와 달리 서버가 다시 판정하지 않습니다 — rrweb 이벤트 안의 텍스트가 가려졌는지 서버가 확인하려면 DOM 트리를 해석해야 하고, 그것은 서버에 rrweb을 다시 구현하는 일입니다. 패턴이 없는 개인정보(사람 이름 등)는 **운영자가 마스킹 셀렉터로 지정해야** 가려집니다.

아래는 브라우저에서 rrweb을 직접 돌려 확인한 구멍입니다. 어떤 셀렉터를 지정할지 정하기 전에 읽어야 하는 표입니다.

| 가려지지 않는 것 | 왜 그런가, 그래서 무엇이 저장되나 |
| --- | --- |
| `style` 속성 안의 `data:` URI | `data:` URI는 `src`·`srcset`·`href`·`poster`·`data`·`xlink:href` 여섯 속성에서만 걷어냅니다. `style="background-image:url(data:image/png;base64,...)"`처럼 인라인 스타일에 박힌 것은 남습니다 — 그 이미지가 서명·신분증 같은 것이면 base64 원본이 그대로 저장됩니다. `style`은 패턴 훑기에서도 제외입니다. CSS를 고쳐 쓰면 재생 화면이 원본과 달라지기 때문입니다 |
| 셀렉터로 지정한 요소의 속성 | rrweb의 마스킹 게이트(`maskTextSelector`)는 **텍스트 노드에만** 걸립니다. 운영자가 지정한 요소라도 `title`·`aria-label`·`data-*` 같은 속성은 가려지지 않습니다. 속성은 패턴(이메일·한국 휴대폰·9자리 이상 숫자)으로만 훑을 뿐 셀렉터로 통째로 지우는 경로가 없습니다. `<div class="pii" title="홍길동">홍길동</div>`이면 본문은 `***`가 되고 `title`의 이름은 남습니다 |
| `<iframe srcdoc>` 속성에 적어 둔 마크업 | `srcdoc`은 문서 하나가 속성값 문자열 하나로 들어옵니다. 패턴 훑기는 닿지만 rrweb의 셀렉터 게이트도 입력값 마스킹도 그 문자열 안을 보지 못합니다. 그래서 **속성에 적어 둔 마크업이 그대로** 저장됩니다 — 거기에 사람 이름이 박혀 있으면 남습니다. rrweb은 iframe의 `src`는 지우면서 `srcdoc`은 지우지 않습니다. 반대로 같은 출처 iframe의 **문서 내용**은 별도 스냅샷으로 다시 직렬화되고 셀렉터·입력값 마스킹이 그대로 걸립니다 — 사용자가 iframe 안에서 채운 값은 가려지니, iframe 자체를 피할 이유는 없습니다 |
| radio·checkbox의 값, 그리고 패턴이 없는 입력 텍스트 | rrweb은 radio·checkbox를 입력값 마스킹에서 제외합니다. 그래서 이 값들은 **두 경로로** 나갑니다 — 첫 스냅샷에는 `value` 속성 그대로, 그리고 하나를 누르면 형제 전부가 `data.text`로 한 번 더. 우리는 양쪽 다 **패턴으로만** 훑습니다 — 통째로 가리지 않습니다. 통째로 가리면 텍스트 입력이 함께 깨지는데, 그쪽은 rrweb이 넣은 `*`의 **개수가 곧 재생 정보**라 길이를 잃으면 안 됩니다. 결과: `010-1234-5678`은 지워지지만 `홍길동` 같은 이름은 그대로 남습니다 |
| `class`·`id`에 박힌 개인정보 | 두 속성은 패턴 훑기에서 제외합니다. `inlineStylesheet:false`라 재생기가 사이트의 진짜 스타일시트를 불러오는데, `id="user-hong@example.com"`을 고쳐 쓰면 선택자가 안 맞아 재생 화면이 원본과 달라집니다. 마크업 식별자에 개인정보를 넣지 않는 것 말고는 막을 방법이 없습니다 |

`tel:` 링크는 예외적으로 `href`를 통째로 지웁니다(`tel:[redacted]`). 다만 지워지는 것은 `href`뿐이고, 링크에 **보이는 글자**는 위의 일반 규칙을 따릅니다 — 셀렉터로 지정하지 않았고 패턴에도 걸리지 않는 형태(대표번호 `1588-1234`, 국제번호)라면 전화번호가 화면 글자로 남습니다.

## 동의 배너를 쓰는 경우

기본값은 스크립트를 붙이면 바로 수집을 시작하는 것입니다. 사용자 동의를 먼저 받아야 하는 지역에 서비스한다면 수집을 보류하고 동의 후 시작하세요.

```html
<script src="http://localhost:4000/trace.js" data-project-id="proj_xxx" data-consent="pending"></script>
```

```js
window.trace.consent.grant();
```

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | 운영 필수 | - | Google OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | 운영 필수 | - | Google OAuth 클라이언트 시크릿 |
| `GOOGLE_REDIRECT_URI` | 운영 필수 | - | OAuth 콜백 주소 |
| `SESSION_SECRET` | 필수 | - | 세션 쿠키 서명 키. 32자 이상 |
| `ADMIN_APP_ORIGIN` | 필수 | - | 관리자 페이지 origin. CORS 허용 대상 |
| `ADMIN_ALLOWED_EMAILS` | 필수 | - | 로그인 허용 이메일. 쉼표로 구분 |
| `GOOGLE_ALLOWED_DOMAIN` | 선택 | - | 특정 Google Workspace 도메인으로 제한 |
| `LOCAL_ADMIN_LOGIN` | 선택 | `false` | `true`이면 로컬 개발에서 Google OAuth 없이 로그인합니다 |
| `NODE_ENV` | 선택 | - | `development` 또는 `test`일 때만 `COOKIE_SECURE=false`와 `LOCAL_ADMIN_LOGIN=true`를 허용합니다 |
| `COOKIE_SECURE` | 선택 | `true` | 로컬 개발에서만 `false`로 둡니다 |
| `TRACE_DB_PATH` | 선택 | `./trace.db` | SQLite 데이터베이스 파일 경로 |
| `EVENT_RETENTION_DAYS` | 선택 | - | 양의 정수. 지정한 일수보다 오래된 `events`만 삭제합니다 |
| `SESSION_RECORDING_RETENTION_DAYS` | 선택 | `7` | 양의 정수. 지정한 일수보다 오래된 세션 리플레이 기록만 삭제합니다. 이벤트와 달리 기본값이 있습니다 |
| `PORT` | 선택 | `4000` | API 서버 포트 |
| `SESSION_TTL_SECONDS` | 선택 | `28800` | 세션 유효 기간 |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | 선택 | `300` | 로그인 rate limit 시간 창 |
| `LOGIN_RATE_LIMIT_MAX` | 선택 | `20` | 시간 창당 로그인 시도 허용 횟수 |

관리자 페이지는 `VITE_API_BASE_URL`로 API 주소를 지정할 수 있고, 기본값은 `http://localhost:4000`입니다.

## 서버에 올릴 때

HTTPS를 사용하고 `COOKIE_SECURE=true`로 둡니다. `LOCAL_ADMIN_LOGIN`은 설정하지 않습니다. `GOOGLE_REDIRECT_URI`와 `ADMIN_APP_ORIGIN`을 실제 주소로 바꾸고, Google Cloud Console의 승인된 리디렉션 URI에도 같은 주소를 등록해야 합니다.

SQLite를 쓰므로 단일 인스턴스로 운영합니다.

## 개발

```bash
npm test
npm run typecheck
npm run build
```

인증 관련 통합 검증은 fake Google client로 동작합니다.

```bash
npm run test --workspace @trace/api -- src/routes/auth.test.ts src/routes/admin.test.ts
```

## 스펙과 계획

- 설계: `docs/superpowers/specs/2026-08-24-trace-mvp-design.md`
- 구현 계획: `docs/superpowers/plans/2026-08-24-trace-mvp-implementation.md`
