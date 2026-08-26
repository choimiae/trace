import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerSdkBundleRoutes } from "./sdk-bundle.js";

async function createBundleFile(contents: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "trace-bundle-"));
  const bundlePath = path.join(directory, "trace.js");
  await writeFile(bundlePath, contents, "utf8");
  return bundlePath;
}

describe("GET /trace.js", () => {
  it("번들을 JavaScript content type 으로 내려준다", async () => {
    const bundlePath = await createBundleFile("window.trace={};");
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, { bundlePath });

    const response = await app.inject({ method: "GET", url: "/trace.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/javascript");
    expect(response.body).toBe("window.trace={};");
    await app.close();
  });

  it("캐시 수명을 짧게 설정한다", async () => {
    const bundlePath = await createBundleFile("window.trace={};");
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, { bundlePath });

    const response = await app.inject({ method: "GET", url: "/trace.js" });

    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    await app.close();
  });

  it("번들이 없으면 404 와 빌드 안내 코드를 반환한다", async () => {
    const app = Fastify({ logger: false });
    await app.register(registerSdkBundleRoutes, {
      bundlePath: path.join(tmpdir(), "trace-missing", "trace.js"),
    });

    const response = await app.inject({ method: "GET", url: "/trace.js" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "sdk_bundle_not_built" });
    await app.close();
  });
});
