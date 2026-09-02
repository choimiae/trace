import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

// src/routes와 dist/routes의 깊이가 같으므로 하나의 상대 경로가 개발과 빌드 양쪽에서 동작한다.
const DEFAULT_BUNDLE_PATH = fileURLToPath(
  new URL("../../../../packages/sdk/dist/trace.js", import.meta.url),
);

export async function registerSdkBundleRoutes(
  app: FastifyInstance,
  options: { bundlePath?: string },
): Promise<void> {
  const bundlePath = options.bundlePath ?? DEFAULT_BUNDLE_PATH;

  app.get("/trace.js", async (_request, reply) => {
    let contents: Buffer;

    try {
      contents = await readFile(bundlePath);
    } catch {
      return reply.code(404).send({ error: "sdk_bundle_not_built" });
    }

    return reply
      .header("content-type", "application/javascript; charset=utf-8")
      .header("cache-control", "no-store")
      .send(contents);
  });
}
