import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@trace/shared/privacy",
        replacement: new URL("../shared/src/privacy.ts", import.meta.url).pathname,
      },
      {
        find: "@trace/shared/hash",
        replacement: new URL("../shared/src/hash.ts", import.meta.url).pathname,
      },
      {
        find: "@trace/shared/recording-limits",
        replacement: new URL("../shared/src/recording-limits.ts", import.meta.url).pathname,
      },
      {
        find: "@trace/shared",
        replacement: new URL("../shared/src/index.ts", import.meta.url).pathname,
      },
      // rrweb 2.0.0-alpha.4 는 package.json 이 "type": "module" 인데 main 이
      // CJS(lib/rrweb-all.js)이고 exports 필드가 없다. 그대로 두면 node·vitest 가
      // `import "rrweb"` 를 실행하는 순간 "exports is not defined in ES module
      // scope" 로 죽는다. esbuild 브라우저 빌드는 module 필드(ES 빌드)를 골라
      // 정상 동작하므로, 테스트에서도 같은 ES 엔트리를 가리켜 실제 번들과
      // 같은 코드를 돌린다. 정규식인 것은 rrweb-snapshot 까지 삼키지 않기 위해서다.
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
