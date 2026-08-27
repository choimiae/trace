import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button.js";

expect.extend(matchers);

describe("Button", () => {
  it("children 을 접근 가능한 이름으로 노출한다", () => {
    render(<Button>설치 안내</Button>);
    expect(screen.getByRole("button", { name: "설치 안내" })).toBeInTheDocument();
  });

  it("aria-label 이 있으면 그것이 이름이 된다", () => {
    render(<Button variant="icon" aria-label="닫기">×</Button>);
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
  });

  it("disabled 를 전달한다", () => {
    render(<Button disabled>프로젝트 만들기</Button>);
    expect(screen.getByRole("button", { name: "프로젝트 만들기" })).toBeDisabled();
  });
});
