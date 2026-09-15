import { describe, expect, it } from "vitest";
import { computeFit } from "./fit.js";

describe("computeFit", () => {
  it("녹화 너비가 마운트보다 넓으면 마운트에 맞춰 줄인다", () => {
    expect(computeFit(728, 1456, 828)).toEqual({ scale: 0.5, height: 414 });
  });

  it("녹화 너비가 마운트보다 좁아도 키우지 않는다 - scale 은 1 을 넘지 않는다", () => {
    expect(computeFit(2000, 1456, 828)).toEqual({ scale: 1, height: 828 });
  });

  it("녹화 너비와 마운트 너비가 같으면 그대로 둔다", () => {
    expect(computeFit(1456, 1456, 828)).toEqual({ scale: 1, height: 828 });
  });

  it("마운트 너비를 아직 모르면(0 이하) 그대로 둔다", () => {
    expect(computeFit(0, 1456, 828)).toEqual({ scale: 1, height: 828 });
  });

  it("녹화 너비를 아직 모르면(0 이하) 그대로 둔다", () => {
    expect(computeFit(728, 0, 828)).toEqual({ scale: 1, height: 828 });
  });
});
