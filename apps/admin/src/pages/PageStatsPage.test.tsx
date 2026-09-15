import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageStatsPage } from "./PageStatsPage.js";

expect.extend(matchers);
afterEach(cleanup);

const pages = [
  {
    urlPath: "/home",
    views: 120,
    averageDwellMs: 45_000,
    // 0.25 가 아니라 0.42 로 둔다. 이탈률이 25% 면 스크롤 도달 25% 구간의
    // 열 머리글("25%")과 텍스트가 겹쳐 getByText 가 모호해진다 — 우연히
    // 같은 숫자가 되는 것을 피해 각 열이 서로 구분되게 한다.
    exitRate: 0.42,
    // 일부러 depth 순서를 흩뜨린다. 화면 구현이 depth 로 찾지 않고 배열
    // 순서(index)를 그대로 열에 대응시키면, 아래 값이 같아 보여도 열이
    // 뒤바뀐 채로 통과해버릴 수 있다 — 셀 순서를 직접 확인하는 테스트가
    // 그 결함을 잡는다.
    scrollReach: [
      { depth: 100, ratio: 0.1 },
      { depth: 75, ratio: 0.3 },
      { depth: 25, ratio: 0.9 },
      { depth: 50, ratio: 0.6 },
    ],
  },
];

describe("PageStatsPage", () => {
  it("페이지별 방문·체류·이탈을 보여준다", () => {
    render(<PageStatsPage pages={pages} onBack={() => undefined} />);

    expect(screen.getByText("/home")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("45초")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  // page_leave 가 한 번도 안 나간 페이지가 있다. 0초로 보이면 "머물지 않았다"
  // 로 읽혀 사실과 다르다. 서버는 이 경우 키 자체를 뺀다(JSON 에는 undefined
  // 값이 없다) - exactOptionalPropertyTypes 아래에서 실제 응답 모양과 같게
  // 키를 지워서 구성한다.
  it("체류를 모르면 값 대신 줄표를 보여준다", () => {
    const { averageDwellMs: _unused, ...withoutDwell } = pages[0]!;

    render(<PageStatsPage pages={[withoutDwell]} onBack={() => undefined} />);

    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("스크롤 도달을 네 구간으로 보여준다", () => {
    render(<PageStatsPage pages={pages} onBack={() => undefined} />);

    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  // 위 세 테스트는 값이 "어딘가에 있는지"만 본다. 방문 수를 이탈률 열에
  // 놓거나, 스크롤 도달 열 순서를 뒤바꿔도 같은 숫자들이 화면 어딘가에는
  // 있으니 통과해버린다. 행의 셀을 순서대로 읽어 각 값이 정확한 열에
  // 있는지 확인한다.
  it("각 값을 정확한 열에 보여준다", () => {
    render(<PageStatsPage pages={pages} onBack={() => undefined} />);

    const dataRow = screen.getAllByRole("row")[1];
    if (dataRow === undefined) throw new Error("data row not rendered");
    const cellTexts = within(dataRow)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);

    expect(cellTexts).toEqual(["/home", "120", "45초", "42%", "90%", "60%", "30%", "10%"]);
  });

  it("비어 있으면 왜 비었는지 알려준다", () => {
    render(<PageStatsPage pages={[]} onBack={() => undefined} />);

    expect(screen.getByText(/아직 집계할 페이지 방문이 없습니다/)).toBeInTheDocument();
  });
});
