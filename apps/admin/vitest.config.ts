import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 더 구체적인 서브패스를 먼저 둔다. alias 는 접두사로 맞물려서
      // "@trace/shared" 가 먼저 걸리면 index.ts/recording-limits 가 된다.
      "@trace/shared/recording-limits": new URL(
        "../../packages/shared/src/recording-limits.ts",
        import.meta.url,
      ).pathname,
      "@trace/shared": new URL("../../packages/shared/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
  },
});
