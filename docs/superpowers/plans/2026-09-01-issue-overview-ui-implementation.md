# Issue Overview UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 대시보드 문제 목록을 한눈에 보기 쉬운 우선순위 인박스형 UI로 변경한다.

**Architecture:** `IssueTable`이 기존 `Issue[]`를 받아 내부에서 정렬과 요약 계산을 수행한다. 공용 `formatKoreanDateTime` formatter를 재사용하고, API/DB/SDK 계약은 변경하지 않는다.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing admin CSS.

## Global Constraints

- Korean is the default language for project communication and product copy.
- Do not change API, DB, SDK ingestion, or shared `Issue` schema.
- Use existing UI primitives where they fit: `Card`, `Button`, `Chip`.
- Use `lucide-react` icons when an icon button is needed.
- Use KST display through `apps/admin/src/time.ts`.

---

### Task 1: IssueTable Priority Inbox

**Files:**
- Create: `apps/admin/src/components/IssueTable.test.tsx`
- Modify: `apps/admin/src/components/IssueTable.tsx`
- Modify: `apps/admin/src/pages/pages.css`

**Interfaces:**
- Consumes: `Issue[]`, `onSelectIssue?: (issue: Issue) => void`, `formatKoreanDateTime(value: string): string`
- Produces: `IssueTable` renders sorted issue overview rows and invokes `onSelectIssue(issue)` from row click and icon click.

- [ ] **Step 1: Write the failing test**

```tsx
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Issue } from "@trace/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueTable } from "./IssueTable.js";

expect.extend(matchers);
afterEach(cleanup);

const issue = (overrides: Partial<Issue>): Issue => ({
  issueId: "issue_base",
  projectId: "proj_demo",
  issueType: "rage_click",
  title: "기본 문제",
  summary: "요약",
  affectedSessionsCount: 1,
  affectedUsersCount: 1,
  severityScore: 10,
  firstSeenAt: "2026-09-01T00:00:00.000Z",
  lastSeenAt: "2026-09-01T00:00:00.000Z",
  trend: "flat",
  relatedUrlPath: "/",
  exampleSessionIds: ["sess_1"],
  status: "new",
  ...overrides,
});

describe("IssueTable", () => {
  it("심각도와 최신 발견 시각 기준으로 문제를 정렬하고 요약한다", () => {
    render(
      <IssueTable
        issues={[
          issue({ issueId: "low", title: "낮은 문제", severityScore: 20 }),
          issue({ issueId: "critical", title: "긴급 문제", severityScore: 91, lastSeenAt: "2026-09-01T03:00:00.000Z" }),
          issue({ issueId: "warn", title: "주의 문제", severityScore: 65 }),
        ]}
      />,
    );

    expect(screen.getByText("긴급 1")).toBeInTheDocument();
    expect(screen.getByText("주의 1")).toBeInTheDocument();
    expect(screen.getByText("낮음 1")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((row) => row.textContent)).toEqual([
      expect.stringContaining("긴급 문제"),
      expect.stringContaining("주의 문제"),
      expect.stringContaining("낮은 문제"),
    ]);
  });

  it("문제 핵심 정보를 한 행에서 보여주고 행 클릭으로 상세를 연다", () => {
    const onSelectIssue = vi.fn();
    render(
      <IssueTable
        onSelectIssue={onSelectIssue}
        issues={[
          issue({
            issueId: "issue_1",
            title: "설정 저장 버튼 반복 클릭",
            summary: "저장 버튼에서 rage click이 반복됩니다.",
            severityScore: 88,
            affectedSessionsCount: 12,
            affectedUsersCount: 7,
            trend: "up",
            relatedUrlPath: "/settings",
            lastSeenAt: "2026-09-01T06:00:00.000Z",
          }),
        ]}
      />,
    );

    const row = screen.getByRole("button", { name: /설정 저장 버튼 반복 클릭/ });
    expect(within(row).getByText("88")).toBeInTheDocument();
    expect(within(row).getByText("긴급")).toBeInTheDocument();
    expect(within(row).getByText("증가")).toBeInTheDocument();
    expect(within(row).getByText("세션 12")).toBeInTheDocument();
    expect(within(row).getByText("사용자 7")).toBeInTheDocument();
    expect(within(row).getByText("/settings")).toBeInTheDocument();
    expect(within(row).getByText("마지막 발견 2026-09-01 15:00:00")).toBeInTheDocument();

    fireEvent.click(row);
    expect(onSelectIssue).toHaveBeenCalledWith(expect.objectContaining({ issueId: "issue_1" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @trace/admin -- src/components/IssueTable.test.tsx`

Expected: FAIL because `IssueTable.test.tsx` expects priority summary, row buttons, sorted rows, and KST last seen text that the current table UI does not render.

- [ ] **Step 3: Write minimal implementation**

Replace the table column rendering in `IssueTable.tsx` with:

```tsx
type SeverityLevel = "critical" | "warning" | "low";

function severityLevel(score: number): SeverityLevel {
  if (score >= 80) return "critical";
  if (score >= 50) return "warning";
  return "low";
}
```

Render a `.issue-overview-summary` with three counters, then render sorted `.issue-overview-row` buttons. Use `formatKoreanDateTime(issue.lastSeenAt)`, `issueStatusToChip(issue.status)`, and `Eye` inside the right-side icon.

- [ ] **Step 4: Add CSS**

Add classes in `pages.css`: `.issue-overview-summary`, `.issue-overview-list`, `.issue-overview-row`, `.issue-severity`, `.issue-main`, `.issue-meta`, `.issue-stats`, `.issue-open-icon`. Keep rows responsive with grid columns that collapse to one column below the existing mobile breakpoint.

- [ ] **Step 5: Run focused tests**

Run: `npm run test --workspace @trace/admin -- src/components/IssueTable.test.tsx src/pages/DashboardPage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-01-issue-overview-ui-design.md docs/superpowers/plans/2026-09-01-issue-overview-ui-implementation.md apps/admin/src/components/IssueTable.test.tsx apps/admin/src/components/IssueTable.tsx apps/admin/src/pages/pages.css
git commit -m "관리자: 문제 목록 한눈에 보기 개선"
```
