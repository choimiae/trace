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
        find: "@trace/shared/recording-limits",
        replacement: new URL("../../packages/shared/src/recording-limits.ts", import.meta.url).pathname,
      },
      {
        find: "@trace/shared",
        replacement: new URL("../../packages/shared/src/index.ts", import.meta.url).pathname,
      },
    ],
  },
  test: {
    environment: "node",
  },
});
