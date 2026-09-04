import { MAX_SCREEN_LAYOUT_HINTS } from "@trace/shared";
import { MAX_LAYOUT_HINTS } from "@trace/sdk/dom";
import { describe, expect, it } from "vitest";

// SDK 의 MAX_LAYOUT_HINTS(수집기 방출 예산)와 shared 의 MAX_SCREEN_LAYOUT_HINTS(계약
// 상한, screenLayoutHintSchema.array().max())는 따로 관리된다 — SDK 는 zod 를 실어
// 오는 @trace/shared 전체를 런타임 번들에 넣지 않으려고 값을 복제해 둔다. 이 테스트는
// 그 둘이 어긋나지 않는지 못박는다. 어긋나서 SDK 예산이 계약 상한을 넘으면, 서버가
// 초과분을 자르거나(ingestion.ts:239 의 slice) 스키마 검증에서 그 이벤트 전체가
// 떨어진다 — 실제로 이 종류의 드리프트가 이 브랜치의 결함 하나를 만들었다.
//
// 이 파일은 apps/api 의 테스트 전용이다. 두 상수를 동시에 볼 수 있는 곳이 필요했고,
// SDK 는 (번들 크기 때문에) shared 를, shared 는 (계층 방향상) SDK 를 프로덕션
// 코드에서 서로 참조하지 않는다. vitest 별칭(apps/api/vitest.config.ts)이 dom.ts 를
// 소스로 직접 가리키므로 SDK 를 빌드할 필요가 없고, SDK 의 런타임 번들(dist/trace.js,
// index.ts 로부터 만들어진다)은 이 import 를 전혀 모른다 — MAX_LAYOUT_HINTS 는
// dom.ts 에서 export 만 됐을 뿐 index.ts 가 재수출하지 않는다.
describe("화면 힌트 예산 ↔ 계약 상한", () => {
  it("SDK 의 방출 예산이 shared 의 계약 상한을 넘지 않는다", () => {
    expect(MAX_LAYOUT_HINTS).toBeLessThanOrEqual(MAX_SCREEN_LAYOUT_HINTS);
  });
});
