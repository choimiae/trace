import { describe, expect, it } from "vitest";
import { createTestStore } from "../store/test-store.js";
import { runSessionRecordingRetention } from "./recordings.js";

async function storeWithChunks() {
  const store = createTestStore();
  // startedAt 은 브라우저가 적어 보낸 값이라 보존 판정에 쓰지 않는다. 두 청크
  // 모두 같은 startedAt 을 두어, 판정이 receivedAt 으로만 갈린다는 것을 못박는다.
  const base = {
    projectId: "proj_1",
    sessionId: "sess_1",
    startedAt: "2026-09-14T00:00:00.000Z",
    eventCount: 1,
    bytes: new Uint8Array([1]),
  };
  await store.saveSessionRecordingChunk({ ...base, seq: 0, receivedAt: "2026-09-01T00:00:00.000Z" });
  await store.saveSessionRecordingChunk({ ...base, seq: 1, receivedAt: "2026-09-13T00:00:00.000Z" });
  return store;
}

describe("runSessionRecordingRetention", () => {
  it("기한을 넘긴 청크만 지운다", async () => {
    const store = await storeWithChunks();

    const deleted = await runSessionRecordingRetention(
      store,
      { sessionRecordingRetentionDays: 7 },
      new Date("2026-09-14T00:00:00.000Z"),
    );

    expect(deleted).toBe(1);
    expect(await store.listSessionRecordingChunks("proj_1", "sess_1")).toHaveLength(1);
  });
});
