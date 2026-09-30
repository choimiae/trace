import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Chip } from "./Chip.js";

expect.extend(matchers);
afterEach(cleanup);

describe("Chip", () => {
  it("라벨을 글자로 노출한다 — 색만으로 뜻을 전하지 않는다", () => {
    render(<Chip status="crit" label="심각" />);
    expect(screen.getByText("심각")).toBeInTheDocument();
  });
});
