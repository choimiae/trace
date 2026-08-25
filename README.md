# trace

사용자 행동 분석/통계 제품 MVP입니다. SaaS 제품 운영자가 사용자의 막힘 지점을 관리자 페이지에서 통계, 차트, 세션 타임라인으로 확인할 수 있게 합니다.

## 실행

```bash
npm install
npm test
npm run build
npm run typecheck
```

## 로컬 확인

API 서버를 실행합니다.

```bash
GOOGLE_CLIENT_ID=<client-id> \
GOOGLE_CLIENT_SECRET=<client-secret> \
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback \
SESSION_SECRET=<32+ byte random string> \
ADMIN_APP_ORIGIN=http://localhost:5173 \
ADMIN_ALLOWED_EMAILS=admin@example.com \
COOKIE_SECURE=false \
npm run dev:api
```

Google Cloud Console에서 위 callback URL을 OAuth redirect URI로 등록하고, `ADMIN_ALLOWED_EMAILS`에 로그인할 관리자 이메일을 설정합니다.

`MemoryStore`는 빈 상태로 시작합니다. 첫 프로젝트는 Google 로그인으로 세션을 만든 뒤, Admin origin(`http://localhost:5173`)의 브라우저 개발자 도구 Console에서 아래 요청으로 생성합니다. `auth/me`가 세션의 CSRF token을 반환하고, 브라우저가 `Origin`과 HttpOnly session cookie를 자동으로 포함합니다.

```js
const apiBase = "http://localhost:4000";
const me = await fetch(`${apiBase}/auth/me`, { credentials: "include" }).then((response) => response.json());
const project = await fetch(`${apiBase}/admin/api/projects`, {
  method: "POST",
  credentials: "include",
  headers: { "content-type": "application/json", "x-trace-csrf": me.csrfToken },
  body: JSON.stringify({ name: "Local Trace", allowedDomains: ["http://localhost:5174"] }),
}).then((response) => response.json());
console.log(project.projectId);
```

출력된 `projectId`를 `VITE_PROJECT_ID`에 설정하거나, Admin UI를 새로고침해 첫 연결 프로젝트로 사용합니다.

관리자 페이지를 실행합니다.

```bash
VITE_PROJECT_ID=<projectId> npm run dev:admin
```

데모 사이트를 실행하고, 생성한 프로젝트 ID를 query string으로 넘깁니다.

```bash
npm run dev:demo
```

```text
http://localhost:5174/?projectId=<projectId>
```

### 로컬 fake OAuth smoke

브라우저용 fake OAuth 서버는 제공하지 않습니다. 대신 API route 테스트가 fake Google client로 Google redirect, callback, 세션 쿠키, `/auth/me`, 그리고 세션 쿠키를 사용하는 Admin BFF를 검증합니다.

```bash
npm run test --workspace @trace/api -- src/routes/auth.test.ts src/routes/admin.test.ts
```

예상 결과:

- `/auth/google/start`는 Google authorization URL로 `302` redirect하고 OAuth state cookie를 설정합니다.
- fake Google client callback은 code를 교환하고 `__trace_admin_session` cookie를 생성한 뒤 Admin origin으로 `302` redirect합니다.
- 세션 cookie를 포함한 `/auth/me`는 `200`과 사용자 및 CSRF token을 반환하고, cookie가 없으면 `401`을 반환합니다.
- 세션 cookie를 포함한 Admin BFF 요청은 인증을 사용하며, cookie가 없으면 `401`, project membership이 없으면 `403`을 반환합니다.

### 프로덕션 배포 체크리스트

현재 `MemoryStore`는 `isDurable === false`이므로 production에 배포할 수 없습니다. 모든 `NODE_ENV=production` 배포에는 `isDurable === true`인 durable `TraceStore`가 필요합니다.

- HTTPS를 사용합니다.
- `COOKIE_SECURE=true`를 설정합니다.
- `ADMIN_APP_ORIGIN`을 고정된 Admin origin으로 설정합니다.
- Google OAuth redirect URI가 배포된 `/auth/google/callback` URL과 정확히 일치하도록 등록합니다.
- `ADMIN_ALLOWED_EMAILS`에 허용할 관리자 이메일을 설정합니다.
- durable `TraceStore`를 구성하고 `isDurable === true`를 보장합니다.

## MVP 1차 범위

- 브라우저 SDK 이벤트 수집
- 수집 API
- private by default 마스킹
- 규칙 기반 막힘 감지
- 문제 인박스
- 홈 요약 통계와 차트
- 문제 상세와 세션 타임라인

## 개인정보 기준

- SDK와 API 모두 URL query value를 저장하지 않습니다.
- 민감 query key는 `redacted_param_N` 형태로 치환합니다.
- URL path의 이메일, UUID, 토큰형 segment와 사용자/계정/세션 등 identity container 하위 segment는 `:id`로 치환합니다.
- 이벤트/세션/페이지/selector/role identifier는 안전한 형식만 저장하고, raw 입력이 안전하지 않으면 저장 전에 대체하거나 버립니다.
- 관리자 API는 `HttpOnly` 세션 쿠키와 프로젝트 membership으로 보호하며, Admin UI는 브라우저에 관리자 토큰을 저장하지 않습니다.
- raw custom metadata는 저장 가능한 allowlist만 보존합니다.
- 입력값, 전체 DOM 원문, 네트워크 body, 이메일/전화번호/긴 숫자 패턴은 저장하지 않습니다.

## 스펙과 계획

- 설계: `docs/superpowers/specs/2026-08-24-trace-mvp-design.md`
- 구현 계획: `docs/superpowers/plans/2026-08-24-trace-mvp-implementation.md`
