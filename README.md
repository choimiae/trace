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
TRACE_ADMIN_TOKEN=local_admin_token npm run dev:api
```

다른 터미널에서 프로젝트를 생성합니다.

```bash
curl -s http://localhost:4000/api/projects \
  -H 'authorization: Bearer local_admin_token' \
  -H 'content-type: application/json' \
  -d '{"name":"Demo SaaS","allowedDomains":["http://localhost:5174"]}'
```

반환된 `projectId`를 사용해 관리자 페이지를 실행합니다.

```bash
VITE_PROJECT_ID=<projectId> VITE_TRACE_ADMIN_TOKEN=local_admin_token npm run dev:admin
```

데모 사이트를 실행하고, 생성한 프로젝트 ID를 query string으로 넘깁니다.

```bash
npm run dev:demo
```

```text
http://localhost:5174/?projectId=<projectId>
```

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
- 로컬 MVP의 관리자 API는 `TRACE_ADMIN_TOKEN`으로 보호하고 Admin UI는 `VITE_TRACE_ADMIN_TOKEN`을 Bearer token으로 전송합니다. 이 토큰은 브라우저 번들에 포함되므로 배포 환경에서는 서버 프록시나 세션 기반 인증으로 교체해야 합니다.
- raw custom metadata는 저장 가능한 allowlist만 보존합니다.
- 입력값, 전체 DOM 원문, 네트워크 body, 이메일/전화번호/긴 숫자 패턴은 저장하지 않습니다.

## 스펙과 계획

- 설계: `docs/superpowers/specs/2026-08-24-trace-mvp-design.md`
- 구현 계획: `docs/superpowers/plans/2026-08-24-trace-mvp-implementation.md`
