import { describe, expect, it } from "vitest";
import { issueTypeSchema } from "./events.js";
import { issueTypeLabel } from "./issue-labels.js";

describe("issueTypeLabel", () => {
  // 유형이 계약에 추가됐는데 이름을 안 붙이면, 그 유형만 화면에서 원시 enum 으로
  // 새어 나온다. 눈으로는 한 화면에서만 보이므로 놓치기 쉽다 — 스키마를 훑어 막는다.
  it("계약의 모든 유형에 원시 enum 이 아닌 이름이 붙어 있다", () => {
    for (const issueType of issueTypeSchema.options) {
      const label = issueTypeLabel(issueType);
      expect(label).not.toBe(issueType);
      expect(label.trim()).not.toBe("");
    }
  });

  it("같은 유형은 어디서 부르든 같은 이름을 돌려준다", () => {
    expect(issueTypeLabel("dead_click_cluster")).toBe(issueTypeLabel("dead_click_cluster"));
    expect(issueTypeLabel("rage_click")).toBe("분노 클릭");
    expect(issueTypeLabel("dead_click_cluster")).toBe("반응 없는 클릭");
  });

  it("서로 다른 유형은 서로 다른 이름을 갖는다", () => {
    const labels = issueTypeSchema.options.map(issueTypeLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // 구버전 관리자가 신버전 서버의 유형을 받아도 칸이 비지 않아야 한다.
  it("계약에 없는 유형은 받은 값을 그대로 돌려준다", () => {
    expect(issueTypeLabel("brand_new_friction")).toBe("brand_new_friction");
  });
});
