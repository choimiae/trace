import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./Field.js";

expect.extend(matchers);

describe("Field", () => {
  it("힌트가 있어도 라벨 텍스트만으로 조회된다", () => {
    render(
      <Field
        id="allowed-domains"
        label="허용 도메인"
        value=""
        onChange={vi.fn()}
        hint="여러 개면 쉼표로 구분합니다."
      />,
    );
    expect(screen.getByLabelText("허용 도메인")).toBeInTheDocument();
  });

  it("힌트를 aria-describedby 로 잇는다", () => {
    render(
      <Field
        id="allowed-domains"
        label="허용 도메인"
        value=""
        onChange={vi.fn()}
        hint="여러 개면 쉼표로 구분합니다."
      />,
    );
    const input = screen.getByLabelText("허용 도메인");
    expect(input).toHaveAttribute("aria-describedby", "allowed-domains-hint");
    expect(document.getElementById("allowed-domains-hint")).toHaveTextContent(
      "여러 개면 쉼표로 구분합니다.",
    );
  });
});
