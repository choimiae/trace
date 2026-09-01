# Issue Dashboard Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 대시보드에 한 화면에서 다양한 문제 정보를 볼 수 있는 개요 섹션을 추가한다.

**Architecture:** `IssueDashboardOverview` 컴포넌트를 새로 만들고 `DashboardPage`가 `summary`와 `issues`를 전달한다. 컴포넌트 내부에서 정렬, 심각도 집계, 최근 발견 목록, 상위 화면/원인 패널을 계산한다.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing admin CSS, lucide-react.

## Global Constraints

- Korean is the default language for project communication and product copy.
- Do not change API, DB, SDK ingestion, or shared schemas.
- Use existing data only: `DashboardSummary`, `Issue[]`.
- Display admin issue dates with `formatKoreanDateTime`, including year, month, day, hour, minute, and second.
- Keep the existing full issue list below the new overview.

---

### Task 1: IssueDashboardOverview Component

**Files:**
- Create: `apps/admin/src/components/IssueDashboardOverview.tsx`
- Create: `apps/admin/src/components/IssueDashboardOverview.test.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.test.tsx`
- Modify: `apps/admin/src/pages/pages.css`

**Interfaces:**
- Consumes: `summary: DashboardSummary`, `issues: Issue[]`, `onSelectIssue?: (issue: Issue) => void`
- Produces: `<IssueDashboardOverview summary={summary} issues={issues} onSelectIssue={onSelectIssue} />`

- [ ] **Step 1: Write failing component test**

Create `IssueDashboardOverview.test.tsx` that renders issues and verifies:

- `한눈에 보기` section exists.
- top issue is the highest `severityScore`.
- `최근 발견 2026-09-01 15:00:00` is displayed with full date.
- `문제가 많은 화면`, `문제 원인`, `최근 발견` panels render existing summary data.

- [ ] **Step 2: Write failing DashboardPage test**

Add one `DashboardPage.test.tsx` case asserting the dashboard renders `한눈에 보기` when issues are present.

- [ ] **Step 3: Verify RED**

Run: `npm run test --workspace @trace/admin -- src/components/IssueDashboardOverview.test.tsx src/pages/DashboardPage.test.tsx`

Expected: FAIL because the component does not exist and DashboardPage does not render the overview.

- [ ] **Step 4: Implement component**

Implement `IssueDashboardOverview` with these helpers:

- `severityLevel(score: number): "critical" | "warning" | "low"`
- `sortByPriority(issues: Issue[]): Issue[]`
- `sortByRecent(issues: Issue[]): Issue[]`
- `issueTypeLabel(issueType: Issue["issueType"]): string`
- `trendLabel(trend: Issue["trend"]): string`

- [ ] **Step 5: Wire into DashboardPage**

Import and render `IssueDashboardOverview` after the insight section and before charts.

- [ ] **Step 6: Add CSS**

Add dashboard overview classes in `pages.css` with a compact 3-column grid on desktop and single-column layout under `820px`.

- [ ] **Step 7: Verify GREEN**

Run: `npm run test --workspace @trace/admin -- src/components/IssueDashboardOverview.test.tsx src/pages/DashboardPage.test.tsx`

Expected: PASS.

- [ ] **Step 8: Full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-09-01-issue-dashboard-overview-design.md docs/superpowers/plans/2026-09-01-issue-dashboard-overview-implementation.md apps/admin/src/components/IssueDashboardOverview.tsx apps/admin/src/components/IssueDashboardOverview.test.tsx apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/DashboardPage.test.tsx apps/admin/src/pages/pages.css
git commit -m "관리자: 문제 대시보드 개요 추가"
```
