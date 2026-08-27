import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateProjectPage } from "./CreateProjectPage.js";

expect.extend(matchers);
afterEach(cleanup);

describe("CreateProjectPage", () => {
  it("생성 오류를 허용 도메인 입력과 접근성으로 연결한다", () => {
    render(<CreateProjectPage onCreate={vi.fn()} error="invalid_allowed_domains" />);
    const input = screen.getByLabelText("허용 도메인");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "allowed-domains-hint allowed-domains-error",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("allowed-domains-error")).toHaveTextContent("invalid_allowed_domains");
  });
});
