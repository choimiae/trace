// @vitest-environment node

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const GZIP_BUDGET_BYTES = 10 * 1024;

describe("SDK 번들 크기", () => {
  it("gzip 10KB 예산 안에 들어간다", async () => {
    const entryPoint = fileURLToPath(new URL("./index.ts", import.meta.url));
    const result = await build({
      entryPoints: [entryPoint],
      bundle: true,
      format: "iife",
      minify: true,
      write: false,
      platform: "browser",
    });

    const output = result.outputFiles[0];
    expect(output).toBeDefined();

    const gzipBytes = gzipSync(output!.contents).byteLength;
    expect(gzipBytes).toBeLessThan(GZIP_BUDGET_BYTES);
  });
});
