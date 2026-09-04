import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@trace/shared/privacy",
        replacement: new URL("../../packages/shared/src/privacy.ts", import.meta.url).pathname,
      },
      {
        find: "@trace/shared/hash",
        replacement: new URL("../../packages/shared/src/hash.ts", import.meta.url).pathname,
      },
      {
        find: "@trace/shared",
        replacement: new URL("../../packages/shared/src/index.ts", import.meta.url).pathname,
      },
      // MAX_LAYOUT_HINTS(SDK 방출 예산)와 MAX_SCREEN_LAYOUT_HINTS(shared 계약 상한)가
      // 어긋나지 않는지 못박는 테스트(screen-hint-budget.test.ts) 전용 별칭이다.
      // dom.ts 를 직접 소스로 가리켜, SDK 를 빌드하지 않고도(또 SDK 런타임 번들에
      // 아무 것도 더하지 않고도) 그 상수를 테스트에서만 읽는다.
      {
        find: "@trace/sdk/dom",
        replacement: new URL("../../packages/sdk/src/dom.ts", import.meta.url).pathname,
      },
    ],
  },
  test: {
    environment: "node",
  },
});
