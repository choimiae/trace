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
npm run dev:api
```

다른 터미널에서 프로젝트를 생성합니다.

```bash
curl -s http://localhost:4000/api/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Demo SaaS","allowedDomains":["http://localhost:5174"]}'
```

반환된 `projectId`를 사용해 관리자 페이지를 실행합니다.

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
- raw custom metadata는 저장 가능한 allowlist만 보존합니다.
- 입력값, 전체 DOM 원문, 네트워크 body, 이메일/전화번호/긴 숫자 패턴은 저장하지 않습니다.

## 스펙과 계획

- 설계: `docs/superpowers/specs/2026-08-24-trace-mvp-design.md`
- 구현 계획: `docs/superpowers/plans/2026-08-24-trace-mvp-implementation.md`
