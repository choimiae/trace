import type { TraceEvent } from "@trace/shared";
import { afterEach, describe, expect, it } from "vitest";
import { elementKey } from "./element-key.js";
import { SqliteStore } from "./sqlite-store.js";

const SINCE = "2026-10-01T00:00:00.000Z";
const ALL_TIME = "1970-01-01T00:00:00.000Z";

/** 기간 안의 시각. T(0) 은 2026-10-02 09:00. */
const T = (minute: number) => new Date(Date.parse("2026-10-02T09:00:00.000Z") + minute * 60_000).toISOString();

type Draft = Omit<TraceEvent, "eventId" | "sessionId" | "pageId" | "metadata">;

const view = (urlPath: string, timestamp: string, titleMasked?: string): Draft => ({
  type: "page_view",
  urlPath,
  timestamp,
  ...(titleMasked === undefined ? {} : { titleMasked }),
});
const leave = (urlPath: string, timestamp: string): Draft => ({ type: "page_leave", urlPath, timestamp });
const click = (urlPath: string, timestamp: string, text?: string, role = "button"): Draft => ({
  type: "click",
  urlPath,
  timestamp,
  elementSelectorHash: `sel_${text ?? role}`,
  elementRole: role,
  ...(text === undefined ? {} : { elementTextMaskedOrLimited: text }),
});
/** click() 이 만든 요소의 elementKey. 저장소가 저장할 때 계산하는 값과 같다. */
const keyOf = (text?: string, role = "button") =>
  elementKey({
    elementSelectorHash: `sel_${text ?? role}`,
    ...(text === undefined ? {} : { elementTextMaskedOrLimited: text }),
  } as TraceEvent)!;

const opened: SqliteStore[] = [];
afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

async function setup() {
  const store = new SqliteStore(":memory:");
  opened.push(store);
  const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
  let counter = 0;
  const save = async (sessionId: string, anonymousUserId: string, drafts: Draft[], projectId = project.projectId) => {
    await store.saveBatch({
      projectId,
      anonymousUserId,
      sessionId,
      sentAt: drafts[0]!.timestamp,
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/",
      events: drafts.map((draft) => ({ ...draft, metadata: {}, eventId: `evt_${++counter}`, sessionId, pageId: "page_1" })),
    });
  };
  return { store, projectId: project.projectId, save };
}

describe("getFeatureUsage", () => {
  it("기간 안에 시작한 세션만 넣고, 넣은 세션은 기준 시각 뒤 이벤트까지 센다", async () => {
    const { store, projectId, save } = await setup();
    // 기준 시각 10분 전에 시작해 기준 시각 뒤까지 이어진 세션은 통째로 빠진다.
    await save("sess_before", "anon_1", [view("/a", "2026-09-30T23:50:00.000Z"), view("/b", "2026-10-01T00:10:00.000Z")]);
    // 기준 시각과 같은 밀리초에 시작한 세션은 넣는다.
    await save("sess_edge", "anon_2", [view("/a", SINCE)]);
    await save("sess_in", "anon_3", [view("/a", "2026-10-01T00:05:00.000Z"), view("/c", "2026-10-02T03:00:00.000Z")]);

    const usage = await store.getFeatureUsage(projectId, SINCE);

    expect(usage.summary.sessions).toBe(2);
    expect(usage.screens.map((screen) => [screen.urlPath, screen.views])).toEqual([
      ["/a", 2],
      ["/c", 1],
    ]);
  });

  it("요약 지표: 방문자, 세션, 평균 세션 길이", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0)), view("/b", T(1))]); // 60초
    await save("s2", "anon_1", [view("/a", T(10)), view("/a", T(10.5))]); // 30초
    await save("s3", "anon_2", [view("/a", T(20))]); // 0초

    const { summary } = await store.getFeatureUsage(projectId, SINCE);

    expect(summary).toEqual({ visitors: 2, sessions: 3, averageSessionMs: 30_000 });
  });

  it("화면 행: 방문·방문자·평균 체류·이탈률", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [
      view("/a", "2026-10-02T09:00:00.000Z"),
      leave("/a", "2026-10-02T09:00:10.000Z"),
      // 라우팅 이동이면 page_leave 와 다음 page_view 가 같은 밀리초를 찍는다.
      view("/b", "2026-10-02T09:00:10.000Z"),
      leave("/b", "2026-10-02T09:00:40.000Z"),
    ]);
    await save("s2", "anon_2", [view("/a", "2026-10-02T10:00:00.000Z")]);

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(screens).toEqual([
      // 체류는 짝이 있는 s1 의 방문만, 이탈은 s2 의 마지막 화면 하나.
      { urlPath: "/a", name: "/a", views: 2, visitors: 2, averageDwellMs: 10_000, exitRate: 0.5, features: [] },
      { urlPath: "/b", name: "/b", views: 1, visitors: 1, averageDwellMs: 30_000, exitRate: 1, features: [] },
    ]);
  });

  it("체류를 잴 짝이 없으면 averageDwellMs 가 없다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0)), view("/b", T(1))]);

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(screens.find((screen) => screen.urlPath === "/a")).not.toHaveProperty("averageDwellMs");
  });

  it("기능 행: 클릭 수와 방문자, 글자가 없으면 역할을 이름으로 쓰고, 선택자 해시가 없는 클릭은 뺀다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [
      view("/a", T(0)),
      click("/a", T(1), "저장"),
      click("/a", T(2), "저장"),
      click("/a", T(3), "취소"),
      click("/a", T(4), undefined, "link"),
      { type: "click", urlPath: "/a", timestamp: T(5) },
    ]);
    await save("s2", "anon_2", [view("/a", T(10)), click("/a", T(11), "저장")]);

    const [screen] = (await store.getFeatureUsage(projectId, SINCE)).screens;

    expect(screen!.features).toHaveLength(3);
    expect(screen!.features[0]).toEqual({ elementKey: keyOf("저장"), name: "저장", role: "button", clicks: 3, visitors: 2 });
    expect(screen!.features).toContainEqual({ elementKey: keyOf("취소"), name: "취소", role: "button", clicks: 1, visitors: 1 });
    expect(screen!.features).toContainEqual({
      elementKey: keyOf(undefined, "link"),
      name: "link",
      role: "link",
      clicks: 1,
      visitors: 1,
    });
  });

  it("클릭만 있고 방문이 없는 경로도 화면 행으로 넣는다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0)), click("/modal", T(1), "확인")]);

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(screens[1]).toEqual({
      urlPath: "/modal",
      name: "/modal",
      views: 0,
      visitors: 0,
      exitRate: 0,
      features: [{ elementKey: keyOf("확인"), name: "확인", role: "button", clicks: 1, visitors: 1 }],
    });
  });

  it("화면 이름: 가장 많이 나온 제목, 같으면 문자열 순으로 앞선 제목, 없으면 경로", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0), "견적"), view("/b", T(1), "나"), view("/c", T(2))]);
    await save("s2", "anon_2", [view("/a", T(10), "견적"), view("/b", T(11), "가")]);
    await save("s3", "anon_3", [view("/a", T(20), "견적 목록")]);

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(Object.fromEntries(screens.map((screen) => [screen.urlPath, screen.name]))).toEqual({
      "/a": "견적",
      "/b": "가",
      "/c": "/c",
    });
  });

  it("다른 프로젝트의 이벤트는 섞지 않는다", async () => {
    const { store, projectId, save } = await setup();
    const other = await store.createProject({ name: "Other", allowedDomains: ["https://other.example.com"] });
    await save("s1", "anon_1", [view("/a", T(0)), click("/a", T(1), "저장")]);
    await save("s_other", "anon_9", [view("/a", T(0)), view("/z", T(1)), click("/a", T(2), "저장")], other.projectId);

    const usage = await store.getFeatureUsage(projectId, SINCE);

    expect(usage.summary).toEqual({ visitors: 1, sessions: 1, averageSessionMs: 60_000 });
    expect(usage.screens.map((screen) => screen.urlPath)).toEqual(["/a"]);
    expect(usage.screens[0]!.features[0]!.clicks).toBe(1);
  });

  it("세션이 없으면 0 과 빈 배열이다", async () => {
    const { store, projectId } = await setup();

    expect(await store.getFeatureUsage(projectId, SINCE)).toEqual({
      summary: { visitors: 0, sessions: 0, averageSessionMs: 0 },
      screens: [],
    });
  });

  it("화면은 100개, 화면당 기능은 30개까지 돌려준다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [view("/a", T(0)), ...Array.from({ length: 31 }, (_, i) => click("/a", T(1 + i), `버튼${i}`))]);
    await save("s2", "anon_2", Array.from({ length: 101 }, (_, i) => view(`/p${i}`, T(100 + i))));

    const { screens } = await store.getFeatureUsage(projectId, SINCE);

    expect(screens).toHaveLength(100);
    expect(screens.find((screen) => screen.urlPath === "/a")!.features).toHaveLength(30);
  });

  it("방문·체류·이탈이 옛 페이지 통계 계산과 같다", async () => {
    const { store, projectId, save } = await setup();
    await save("s1", "anon_1", [
      view("/home", T(0)),
      leave("/home", T(1)),
      view("/report", T(1)),
      leave("/report", T(3)),
      view("/home", T(4)),
    ]);
    await save("s2", "anon_2", [view("/home", T(10)), view("/report", T(11)), leave("/report", T(12))]);
    await save("s3", "anon_1", [view("/report", T(20)), leave("/report", T(20)), leave("/report", T(21))]);

    const pick = ({
      urlPath,
      views,
      averageDwellMs,
      exitRate,
    }: {
      urlPath: string;
      views: number;
      averageDwellMs?: number | undefined;
      exitRate: number;
    }) => ({
      urlPath,
      views,
      averageDwellMs,
      exitRate,
    });
    const byPath = (a: { urlPath: string }, b: { urlPath: string }) => a.urlPath.localeCompare(b.urlPath);
    const before = (await store.listPageStats(projectId, 50)).map(pick).sort(byPath);
    const after = (await store.getFeatureUsage(projectId, ALL_TIME)).screens.map(pick).sort(byPath);

    expect(after).toEqual(before);
  });
});
