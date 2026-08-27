import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip, issueStatusToChip } from "./Chip.js";

expect.extend(matchers);

describe("Chip", () => {
  it("라벨을 글자로 노출한다 — 색만으로 뜻을 전하지 않는다", () => {
    render(<Chip status="crit" label="심각" />);
    expect(screen.getByText("심각")).toBeInTheDocument();
  });

  it("이슈 상태를 칩 속성으로 옮긴다", () => {
    // 유니온은 packages/shared/src/events.ts 의 issueStatusSchema 를 따른다:
    // ["new", "reviewing", "ignored", "resolved"]
    expect(issueStatusToChip("new")).toEqual({ status: "crit", label: "신규" });
    expect(issueStatusToChip("reviewing")).toEqual({ status: "warn", label: "검토 중" });
    expect(issueStatusToChip("resolved")).toEqual({ status: "good", label: "해결됨" });
    expect(issueStatusToChip("ignored")).toEqual({ status: "good", label: "무시함" });
  });
});
