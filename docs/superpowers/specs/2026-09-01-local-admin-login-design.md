# 로컬 전용 간편 로그인 Design

작성일 2026-09-01 · 브랜치 `main`

## 배경

self-hosted 설치 흐름은 Google OAuth 클라이언트 준비가 필요하다. 운영 배포에서는 맞는 선택이지만, 로컬에서 Trace의 핵심 흐름을 확인하려는 사용자는 Google Cloud Console 설정 전에 이벤트 수집과 관리자 화면을 먼저 보고 싶다.

## 목적

로컬 개발 환경에서만 Google OAuth 없이 관리자 세션을 만들 수 있게 한다. 운영 환경의 인증 강도는 낮추지 않는다.

## 범위

**한다**

- `LOCAL_ADMIN_LOGIN=true`일 때 로컬 전용 로그인 route를 제공한다.
- 로컬 로그인은 기존 admin session, CSRF cookie, audit log 흐름을 재사용한다.
- `NODE_ENV=development` 또는 `test`에서만 로컬 로그인을 허용한다.
- `production`, `staging`, `preview`에서 로컬 로그인이 켜져 있으면 서버 시작을 실패시킨다.
- Admin UI 로그인 화면은 서버가 로컬 로그인을 허용한다고 알려줄 때만 `로컬로 시작하기` 버튼을 보여준다.
- README에 로컬 간편 로그인과 운영 배포 주의사항을 문서화한다.

**하지 않는다**

- 운영 환경에서 인증 없는 로그인을 허용하지 않는다.
- Google OAuth 흐름을 제거하지 않는다.
- 비밀번호 로그인, 회원가입, 초대 메일을 만들지 않는다.
- 로컬 로그인 사용자 선택 UI를 만들지 않는다.

## 제품 동작

로컬 사용자는 `.env`에 다음 최소 값을 둔다.

```bash
NODE_ENV=development
LOCAL_ADMIN_LOGIN=true
SESSION_SECRET=0123456789abcdef0123456789abcdef
ADMIN_APP_ORIGIN=http://localhost:5173
ADMIN_ALLOWED_EMAILS=admin@example.com
COOKIE_SECURE=false
```

관리자 로그인 화면에는 `로컬로 시작하기` 버튼이 추가된다. 버튼을 누르면 브라우저가 `/auth/local/start`로 이동한다. 서버는 `ADMIN_ALLOWED_EMAILS`의 첫 번째 이메일로 admin user를 upsert하고 기존 세션 cookie와 CSRF cookie를 발급한 뒤 `ADMIN_APP_ORIGIN`으로 redirect한다.

Google OAuth 값이 함께 설정되어 있으면 `Google로 로그인`도 계속 보인다. Google OAuth 값이 없고 로컬 로그인이 켜져 있으면 로컬 버튼만 보인다.

## API 설계

`GET /auth/me` 응답에 다음 필드를 추가한다.

```ts
auth: {
  googleLogin: boolean;
  localLogin: boolean;
}
```

세션이 없을 때도 로그인 화면이 어떤 버튼을 보여줄지 알아야 하므로 `GET /auth/login-options`를 추가한다.

```json
{
  "googleLogin": true,
  "localLogin": false
}
```

`GET /auth/local/start`는 로컬 로그인이 꺼져 있으면 `404 local_login_disabled`를 반환한다. 켜져 있으면 세션을 만들고 관리자 앱으로 redirect한다. 로그인 성공 audit log는 `auth.login_success`이고 metadata에 `{ "provider": "local" }`를 넣는다.

## 설정 설계

`AdminAuthConfig`는 Google OAuth 값을 선택 필드로 가진다. auth 설정이 유효하려면 `SESSION_SECRET`, `ADMIN_APP_ORIGIN`, 비어 있지 않은 `ADMIN_ALLOWED_EMAILS`가 있고, Google OAuth 전체 설정 또는 로컬 로그인 중 하나가 있어야 한다.

로컬 로그인은 `env.LOCAL_ADMIN_LOGIN === "true"`일 때만 켜진다.

`assertDeployableAdminAuthConfig`는 다음을 강제한다.

- production에서는 auth config가 반드시 있어야 한다.
- production에서는 Google OAuth 전체 설정이 반드시 있어야 한다.
- `LOCAL_ADMIN_LOGIN=true`는 `development`와 `test`에서만 허용한다.
- `COOKIE_SECURE=false`는 기존처럼 `development`와 `test`에서만 허용한다.

## 테스트 기준

- Google OAuth env가 없어도 로컬 로그인 env가 있으면 auth config가 생성된다.
- production에서 로컬 로그인이 켜져 있으면 시작이 실패한다.
- production에서 Google OAuth 없이 로컬 로그인만 있으면 시작이 실패한다.
- `/auth/login-options`가 활성화된 로그인 방식을 반환한다.
- `/auth/local/start`가 로컬 사용자 세션을 만들고 redirect한다.
- 로컬 로그인 성공 후 `/auth/me`가 기존 dashboard bootstrap에 필요한 user, projects, csrfToken을 반환한다.
- Admin UI는 login options에 따라 로컬 버튼을 표시하고 클릭 시 `/auth/local/start`로 이동한다.
- Admin UI는 local login option이 없으면 기존 Google 로그인 화면 동작을 유지한다.
