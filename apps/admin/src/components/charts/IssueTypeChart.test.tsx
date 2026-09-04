import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IssueTypeChart } from "./IssueTypeChart.js";

expect.extend(matchers);
afterEach(cleanup);

describe("IssueTypeChart", () => {
  // 원시 enum 은 dead_click_cluster 처럼 길어서 좁은 폭에서 라벨이 통째로 빠진다.
  // 축 라벨이 화면의 나머지와 같은 이름을 쓰는지 못박는다.
  it("X축에 원시 enum 대신 사람이 읽는 이름을 적는다", () => {
    render(
      <IssueTypeChart
        data={[
          { issueType: "rage_click", count: 4 },
          { issueType: "error_friction", count: 1 },
          { issueType: "dead_click_cluster", count: 2 },
        ]}
      />,
    );

    expect(screen.getByText("분노 클릭")).toBeInTheDocument();
    expect(screen.getByText("오류 마찰")).toBeInTheDocument();
    expect(screen.getByText("반응 없는 클릭")).toBeInTheDocument();
    expect(screen.queryByText("dead_click_cluster")).not.toBeInTheDocument();
  });

  it("데이터가 없으면 빈 상태를 알린다", () => {
    render(<IssueTypeChart data={[]} />);

    expect(screen.getByText("아직 표시할 이슈가 없습니다.")).toBeInTheDocument();
  });
});
