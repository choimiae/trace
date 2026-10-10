import { describe, expect, it } from "vitest";
import { collapseScreens, compareText, rankRoutes, sameRoute, toRoute } from "./route.js";

describe("collapseScreens", () => {
  it("연달아 같은 화면을 하나로 합친다", () => {
    expect(collapseScreens(["/a", "/a", "/b", "/b", "/b"])).toEqual(["/a", "/b"]);
  });

  it("떨어져서 다시 나온 화면은 합치지 않는다", () => {
    expect(collapseScreens(["/a", "/b", "/a"])).toEqual(["/a", "/b", "/a"]);
  });

  it("빈 배열은 빈 배열이다", () => {
    expect(collapseScreens([])).toEqual([]);
  });
});

describe("toRoute", () => {
  it("시작 화면이 없으면 처음부터 쓰고, 5개 안에서 끝나면 이탈이다", () => {
    expect(toRoute(["/", "/quote", "/quote/new"])).toEqual({ steps: ["/", "/quote", "/quote/new"], exited: true });
  });

  it("시작 화면이 처음 나온 지점부터 자른다", () => {
    expect(toRoute(["/", "/quote", "/pay", "/quote", "/x"], "/quote")).toEqual({
      steps: ["/quote", "/pay", "/quote", "/x"],
      exited: true,
    });
  });

  it("시작 화면이 없는 세션은 빠진다", () => {
    expect(toRoute(["/", "/quote"], "/pay")).toBeUndefined();
  });

  it("화면이 없는 세션은 빠진다", () => {
    expect(toRoute([])).toBeUndefined();
  });

  it("5개를 넘으면 앞 5개만 쓰고 이탈이 아니다", () => {
    expect(toRoute(["/1", "/2", "/3", "/4", "/5", "/6"])).toEqual({
      steps: ["/1", "/2", "/3", "/4", "/5"],
      exited: false,
    });
  });

  it("정확히 5개면 이탈이다", () => {
    expect(toRoute(["/1", "/2", "/3", "/4", "/5"])?.exited).toBe(true);
  });

  it("자른 뒤 5개를 센다", () => {
    expect(toRoute(["/0", "/1", "/2", "/3", "/4", "/5"], "/1")).toEqual({
      steps: ["/1", "/2", "/3", "/4", "/5"],
      exited: true,
    });
  });
});

describe("sameRoute", () => {
  it("화면 순서와 이탈 여부가 모두 같아야 같다", () => {
    expect(sameRoute({ steps: ["/a", "/b"], exited: true }, { steps: ["/a", "/b"], exited: true })).toBe(true);
    expect(sameRoute({ steps: ["/a", "/b"], exited: true }, { steps: ["/a", "/b"], exited: false })).toBe(false);
    expect(sameRoute({ steps: ["/a", "/b"], exited: true }, { steps: ["/a"], exited: true })).toBe(false);
    expect(sameRoute({ steps: ["/a", "/b"], exited: true }, { steps: ["/b", "/a"], exited: true })).toBe(false);
  });
});

describe("rankRoutes", () => {
  it("같은 경로끼리 묶어 많은 순으로 세고 비율을 낸다", () => {
    const sessions = [["/", "/a"], ["/", "/a"], ["/", "/b"], ["/a"]];

    expect(rankRoutes(sessions, undefined, 20)).toEqual({
      totalSessions: 4,
      paths: [
        { steps: ["/", "/a"], exited: true, sessions: 2, ratio: 0.5 },
        // 세션 수가 같으면 경로를 이은 문자열 순이다. "/" 뒤의 구분자가 "a" 보다 앞선다.
        { steps: ["/", "/b"], exited: true, sessions: 1, ratio: 0.25 },
        { steps: ["/a"], exited: true, sessions: 1, ratio: 0.25 },
      ],
    });
  });

  it("화면 순서가 같아도 이탈 여부가 다르면 따로 센다", () => {
    const sessions = [
      ["/1", "/2", "/3", "/4", "/5"],
      ["/1", "/2", "/3", "/4", "/5", "/6"],
    ];

    const { paths } = rankRoutes(sessions, undefined, 20);

    // 같은 순서면 이탈하지 않은 쪽이 앞이다.
    expect(paths.map((path) => [path.exited, path.sessions])).toEqual([
      [false, 1],
      [true, 1],
    ]);
  });

  it("시작 화면으로 자르고, 그 화면이 없는 세션은 분모에서도 뺀다", () => {
    const sessions = [["/", "/a", "/b"], ["/a"], ["/", "/c"]];

    expect(rankRoutes(sessions, "/a", 20)).toEqual({
      totalSessions: 2,
      paths: [
        // "/a" 가 "/a"+구분자+"/b" 의 앞부분이라 먼저 온다.
        { steps: ["/a"], exited: true, sessions: 1, ratio: 0.5 },
        { steps: ["/a", "/b"], exited: true, sessions: 1, ratio: 0.5 },
      ],
    });
  });

  it("상위 limit 개만 남기되 비율의 분모는 전체 대상 세션이다", () => {
    const sessions = [["/a"], ["/a"], ["/b"], ["/c"]];

    expect(rankRoutes(sessions, undefined, 1)).toEqual({
      totalSessions: 4,
      paths: [{ steps: ["/a"], exited: true, sessions: 2, ratio: 0.5 }],
    });
  });

  it("대상 세션이 없으면 빈 순위이고 비율을 나누지 않는다", () => {
    expect(rankRoutes([["/a"]], "/zzz", 20)).toEqual({ totalSessions: 0, paths: [] });
  });
});

describe("compareText", () => {
  it("코드 단위 순으로 비교한다", () => {
    expect(["나", "가", "/b", "/a"].sort(compareText)).toEqual(["/a", "/b", "가", "나"]);
  });
});
