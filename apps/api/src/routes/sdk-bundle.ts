import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

// src/routes와 dist/routes의 깊이가 같으므로 하나의 상대 경로가 개발과 빌드 양쪽에서 동작한다.
const DEFAULT_BUNDLE_PATH = fileURLToPath(
  new URL("../../../../packages/sdk/dist/trace.js", import.meta.url),
);
const DEFAULT_REPLAY_BUNDLE_PATH = fileURLToPath(
  new URL("../../../../packages/sdk/dist/trace-replay.js", import.meta.url),
);

export async function registerSdkBundleRoutes(
  app: FastifyInstance,
  options: { bundlePath?: string; replayBundlePath?: string },
): Promise<void> {
  // 리플레이 번들도 우리가 직접 서빙한다. CDN 을 쓰면 self-hosted 제품이 외부
  // 의존을 갖게 되고, 고객마다 CSP script-src 에 항목을 넣어야 하며, 안 넣으면
  // 조용히 실패한다. 같은 출처면 추가할 것이 없다.
  const bundles: Array<{ route: string; path: string; missingError: string }> = [
    { route: "/trace.js", path: options.bundlePath ?? DEFAULT_BUNDLE_PATH, missingError: "sdk_bundle_not_built" },
    {
      route: "/trace-replay.js",
      path: options.replayBundlePath ?? DEFAULT_REPLAY_BUNDLE_PATH,
      missingError: "replay_bundle_not_built",
    },
  ];

  for (const bundle of bundles) {
    app.get(bundle.route, async (_request, reply) => {
      let contents: Buffer;

      try {
        contents = await readFile(bundle.path);
      } catch {
        return reply.code(404).send({ error: bundle.missingError });
      }

      return reply
        .header("content-type", "application/javascript; charset=utf-8")
        .header("cache-control", "no-store")
        .send(contents);
    });
  }
}
