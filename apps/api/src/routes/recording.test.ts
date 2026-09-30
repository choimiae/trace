import { gzipSync } from "node:zlib";
import { MAX_RECORDING_CHUNK_BYTES } from "@trace/shared/recording-limits";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { SqliteStore } from "../store/sqlite-store.js";
import { createTestStore } from "../store/test-store.js";

const ORIGIN = "https://demo.example.com";

// 고정 시계. 예전에는 fixture 가 날짜를 박아 두고 createApp 은 진짜 시계를 써서,
// 2026-09-22 이 되는 순간 요청 안의 보존 스윕이 방금 넣은 청크를 지우고 두
// toHaveLength(1) 이 함께 무너지게 되어 있었다. 이제 앱과 fixture 가 같은 시계를
// 본다 - 달력이 지나가도 이 파일은 같은 것을 검사한다.
const NOW = new Date("2026-09-14T00:00:00.000Z");

function createRecordingApp(store: SqliteStore, now: Date = NOW) {
  return createApp({ store, now: () => now });
}

async function replayProject(store: SqliteStore, enabled = true) {
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
        // 시계에서 끌어온다. 박아 두면 그 날짜가 창 밖으로 밀려나는 날 썩는다.
        startedAt: NOW.toISOString(),
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
    const store = createTestStore();
    const project = await replayProject(store);
    const app = createRecordingApp(store);
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
    const store = createTestStore();
    const project = await replayProject(store);
    const app = createRecordingApp(store);

    const response = await post(
      app,
      chunkBody({ projectId: project.projectId, events: [{ 모르는필드: true }, 7] }),
    );

    expect(response.statusCode).toBe(202);
  });

  it("리플레이가 꺼진 프로젝트의 기록을 거절한다", async () => {
    const store = createTestStore();
    const project = await replayProject(store, false);
    const app = createRecordingApp(store);

    const response = await post(app, chunkBody({ projectId: project.projectId }));

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "replay_disabled" });
  });

  it("허용하지 않은 도메인을 거절한다", async () => {
    const store = createTestStore();
    const project = await replayProject(store);
    const app = createRecordingApp(store);

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
    const store = createTestStore();
    const app = createRecordingApp(store);

    const response = await post(app, chunkBody({ projectId: "proj_missing" }));

    expect(response.statusCode).toBe(404);
  });

  it("gzip 이 아닌 본문을 400 으로 거절한다", async () => {
    const store = createTestStore();
    const project = await replayProject(store);
    const app = createRecordingApp(store);

    const response = await post(app, Buffer.from("not gzip at all"));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_recording_chunk" });
  });

  // 압축 폭탄. 이 가드가 없으면 2 MB 본문이 해제 중에 수 GB 로 부풀어 서버가 죽는다.
  it("압축 해제 결과가 상한을 넘으면 거절한다", async () => {
    const store = createTestStore();
    const project = await replayProject(store);
    const app = createRecordingApp(store);
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x61));

    const response = await post(app, bomb);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_recording_chunk" });
  });

  // bodyLimit 은 gunzip 을 타기도 전, Fastify 가 요청을 받는 첫 관문이다. 이
  // 가드가 없으면 gzip 여부와 무관하게 임의로 큰 본문이 그대로 핸들러까지
  // 들어온다.
  it("본문이 상한을 넘으면 413 으로 거절한다", async () => {
    const store = createTestStore();
    await replayProject(store);
    const app = createRecordingApp(store);

    const response = await post(app, Buffer.alloc(MAX_RECORDING_CHUNK_BYTES + 1, 0x61));

    expect(response.statusCode).toBe(413);
  });

  // Fastify 의 기본 bodyLimit 은 1 MiB 다. MAX_RECORDING_CHUNK_BYTES(2 MiB)는 그
  // 기본값 위로 이 라우트만 "올려주는" 옵션이지, 새로 거는 제한이 아니다 -
  // 그래서 상한을 "넘겨서" 413 을 확인하는 테스트로는 그 옵션이 지워져도 여전히
  // 413 이 나와 통과해 버린다(1~2 MiB 사이 값은 기본값에도 걸리므로). 이 옵션이
  // 실제로 살아 있는지는 1~2 MiB 사이(정확히 2 MiB)의 본문이 bodyLimit 을
  // "통과해" 핸들러까지 들어오는지로만 검증할 수 있다. 정확히
  // MAX_RECORDING_CHUNK_BYTES 바이트의 비-gzip 본문을 보내 400
  // invalid_recording_chunk(gunzip 실패)를 기대한다 - 그 코드는 gunzip 을 타야만
  // 나오므로, bodyLimit 옵션을 지우면 이 요청은 413 으로 막혀 이 테스트가
  // 실패한다. 나중에 이 테스트를 413 확인으로 "단순화"하면 안 된다 - 그러면
  // 다시 회귀를 못 잡는다.
  it("2 MiB 본문은 bodyLimit 을 통과해 핸들러까지 들어온다", async () => {
    const store = createTestStore();
    await replayProject(store);
    const app = createRecordingApp(store);

    const response = await post(app, Buffer.alloc(MAX_RECORDING_CHUNK_BYTES, 0x61));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_recording_chunk" });
  });

  it("세션 식별자 모양을 검증한다", async () => {
    const store = createTestStore();
    const project = await replayProject(store);
    const app = createRecordingApp(store);

    const response = await post(app, chunkBody({ projectId: project.projectId }), "not a session");

    expect(response.statusCode).toBe(400);
  });

  // 보존 스윕이 started_at 을 보던 시절의 두 가지 결과다. 하나는 이 파일이
  // 달력에 묶여 있던 것이고(아래 "시계가 흘러도"), 다른 하나는 더 나쁜 쪽 -
  // 창 밖 날짜를 적어 보낸 청크가 202 를 받고 같은 요청 안에서 지워져
  // 아무에게도 보고되지 않는 유실이 된다.
  it("보존 창 밖의 startedAt 을 적어 보내도 202 가 거짓이 되지 않는다", async () => {
    const store = createTestStore();
    const project = await replayProject(store);
    const app = createRecordingApp(store);

    const response = await post(
      app,
      chunkBody({ projectId: project.projectId, startedAt: "2026-01-01T00:00:00.000Z" }),
    );

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 2 });
    // 202 는 "받아서 보관했다" 는 뜻이어야 한다.
    expect(await store.listSessionRecordingChunks(project.projectId, "sess_abc123")).toHaveLength(1);
  });

  // 예전 fixture 가 2026-09-22 에 터지게 되어 있던 바로 그 모양을, 날짜를
  // 기다리는 대신 시계를 밀어서 지금 검사한다.
  it("시계가 흘러도 방금 받은 청크를 지우지 않는다", async () => {
    const store = createTestStore();
    const project = await replayProject(store);
    // fixture 의 startedAt 보다 100일 넘게 뒤 - 7일 창의 한참 바깥이다.
    const app = createRecordingApp(store, new Date("2027-01-01T00:00:00.000Z"));

    const response = await post(app, chunkBody({ projectId: project.projectId }));

    expect(response.statusCode).toBe(202);
    expect(await store.listSessionRecordingChunks(project.projectId, "sess_abc123")).toHaveLength(1);
  });

  it("같은 seq 재전송은 한 번만 저장된다", async () => {
    const store = createTestStore();
    const project = await replayProject(store);
    const app = createRecordingApp(store);
    const body = chunkBody({ projectId: project.projectId });

    await post(app, body);
    const second = await post(app, body);

    expect(second.statusCode).toBe(202);
    expect(await store.listSessionRecordingChunks(project.projectId, "sess_abc123")).toHaveLength(1);
  });
});
