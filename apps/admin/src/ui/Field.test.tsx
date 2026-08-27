import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field } from "./Field.js";

expect.extend(matchers);
afterEach(cleanup);

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

  it("오류를 aria-describedby 로 잇고 invalid 상태를 노출한다", () => {
    render(
      <Field
        id="allowed-domains"
        label="허용 도메인"
        value=""
        onChange={vi.fn()}
        hint="여러 개면 쉼표로 구분합니다."
        error="invalid_allowed_domains"
      />,
    );
    const input = screen.getByLabelText("허용 도메인");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "allowed-domains-hint allowed-domains-error",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("allowed-domains-error")).toHaveTextContent("invalid_allowed_domains");
  });
});
