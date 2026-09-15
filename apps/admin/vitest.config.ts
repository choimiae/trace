import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // 더 구체적인 서브패스를 먼저 둔다. alias 는 접두사로 맞물려서
      // "@trace/shared" 가 먼저 걸리면 index.ts/recording-limits 가 된다.
      {
        find: "@trace/shared/recording-limits",
        replacement: new URL("../../packages/shared/src/recording-limits.ts", import.meta.url)
          .pathname,
      },
      {
        find: "@trace/shared",
        replacement: new URL("../../packages/shared/src/index.ts", import.meta.url).pathname,
      },
      // rrweb 2.0.0-alpha.4 는 package.json 이 "type": "module" 인데 main 이
      // CJS(lib/rrweb-all.js)이고 exports 필드가 없다. 그대로 두면 vitest 가
      // `import "rrweb"` 를 실행하는 순간 "exports is not defined in ES module
      // scope" 로 죽는다. vite build 는 module 필드(ES 빌드)를 골라 정상
      // 동작하므로, 테스트에서도 같은 ES 엔트리를 가리켜 실제 번들과 같은
      // 코드를 돌린다. packages/sdk/vitest.config.ts 가 같은 이유로 같은 별칭을
      // 둔다. 정규식인 것은 rrweb-snapshot 까지 삼키지 않기 위해서다.
      {
        find: /^rrweb$/,
        replacement: new URL(
          "../../node_modules/rrweb/es/rrweb/packages/rrweb/src/entries/all.js",
          import.meta.url,
        ).pathname,
      },
    ],
  },
  test: {
    environment: "jsdom",
  },
});
