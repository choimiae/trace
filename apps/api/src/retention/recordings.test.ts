import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory-store.js";
import { runSessionRecordingRetention } from "./recordings.js";

async function storeWithChunks() {
  const store = new MemoryStore();
  const base = { projectId: "proj_1", sessionId: "sess_1", eventCount: 1, bytes: new Uint8Array([1]) };
  await store.saveSessionRecordingChunk({ ...base, seq: 0, startedAt: "2026-09-01T00:00:00.000Z" });
  await store.saveSessionRecordingChunk({ ...base, seq: 1, startedAt: "2026-09-13T00:00:00.000Z" });
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
