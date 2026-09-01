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

기본 설정에서 개인을 식별할 수 있는 정보를 수집하지 않습니다.

| 항목 | 동작 |
| --- | --- |
| 쿠키, localStorage, sessionStorage | 사용하지 않습니다 |
| 방문자 ID | 페이지를 열 때마다 새로 만들고 저장하지 않습니다. 새로고침하면 다른 ID가 됩니다 |
| IP 주소 | 저장하지 않습니다 |
| URL 경로 | 식별자로 보이는 부분을 `:id`로 바꿉니다. `/users/alice/settings` -> `/users/:id/settings` |
| URL 쿼리 | 값을 전부 `[redacted]`로 바꿉니다 |
| 요소 텍스트 | 마스킹하고 길이를 제한합니다. 선택자는 해시로 저장합니다 |
| 입력값 원문 | 수집하지 않습니다 |
| 클릭 좌표, 화면 크기 | 수집합니다 |

`track()`으로 직접 넘기는 metadata에 회원번호 같은 내부 식별자를 넣으면 그것은 저장됩니다. 이메일 형태는 자동으로 걸러내지만 임의의 내부 식별자는 걸러낼 수 없습니다.

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
