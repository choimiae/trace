import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@trace/shared/privacy",
        replacement: new URL("../shared/src/privacy.ts", import.meta.url).pathname,
      },
      {
        find: "@trace/shared",
        replacement: new URL("../shared/src/index.ts", import.meta.url).pathname,
      },
    ],
  },
  test: {
    environment: "jsdom",
  },
});
