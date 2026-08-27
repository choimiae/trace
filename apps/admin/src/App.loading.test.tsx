import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

expect.extend(matchers);
afterEach(cleanup);

vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
  getAuthMe: vi.fn(() => new Promise(() => undefined)),
  createProject: vi.fn(),
  getDashboardData: vi.fn(),
  logout: vi.fn(),
  getSessionTimeline: vi.fn(),
}));

describe("App loading state", () => {
  it("로딩 상태를 상태 페이지 제목으로 노출한다", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "불러오는 중" })).toBeInTheDocument();
  });
});
