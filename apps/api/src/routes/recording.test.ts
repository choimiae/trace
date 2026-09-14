import { gzipSync } from "node:zlib";
import { MAX_RECORDING_CHUNK_BYTES } from "@trace/shared/recording-limits";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { MemoryStore } from "../store/memory-store.js";

const ORIGIN = "https://demo.example.com";

async function replayProject(store: MemoryStore, enabled = true) {
  const project = await store.createProject({ name: "Demo", allowedDomains: [ORIGIN] });
  await store.updateProject(project.projectId, {
    name: project.name,
    allowedDomains: project.allowedDomains,
    replay: { enabled, maskSelectors: [] },
  });
  return project;
}

function chunkBody(overrides: Record<string, unknown> = {}) {
  return gzipSync(
    Buffer.from(
      JSON.stringify({
        projectId: "proj_replace_me",
        seq: 0,
        startedAt: "2026-09-14T00:00:00.000Z",
        url: `${ORIGIN}/orders?token=secret`,
        sdkVersion: "0.1.0",
        events: [{ type: 2, timestamp: 1 }, { type: 3, timestamp: 2 }],
        ...overrides,
      }),
    ),
  );
}

function post(app: ReturnType<typeof createApp>, body: Buffer, sessionId = "sess_abc123") {
  return app.inject({
    method: "POST",
    url: `/v1/sessions/${sessionId}/recording`,
    headers: { origin: ORIGIN, "content-type": "application/octet-stream" },
    payload: body,
  });
}

describe("POST /v1/sessions/:sessionId/recording", () => {
  it("gzip 청크를 받아 보낸 바이트 그대로 저장한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });
    const body = chunkBody({ projectId: project.projectId });

    const response = await post(app, body);

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 2 });
    const stored = await store.listSessionRecordingChunks(project.projectId, "sess_abc123");
    expect(stored).toHaveLength(1);
    expect(stored[0]!.eventCount).toBe(2);
    // 풀어서 저장하지 않는다 - 보낸 gzip 바이트가 그대로 남아야 한다.
    expect(Buffer.from(stored[0]!.bytes).equals(body)).toBe(true);
  });

  // rrweb 이벤트 모양은 버전에 묶여 있다. 서버가 내부 구조를 판정하면 rrweb 을
  // 올릴 때마다 멀쩡한 기록이 400 이 된다.
  it("rrweb 이벤트의 내부 구조를 보지 않는다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });

    const response = await post(
      app,
      chunkBody({ projectId: project.projectId, events: [{ 모르는필드: true }, 7] }),
    );

    expect(response.statusCode).toBe(202);
  });

  it("리플레이가 꺼진 프로젝트의 기록을 거절한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store, false);
    const app = createApp({ store });

    const response = await post(app, chunkBody({ projectId: project.projectId }));

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "replay_disabled" });
  });

  it("허용하지 않은 도메인을 거절한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions/sess_abc123/recording",
      headers: { origin: "https://evil.example.com", "content-type": "application/octet-stream" },
      payload: chunkBody({ projectId: project.projectId }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "domain_not_allowed" });
  });

  it("없는 프로젝트는 404 다", async () => {
    const store = new MemoryStore();
    const app = createApp({ store });

    const response = await post(app, chunkBody({ projectId: "proj_missing" }));

    expect(response.statusCode).toBe(404);
  });

  it("gzip 이 아닌 본문을 400 으로 거절한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });

    const response = await post(app, Buffer.from("not gzip at all"));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_recording_chunk" });
  });

  // 압축 폭탄. 이 가드가 없으면 2 MB 본문이 해제 중에 수 GB 로 부풀어 서버가 죽는다.
  it("압축 해제 결과가 상한을 넘으면 거절한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x61));

    const response = await post(app, bomb);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_recording_chunk" });
  });

  // bodyLimit 은 gunzip 을 타기도 전, Fastify 가 요청을 받는 첫 관문이다. 이
  // 가드가 없으면 gzip 여부와 무관하게 임의로 큰 본문이 그대로 핸들러까지
  // 들어온다.
  it("본문이 상한을 넘으면 413 으로 거절한다", async () => {
    const store = new MemoryStore();
    await replayProject(store);
    const app = createApp({ store });

    const response = await post(app, Buffer.alloc(MAX_RECORDING_CHUNK_BYTES + 1, 0x61));

    expect(response.statusCode).toBe(413);
  });

  it("세션 식별자 모양을 검증한다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });

    const response = await post(app, chunkBody({ projectId: project.projectId }), "not a session");

    expect(response.statusCode).toBe(400);
  });

  it("같은 seq 재전송은 한 번만 저장된다", async () => {
    const store = new MemoryStore();
    const project = await replayProject(store);
    const app = createApp({ store });
    const body = chunkBody({ projectId: project.projectId });

    await post(app, body);
    const second = await post(app, body);

    expect(second.statusCode).toBe(202);
    expect(await store.listSessionRecordingChunks(project.projectId, "sess_abc123")).toHaveLength(1);
  });
});
