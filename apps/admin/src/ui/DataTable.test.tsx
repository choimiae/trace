import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable.js";

expect.extend(matchers);

type Row = { id: string; name: string };

const columns = [
  { key: "name", header: "이름", render: (row: Row) => row.name },
];

describe("DataTable", () => {
  it("행을 렌더한다", () => {
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "a", name: "결제 버튼 반복 클릭" }]}
        rowKey={(row) => row.id}
        empty="아직 감지된 문제가 없습니다."
      />,
    );
    expect(screen.getByText("결제 버튼 반복 클릭")).toBeInTheDocument();
  });

  it("행이 없으면 빈 문구를 보여준다", () => {
    render(
      <DataTable columns={columns} rows={[]} rowKey={(row) => row.id} empty="아직 감지된 문제가 없습니다." />,
    );
    expect(screen.getByText("아직 감지된 문제가 없습니다.")).toBeInTheDocument();
  });

  it("headerLabel 이 있으면 헤더 글자 대신 접근 가능한 이름으로 쓴다", () => {
    render(
      <DataTable
        columns={[{ key: "action", header: "", headerLabel: "작업", render: () => null }]}
        rows={[{ id: "a", name: "x" }]}
        rowKey={(row) => row.id}
        empty="비었습니다."
      />,
    );
    expect(screen.getByRole("columnheader", { name: "작업" })).toBeInTheDocument();
  });
});
