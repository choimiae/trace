import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { createApp } from "../app.js";
import type { SqliteStore } from "../store/sqlite-store.js";
import { createTestStore } from "../store/test-store.js";
import type { TraceStore } from "../store/types.js";
import {
  SESSION_RECORDING_SWEEP_INTERVAL_MS,
  startSessionRecordingRetentionSweep,
} from "./sweeper.js";

const NOW = new Date("2026-09-14T00:00:00.000Z");

async function storeWithOldChunk(): Promise<SqliteStore> {
  const store = createTestStore();
  await store.saveSessionRecordingChunk({
    projectId: "proj_1",
    sessionId: "sess_1",
    seq: 0,
    startedAt: "2026-09-01T00:00:00.000Z",
    receivedAt: "2026-09-01T00:00:00.000Z",
    eventCount: 1,
    bytes: new Uint8Array([1]),
  });
  return store;
}

function remaining(store: SqliteStore) {
  return store.listSessionRecordingChunks("proj_1", "sess_1");
}

describe("startSessionRecordingRetentionSweep", () => {
  beforeEach(() => {
    // setInterval 만 가짜로 둔다. Fastify 내부의 다른 시간 처리를 건드리지 않는다.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 지금까지 보존은 부팅과 업로드에서만 돌았다. 그런데 기록은 운영자가 리플레이를
  // **끄는 순간** 끊긴다 - 지워지기를 기대하는 바로 그 시점이다. 그러면 오래
  // 사는 프로세스가 7일 지난 기록을 무기한 쥐고 있는다.
  it("업로드가 더 오지 않아도 만료된 기록을 지운다", async () => {
    const store = await storeWithOldChunk();

    const stop = startSessionRecordingRetentionSweep({
      store,
      config: { sessionRecordingRetentionDays: 7 },
      now: () => NOW,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    stop();

    expect(await remaining(store)).toHaveLength(0);
  });

  it("멈추면 더 돌지 않는다", async () => {
    const store = await storeWithOldChunk();

    const stop = startSessionRecordingRetentionSweep({
      store,
      config: { sessionRecordingRetentionDays: 7 },
      now: () => NOW,
      intervalMs: 1000,
    });
    stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await remaining(store)).toHaveLength(1);
  });

  // setInterval 콜백에서 던지거나 거절된 채 둔 Promise 는 Node 에서 곧바로
  // 프로세스 종료다. 디스크가 잠깐 흔들린 것 때문에 수집 서버 전체가 죽으면
  // 안 된다. 그래서 "던지지 않는다" 를 프로세스 이벤트로 직접 본다 - 단언을
  // cutoffs 개수로만 두면 거절이 그대로 새어도 초록이 된다.
  it("스윕이 실패해도 프로세스로 새지 않고 다음 주기에 다시 돈다", async () => {
    const cutoffs: string[] = [];
    const store = {
      async deleteSessionRecordingsBefore(cutoff: string): Promise<number> {
        cutoffs.push(cutoff);
        throw new Error("디스크가 사라졌다");
      },
    } as unknown as TraceStore;

    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const stop = startSessionRecordingRetentionSweep({
      store,
      config: { sessionRecordingRetentionDays: 7 },
      now: () => NOW,
      intervalMs: 1000,
    });
    try {
      await vi.advanceTimersByTimeAsync(2000);
      // unhandledRejection 은 마이크로태스크 큐가 빈 다음에야 올라온다.
      // setTimeout 은 가짜로 두지 않았으므로 진짜로 한 바퀴 기다린다.
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      stop();
      process.off("unhandledRejection", onUnhandled);
    }

    expect(escaped).toEqual([]);
    // 한 번 실패했다고 멈추면 안 된다 - 다음 주기에 다시 돈다.
    expect(cutoffs).toHaveLength(2);
  });
});

describe("createApp 의 주기 스윕", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("앱이 켜져 있으면 업로드 없이도 만료시킨다", async () => {
    const store = await storeWithOldChunk();
    const app = createApp({ store, now: () => NOW });

    await vi.advanceTimersByTimeAsync(SESSION_RECORDING_SWEEP_INTERVAL_MS);

    expect(await remaining(store)).toHaveLength(0);
    await app.close();
  });

  // API 테스트는 app 을 만들고 닫는다. 닫힌 앱의 타이머가 남아 있으면 테스트
  // 실행에 타이머가 새고, 닫힌 스토어를 두드리게 된다.
  it("앱을 닫으면 타이머를 걷는다", async () => {
    const store = await storeWithOldChunk();
    const app = createApp({ store, now: () => NOW });

    await app.close();
    await vi.advanceTimersByTimeAsync(SESSION_RECORDING_SWEEP_INTERVAL_MS * 3);

    expect(await remaining(store)).toHaveLength(1);
  });
});
