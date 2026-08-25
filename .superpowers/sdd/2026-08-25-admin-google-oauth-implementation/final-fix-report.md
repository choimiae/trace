# Admin Google OAuth Final Fix Report

## Status

DONE

## Commits Created

- `리뷰: Admin OAuth 배포 가드 보완`

## Findings

1. Production guard bypass
   - `prepareServerStartup`가 production에서 durable `TraceStore` guard를 OAuth 구성 여부와 관계없이 먼저 실행하고, complete OAuth config가 없으면 `ADMIN_OAUTH_CONFIG_REQUIRED`를 발생시킨다.
   - RED: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/api -- src/auth/config.test.ts src/auth/google.test.ts src/startup.test.ts`에서 missing/partial OAuth startup tests와 신규 startup module이 실패했다.
   - GREEN: 같은 명령이 API 40개 테스트 통과로 확인했다.

2. Missing Google ID token `exp`
   - `jwtVerify`에 `requiredClaims: ["exp"]`를 추가했고, 서명은 유효하지만 `exp`가 없는 토큰을 거부하는 regression test를 추가했다.
   - RED/GREEN: 위 API focused test 명령에서 수정 전에는 해당 token이 resolve됐고, 수정 후 통과했다.

3. Invalid numeric env values
   - `SESSION_TTL_SECONDS`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS`, `LOGIN_RATE_LIMIT_MAX`는 positive safe integer만 허용한다.
   - RED/GREEN: 위 API focused test 명령에서 0, 음수, 소수, unsafe integer 12개 case가 수정 전 실패했고, 수정 후 통과했다.

4. README bootstrap
   - clean `MemoryStore` local 환경에서 Google 로그인 뒤 Admin origin Console의 authenticated session/CSRF `POST /admin/api/projects`로 초기 project를 만드는 절차를 추가했다.
   - 검증: `README.md`의 요청은 기존 `apps/api/src/routes/admin.test.ts`의 authenticated project creation contract와 전체 테스트로 확인했다. 문서 변경에는 별도 자동 테스트가 필요하지 않다.

5. Shared-token runtime leftovers
   - 사용되지 않는 `TRACE_ADMIN_TOKEN` read와 `adminToken` app option을 제거했다.
   - 검증: `rg -n "TRACE_ADMIN_TOKEN|adminToken" apps README.md`가 결과 없이 종료했다.

6. Admin UI failure states
   - `auth/me` 403 access denied와 network failure 뒤 retry success 상태를 `App.test.tsx`에 추가했다.
   - 검증: `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run test --workspace @trace/admin -- src/App.test.tsx`가 5개 테스트 통과로 확인했다. 기존 production UI state machine 동작을 test-only로 고정한 항목이므로 RED는 해당하지 않는다.

## Final Test Summary

- `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm test`: 17 files, 121 tests passed.
- `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run typecheck`: passed.
- `PATH=/Users/choimiae/.nvm/versions/node/v22.17.0/bin:$PATH npm run build`: passed.

## Concerns

- Admin production build emits Vite's existing 500 kB chunk-size warning (generated JavaScript 531.81 kB); this fix wave does not change the Admin production bundle code.
