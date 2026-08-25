# Admin Google OAuth Design

## Goal

Trace Admin을 배포 가능한 인증 경계로 전환한다. 브라우저 번들에 관리자 토큰을 넣지 않고, Google OAuth server-side flow로 사용자를 인증한 뒤 Trace 서버가 `HttpOnly` 세션 쿠키를 발급한다.

## Scope

이번 범위는 Google OAuth 기반 Admin 인증 v1이다.

- Google OAuth/OIDC 로그인
- Trace 서버 세션 쿠키
- Admin 전용 API proxy 또는 BFF 경계
- 프로젝트별 membership 권한 확인
- 로그인/로그아웃/현재 사용자 조회
- 인증 실패와 권한 실패에 대한 Admin UI 처리
- CSRF, CORS, 로그인 rate limit, audit log의 최소 구현

이번 범위에서 제외한다.

- GitHub OAuth
- SAML/SCIM
- 결제/요금제
- 세부 조직 초대 플로우
- 비밀번호 기반 로그인
- 다중 Google Workspace domain 정책 UI

## Current Problem

현재 Admin API는 `TRACE_ADMIN_TOKEN`을 요구하고 Admin UI는 `VITE_TRACE_ADMIN_TOKEN`을 Bearer token으로 전송한다. `VITE_*` 값은 브라우저 JavaScript 번들에 포함되므로 배포 환경에서는 secret으로 취급할 수 없다.

수집 API와 Admin API의 CORS 정책도 같은 Fastify app 경계에 있으며, Admin read API는 서버 세션이 아니라 공유 token으로 보호된다. 이 구조는 로컬 MVP smoke에는 충분하지만, 외부 배포용 인증으로는 부족하다.

## Recommended Approach

Admin 인증은 server-side Google OAuth Authorization Code Flow로 구현한다.

1. 브라우저가 `/auth/google/start`로 이동한다.
2. 서버가 `state`, `nonce`, PKCE verifier를 생성하고 임시 OAuth 쿠키에 저장한다.
3. 서버가 Google authorization endpoint로 redirect한다.
4. Google이 `/auth/google/callback`으로 `code`와 `state`를 돌려준다.
5. 서버가 `state`를 검증하고 token endpoint에서 code를 교환한다.
6. 서버가 ID token의 issuer, audience, expiry, nonce, email_verified를 검증한다.
7. 서버가 Google `sub`와 email을 Trace `admin_users`에 매핑한다.
8. 사용자가 membership을 가진 프로젝트가 있으면 Trace session을 생성하고 `HttpOnly` 쿠키를 발급한다.
9. Admin UI는 이후 `/admin/api/*`만 호출하고, 서버가 session cookie와 project membership을 검사한다.

Google 공식 문서 기준으로 Web Server OAuth flow는 confidential information과 state를 서버에서 보관할 수 있는 애플리케이션을 위한 흐름이다. Google OIDC server flow는 anti-forgery state token 생성과 ID token 검증을 요구한다.

## Architecture

기존 `apps/api` Fastify app 안에 Admin BFF module을 먼저 추가한다. 별도 `apps/admin-server`로 분리하는 것은 배포 구성이 복잡해진 뒤로 미룬다.

- `apps/api/src/routes/auth.ts`
  - `/auth/google/start`
  - `/auth/google/callback`
  - `/auth/logout`
  - `/auth/me`

- `apps/api/src/routes/admin-proxy.ts`
  - `/admin/api/projects/:projectId/summary`
  - `/admin/api/projects/:projectId/issues`
  - `/admin/api/issues/:issueId`
  - `/admin/api/sessions/:sessionId/timeline`

- `apps/api/src/auth/google.ts`
  - Google authorization URL 생성
  - authorization code 교환
  - ID token 검증
  - Google profile claim 정규화

- `apps/api/src/auth/session.ts`
  - session id 생성
  - session cookie 생성/파싱
  - session 만료와 rotation

- `apps/api/src/auth/csrf.ts`
  - unsafe method에 대한 Origin/Referer 검증
  - CSRF token 생성/검증

- `apps/api/src/store/types.ts`
  - admin user, organization, membership, session, audit log store interface 추가

- `apps/api/src/store/memory-store.ts`
  - 로컬/test용 in-memory admin auth store 구현

- `apps/admin/src/api.ts`
  - `VITE_TRACE_ADMIN_TOKEN` 제거
  - `/admin/api/*`, `/auth/me`, `/auth/logout` 호출
  - `credentials: "include"` 사용

- `apps/admin/src/App.tsx`
  - 인증 상태 로딩
  - 401이면 로그인 화면
  - 로그인 버튼은 `/auth/google/start`로 이동

## Data Model

초기 구현은 `MemoryStore`에 맞추되, PostgreSQL schema도 함께 확장한다.

`admin_users`

- `admin_user_id`
- `google_sub`
- `email`
- `email_verified`
- `name`
- `picture_url`
- `created_at`
- `last_login_at`

`organizations`

- `organization_id`
- `name`
- `created_at`

`organization_memberships`

- `organization_id`
- `admin_user_id`
- `role`: `owner | admin | viewer`
- `created_at`

`project_memberships`

- `project_id`
- `admin_user_id`
- `role`: `owner | admin | viewer`
- `created_at`

`admin_sessions`

- `session_id_hash`
- `admin_user_id`
- `created_at`
- `expires_at`
- `last_seen_at`
- `revoked_at`
- `user_agent_hash`
- `ip_hash`

`audit_logs`

- `audit_log_id`
- `admin_user_id`
- `action`
- `project_id`
- `created_at`
- `metadata`

## Configuration

Required server env:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SESSION_SECRET`
- `ADMIN_APP_ORIGIN`
- `DATABASE_URL` when PostgreSQL store is enabled

Optional server env:

- `GOOGLE_ALLOWED_DOMAIN`
- `COOKIE_SECURE=true`
- `SESSION_TTL_SECONDS=28800`
- `LOGIN_RATE_LIMIT_WINDOW_SECONDS=300`
- `LOGIN_RATE_LIMIT_MAX=20`

Removed from Admin UI:

- `VITE_TRACE_ADMIN_TOKEN`

## Security Rules

- Google OAuth는 authorization code flow만 허용한다.
- 브라우저는 Google access token, ID token, Google client secret, internal API token을 저장하지 않는다.
- ID token은 issuer, audience, expiry, nonce, email_verified를 검증한다.
- `state`와 PKCE verifier는 callback에서 반드시 검증하고 1회성으로 소모한다.
- session cookie는 `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`로 설정한다.
- 로컬 개발에서만 `Secure=false`를 허용한다.
- `/admin/api/*`는 session이 없으면 401, project membership이 없으면 403을 반환한다.
- issue detail과 session timeline은 반드시 project scope와 membership을 함께 검증한다.
- CORS는 `ADMIN_APP_ORIGIN`만 허용한다.
- 수집 API `/v1/events/batch`의 allowed domain 검증은 기존처럼 project `allowedDomains` 기준으로 유지한다.
- unsafe method는 Origin/Referer 검증과 CSRF token 검증을 통과해야 한다.
- 로그인 시작과 callback은 rate limit을 적용한다.
- 인증 성공/실패, 로그아웃, 권한 거부, 프로젝트 생성은 audit log를 남긴다.

## User Experience

Admin UI는 `/auth/me`를 먼저 호출한다.

- 200: dashboard를 렌더링한다.
- 401: 로그인 화면을 렌더링한다.
- 403: 권한 없음 화면을 렌더링한다.
- 네트워크 실패: 재시도 가능한 오류 화면을 렌더링한다.

로그인 화면에는 Google 로그인 버튼 하나만 둔다. 버튼 클릭 시 브라우저를 `/auth/google/start`로 이동시킨다. 로그아웃은 `/auth/logout` POST 후 로그인 화면으로 돌아간다.

## Testing

단위 테스트:

- Google auth URL에 `state`, `nonce`, PKCE challenge, required scope가 포함된다.
- callback에서 state mismatch를 거부한다.
- ID token issuer/audience/expiry/nonce/email_verified 검증 실패를 거부한다.
- session cookie가 `HttpOnly`, `SameSite`, `Secure` 속성을 가진다.
- revoked/expired session은 거부된다.
- project membership이 없으면 Admin proxy가 403을 반환한다.
- issue detail은 다른 projectId로 조회할 수 없다.
- Admin UI는 `/auth/me` 401에서 로그인 화면을 보여준다.

통합 smoke:

- `/auth/google/start`가 Google authorization endpoint로 redirect한다.
- 테스트용 fake Google client로 callback을 통과하면 session cookie가 생성된다.
- cookie 포함 Admin proxy 요청이 summary/issues/timeline을 반환한다.
- cookie 없이 Admin proxy 요청은 401이다.
- Admin UI bundle에 `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `TRACE_ADMIN_TOKEN`, `VITE_TRACE_ADMIN_TOKEN` 문자열이 포함되지 않는다.

## Rollout

1. 기존 `TRACE_ADMIN_TOKEN` Admin UI 경로를 deprecated한다.
2. Google OAuth Admin Auth v1을 기본 경로로 추가한다.
3. README는 Google OAuth env와 local fake OAuth smoke 절차를 설명한다.
4. 배포 전 `COOKIE_SECURE=true`, HTTPS, `ADMIN_APP_ORIGIN` 고정 여부를 checklist로 확인한다.

## Implementation Status

구현 완료:

- `/auth/google/start`, `/auth/google/callback`, `/auth/me`, `/auth/logout`
- `/admin/api/projects`, `/admin/api/projects/:projectId/summary`, `/admin/api/projects/:projectId/issues`, `/admin/api/issues/:issueId`, `/admin/api/sessions/:sessionId/timeline`

검증 명령:

```bash
npm run test --workspace @trace/api
npm run test --workspace @trace/admin
npm test
npm run typecheck
npm run build
rg "GOOGLE_CLIENT_SECRET|SESSION_SECRET|TRACE_ADMIN_TOKEN|VITE_TRACE_ADMIN_TOKEN" apps/admin/dist apps/admin/src apps/api/src README.md
```

## Open Decisions

- 초기 사용자 seed 방식은 env allowlist로 시작한다: `ADMIN_ALLOWED_EMAILS`.
- 조직/프로젝트 생성 UI는 다음 단계로 미룬다.
- PostgreSQL store가 들어오기 전까지 production 배포는 단일 인스턴스 또는 sticky session 없는 MemoryStore를 허용하지 않는다.
