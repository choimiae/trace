import { describe, expect, it } from "vitest";
import { parsePathStart, parsePeriod, parseSessionFilter } from "./aggregation-query.js";

const NOW = new Date("2026-10-10T05:00:00.000Z");

describe("parsePeriod", () => {
  it("days 가 없으면 7일 전이 기준 시각이다", () => {
    expect(parsePeriod({}, NOW)).toEqual({ since: "2026-10-03T05:00:00.000Z" });
  });

  it.each([
    ["1", "2026-10-09T05:00:00.000Z"],
    ["7", "2026-10-03T05:00:00.000Z"],
    ["30", "2026-09-10T05:00:00.000Z"],
  ])("days=%s 의 기준 시각은 %s 다", (days, since) => {
    expect(parsePeriod({ days }, NOW)).toEqual({ since });
  });

  it.each([["2"], ["abc"], [""], [["7", "30"]]])("days=%j 는 잘못된 기간이다", (days) => {
    expect(parsePeriod({ days }, NOW)).toBeUndefined();
  });

  it("다른 쿼리 키는 상관하지 않는다", () => {
    expect(parsePeriod({ days: "1", screen: "/a" }, NOW)).toEqual({ since: "2026-10-09T05:00:00.000Z" });
  });

  it("쿼리가 비어 있어도 기본값을 쓴다", () => {
    expect(parsePeriod(undefined, NOW)).toEqual({ since: "2026-10-03T05:00:00.000Z" });
  });
});

describe("parsePathStart", () => {
  it("start 가 없거나 비었으면 전체다", () => {
    expect(parsePathStart({})).toEqual({});
    expect(parsePathStart({ start: "" })).toEqual({});
  });

  it("start 를 그대로 쓴다", () => {
    expect(parsePathStart({ start: "/quote/:id" })).toEqual({ start: "/quote/:id" });
  });

  it("start 가 둘 이상이면 잘못된 쿼리다", () => {
    expect(parsePathStart({ start: ["/a", "/b"] })).toBeUndefined();
  });
});

describe("parseSessionFilter", () => {
  it("필터 키가 없으면 필터 없음이다", () => {
    expect(parseSessionFilter({ days: "7" })).toEqual({ kind: "none" });
  });

  it("화면 필터", () => {
    expect(parseSessionFilter({ screen: "/quote" })).toEqual({ kind: "screen", urlPath: "/quote" });
  });

  it("기능 필터", () => {
    expect(parseSessionFilter({ featurePath: "/quote", featureKey: "a1b2" })).toEqual({
      kind: "feature",
      urlPath: "/quote",
      elementKey: "a1b2",
    });
  });

  it("경로 필터: step 하나는 문자열로, 여럿은 배열로 온다", () => {
    expect(parseSessionFilter({ step: "/a" })).toEqual({ kind: "path", steps: ["/a"], exited: false });
    expect(parseSessionFilter({ step: ["/a", "/b"], exited: "true", start: "/a" })).toEqual({
      kind: "path",
      start: "/a",
      steps: ["/a", "/b"],
      exited: true,
    });
    expect(parseSessionFilter({ step: "/a", exited: "false" })).toEqual({ kind: "path", steps: ["/a"], exited: false });
  });

  it.each([
    ["화면과 경로를 섞음", { screen: "/a", step: "/a" }],
    ["화면과 기능을 섞음", { screen: "/a", featurePath: "/a", featureKey: "k" }],
    ["featurePath 만", { featurePath: "/a" }],
    ["featureKey 만", { featureKey: "k" }],
    ["start 만", { start: "/a" }],
    ["exited 만", { exited: "true" }],
    ["빈 화면", { screen: "" }],
    ["화면 둘", { screen: ["/a", "/b"] }],
    ["빈 step", { step: ["/a", ""] }],
    ["step 여섯", { step: ["/1", "/2", "/3", "/4", "/5", "/6"] }],
    ["exited 가 true·false 가 아님", { step: "/a", exited: "yes" }],
    ["빈 start", { step: "/a", start: "" }],
    ["start 둘", { step: "/a", start: ["/a", "/b"] }],
  ])("%s 이면 잘못된 필터다", (_label, query) => {
    expect(parseSessionFilter(query)).toBeUndefined();
  });
});
