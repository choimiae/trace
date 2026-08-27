# 관리자 UI 톤 정비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 페이지의 색·타이포·간격을 토큰과 프리미티브 위에 다시 세운다. 화면 구성과 흐름은 그대로 둔다.

**Architecture:** `styles/tokens.css` 에 원시값·의미값·밀도 3층을 두고, `ui/` 에 프리미티브 5종(Button·Chip·Card·Field·DataTable)을 세운다. 페이지는 프리미티브를 조립하고 색을 직접 쓰지 않는다. 차트는 `components/charts/` 안에 가두고 `React.lazy` 로 분리한다.

**Tech Stack:** React 18, TypeScript, Vite 6, Vitest 2 + jsdom, Testing Library, recharts 2, lucide-react

**Spec:** `docs/superpowers/specs/2026-08-26-admin-ui-refresh-design.md`

## Global Constraints

- Node 22.5 이상 (`.nvmrc` = `22`). 작업 전 `nvm use`.
- **접근 가능한 이름은 계약이다.** 아래 문자열을 글자 하나도 바꾸지 않는다. 버튼 `Google로 로그인` · `다시 시도` · `로그아웃` · `프로젝트 만들기` · `설치 안내` · `대시보드 보기` · `닫기` · `{이슈 제목} 보기` / 제목 `접근 권한이 없습니다.` · `연결할 수 없습니다.` · `첫 프로젝트를 만들어주세요.` · `스크립트를 붙여주세요.` / 라벨 `프로젝트 이름` · `허용 도메인` / 본문 `문제 인박스` · `아직 이벤트를 기다리고 있습니다.` · `첫 이벤트가 도착했습니다.` / 영역 `문제 상세` · `핵심 지표`
- 컴포넌트는 hex 색을 쓰지 않는다. `tokens.css` 의 **의미값 변수만** 참조한다 (`var(--accent)`, `var(--ink-muted)` 등).
- 상태 표시는 색만으로 뜻을 전달하지 않는다. **점 + 글자를 항상 함께** 둔다.
- `recharts` 는 `apps/admin/src/components/charts/` 밖에서 import 하지 않는다.
- UI 문구는 한국어. 마침표는 기존 문장 스타일을 따른다.
- 각 태스크 끝에서 `npm test` · `npm run typecheck` · `npm run build` 3게이트를 통과해야 한다.
- 라이트 전용. `prefers-color-scheme` 블록을 만들지 않는다.

## File Structure

### Create

- `apps/admin/src/styles/tokens.css` — 원시값·의미값·밀도 토큰. 색의 단일 출처.
- `apps/admin/src/styles/base.css` — 리셋, `body`, 타이포 기본, `.app-shell` 레이아웃.
- `apps/admin/src/ui/Button.tsx` / `Button.css` — 버튼 3종.
- `apps/admin/src/ui/Chip.tsx` / `Chip.css` — 상태 칩.
- `apps/admin/src/ui/Card.tsx` / `Card.css` — 표면 컨테이너.
- `apps/admin/src/ui/Field.tsx` / `Field.css` — 라벨·힌트·오류를 갖춘 입력 필드.
- `apps/admin/src/ui/DataTable.tsx` / `DataTable.css` — 열 정의 기반 표.
- `apps/admin/src/ui/Button.test.tsx` · `Chip.test.tsx` · `Field.test.tsx` · `DataTable.test.tsx`
- `apps/admin/src/pages/StatusPage.tsx` — 로딩·로그인·권한없음·연결실패 4종.
- `apps/admin/src/components/charts/FrictionTrendChart.tsx` — 이동 + 재작성.
- `apps/admin/src/components/charts/IssueTypeChart.tsx` — 이동 + 재작성.

### Modify

- `apps/admin/src/App.tsx` — 상태 화면 인라인 제거, `StatusPage` 사용.
- `apps/admin/src/pages/DashboardPage.tsx` — Card·DataTable 조립, 차트 lazy.
- `apps/admin/src/pages/IssueDetailPage.tsx` — Card·Chip 적용.
- `apps/admin/src/pages/InstallPage.tsx` — Button 적용.
- `apps/admin/src/pages/CreateProjectPage.tsx` — Field·Button 적용.
- `apps/admin/src/components/IssueTable.tsx` — DataTable·Chip 사용.
- `apps/admin/src/components/MetricStrip.tsx` — Card 사용.
- `apps/admin/src/components/SessionTimeline.tsx` — 마크업은 그대로 둔다. 색은 `.timeline` CSS 가 Task 9에서 `pages.css` 로 옮겨가며 토큰을 쓰게 된다.
- `apps/admin/src/styles.css` — 해체 후 삭제.

### Delete

- `apps/admin/src/components/FrictionTrendChart.tsx` → `charts/` 로 이동
- `apps/admin/src/components/IssueTypeChart.tsx` → `charts/` 로 이동
- `apps/admin/src/styles.css` (Task 9에서)

---

### Task 0: 토큰 계층 신설과 팔레트 교체

**Files:**
- Create: `apps/admin/src/styles/tokens.css`
- Create: `apps/admin/src/styles/base.css`
- Modify: `apps/admin/src/styles.css` (색 리터럴을 토큰 참조로 교체)
- Modify: `apps/admin/src/App.tsx:10` (import 추가)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: CSS 변수 이름 — `--surface` · `--surface-sunk` · `--border` · `--ink` · `--ink-muted` · `--ink-faint` · `--accent` · `--accent-soft` · `--status-good` · `--status-warn` · `--status-serious` · `--status-crit` · `--pad` · `--row-y` · `--body` · `--radius-sm`(4px) · `--radius`(7px) · `--radius-pill`(999px) · `--space-1`(2px) ~ `--space-7`(24px) · `--text-xs`(11px) ~ `--text-2xl`(26px). 이후 모든 태스크가 이 이름을 쓴다.

- [ ] **Step 1: 토큰 파일을 만든다**

`apps/admin/src/styles/tokens.css`:

```css
/* 색·간격·타이포의 단일 출처. 컴포넌트는 의미값 층만 참조한다.
   값의 근거는 docs/superpowers/specs/2026-08-26-admin-ui-refresh-design.md 참고.
   기존 청록은 채도 0.086 으로 기준 미달이라 회색으로 읽혀 교체했다. */

:root {
  /* --- 원시값: 중성 (slate) --- */
  --slate-50: #f5f7fa;
  --slate-100: #eef2f7;
  --slate-200: #dde4ec;
  --slate-500: #64748b;
  --slate-400: #94a3b8;
  --slate-900: #16202b;
  --white: #ffffff;

  /* --- 원시값: 액센트 (감청) --- */
  --navy-600: #1e6091;
  --navy-50: #f0f5fa;

  /* --- 원시값: 상태 (고정, 테마를 타지 않는다) --- */
  --green-500: #0ca30c;
  --amber-500: #fab219;
  --orange-500: #ec835a;
  --red-500: #d03b3b;

  /* --- 의미값 --- */
  --ground: var(--slate-50);
  --surface: var(--white);
  --surface-sunk: var(--slate-100);
  --border: var(--slate-200);
  --ink: var(--slate-900);
  --ink-muted: var(--slate-500);
  --ink-faint: var(--slate-400);
  --accent: var(--navy-600);
  --accent-soft: var(--navy-50);
  --status-good: var(--green-500);
  --status-warn: var(--amber-500);
  --status-serious: var(--orange-500);
  --status-crit: var(--red-500);

  /* --- 간격 --- */
  --space-1: 2px;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;
  --space-6: 16px;
  --space-7: 24px;

  /* --- 타이포 --- */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-md: 13px;
  --text-lg: 15px;
  --text-xl: 19px;
  --text-2xl: 22px;
  --text-3xl: 26px;

  /* --- 반경 --- */
  --radius-sm: 4px;
  --radius: 7px;
  --radius-pill: 999px;

  /* --- 밀도: 이 셋만 갈아끼우면 밀도가 바뀐다 --- */
  --pad: 12px;
  --row-y: 8px;
  --body: 13px;
}
```

- [ ] **Step 2: 기본 스타일 파일을 만든다**

`apps/admin/src/styles/base.css`:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  background: var(--ground);
  color: var(--ink);
  font-family:
    -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic",
    "Segoe UI", sans-serif;
  font-size: var(--body);
  line-height: 1.6;
  letter-spacing: -0.011em;
  -webkit-font-smoothing: antialiased;
}

button {
  font: inherit;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: var(--text-3xl);
  line-height: 1.2;
}

h2 {
  font-size: var(--text-lg);
  line-height: 1.35;
}

.app-shell {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: var(--space-7) 0 48px;
}

.eyebrow {
  margin: 0 0 var(--space-3);
  color: var(--ink-faint);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.empty-state {
  margin-bottom: 0;
  color: var(--ink-muted);
}
```

- [ ] **Step 3: 앱이 새 파일을 읽게 한다**

`apps/admin/src/App.tsx` 의 `import "./styles.css";` 를 아래로 바꾼다. 순서가 중요하다 — 토큰이 가장 먼저 와야 한다.

```tsx
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles.css";
```

- [ ] **Step 4: 기존 styles.css 의 색 리터럴을 토큰으로 바꾼다**

`apps/admin/src/styles.css` 에서 아래 매핑대로 전량 치환한다. 이 파일은 Task 9에서 해체하므로 지금은 색만 옮긴다. `:root`, `body`, `button`, `h1`, `h2`, `.eyebrow`, `.empty-state` 블록은 `base.css` 로 갔으므로 삭제한다.

| 기존 | 바꿀 값 |
| --- | --- |
| `#17202a` | `var(--ink)` |
| `#f4f7f8` | `var(--ground)` |
| `#ffffff` | `var(--surface)` |
| `#66767f` · `#5b6b7c` · `#44525a` | `var(--ink-muted)` |
| `#d8e1e8` · `#e6ecef` · `#d9e1ea` · `#ccd7dc` | `var(--border)` |
| 기존 청록 | `var(--accent)` |
| `#c4542d` | `var(--status-serious)` |
| `#fff7f2` | `var(--accent-soft)` |
| `#71351e` | `var(--ink)` |
| `#c0392b` | `var(--status-crit)` |
| `#f7f9fb` | `var(--surface-sunk)` |

`.insight` 의 `border-left: 4px solid #c4542d` 는 `3px solid var(--status-crit)` 으로 바꾼다. 인사이트는 심각 상태를 알리는 자리다.

- [ ] **Step 5: 검증 — 기존 테스트가 그대로 통과해야 한다**

```bash
npm test --workspace @trace/admin
```

Expected: PASS. 스타일만 바꿨으므로 실패하면 마크업을 건드린 것이다.

- [ ] **Step 6: 눈으로 확인한다**

```bash
npm run dev:api   # 터미널 1
npm run dev:admin # 터미널 2
```

`http://localhost:5173` 에서 로그인 화면과 대시보드가 감청 액센트에 slate 바탕으로 보이는지, 어디에도 이전 청록 리터럴이 남지 않았는지 확인한다.

- [ ] **Step 7: 3게이트**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/styles apps/admin/src/styles.css apps/admin/src/App.tsx
git commit -m "관리자: 색 토큰 계층을 세우고 팔레트를 교체"
```

---

### Task 1: Button 프리미티브

**Files:**
- Create: `apps/admin/src/ui/Button.tsx`, `apps/admin/src/ui/Button.css`, `apps/admin/src/ui/Button.test.tsx`
- Modify: `apps/admin/src/App.tsx`, `pages/DashboardPage.tsx`, `pages/InstallPage.tsx`, `pages/CreateProjectPage.tsx`, `pages/IssueDetailPage.tsx`, `components/IssueTable.tsx`

**Interfaces:**
- Consumes: Task 0 의 토큰 변수
- Produces: `Button` 컴포넌트. `props`: `variant?: "primary" | "secondary" | "icon"` (기본 `"secondary"`), `type?: "button" | "submit"` (기본 `"button"`), `disabled?: boolean`, `onClick?: () => void`, `"aria-label"?: string`, `children: ReactNode`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin/src/ui/Button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button.js";

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
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test --workspace @trace/admin -- src/ui/Button.test.tsx
```

Expected: FAIL — `Failed to resolve import "./Button.js"`

- [ ] **Step 3: 컴포넌트를 만든다**

`apps/admin/src/ui/Button.tsx`:

```tsx
import type { ReactNode } from "react";
import "./Button.css";

export function Button({
  variant = "secondary",
  type = "button",
  disabled,
  onClick,
  children,
  ...rest
}: {
  variant?: "primary" | "secondary" | "icon";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <button
      className={`button button-${variant}`}
      type={type}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
```

`apps/admin/src/ui/Button.css`:

```css
.button {
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink-muted);
  font-size: var(--text-sm);
  padding: var(--space-3) var(--space-5);
  cursor: pointer;
}

.button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.button:disabled {
  opacity: 0.5;
  cursor: default;
}

.button-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--surface);
  font-weight: 600;
}

.button-primary:hover:not(:disabled) {
  color: var(--surface);
}

.button-icon {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  color: var(--ink);
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npm run test --workspace @trace/admin -- src/ui/Button.test.tsx
```

Expected: PASS (3 tests)

- [ ] **Step 5: 기존 버튼 7개를 전부 교체한다**

각 자리의 문구와 `aria-label` 은 그대로 둔다. `className` 만 사라진다.

| 파일 | 기존 | 바꿀 것 |
| --- | --- | --- |
| `App.tsx` 로그인 화면 | `<button className="primary-button" …>Google로 로그인</button>` | `<Button variant="primary" onClick={…}>Google로 로그인</Button>` |
| `App.tsx` 연결실패 화면 | `<button className="primary-button" …>다시 시도</button>` | `<Button variant="primary" onClick={…}>다시 시도</Button>` |
| `DashboardPage.tsx` | `className="secondary-button"` 2개 (`설치 안내`, `로그아웃`) | `<Button onClick={…}>설치 안내</Button>` · `<Button onClick={…}>로그아웃</Button>` |
| `InstallPage.tsx` | `className="primary-button"` | `<Button variant="primary" onClick={onContinue}>{arrived ? "대시보드 보기" : "대시보드로 이동"}</Button>` |
| `CreateProjectPage.tsx` | `className="primary-button"` + `disabled` | `<Button variant="primary" disabled={…} onClick={submit}>프로젝트 만들기</Button>` |
| `IssueDetailPage.tsx` | `className="icon-button"` + `aria-label="닫기"` | `<Button variant="icon" aria-label="닫기" onClick={onClose}><X aria-hidden="true" size={18} /></Button>` |
| `IssueTable.tsx` | `className="icon-button"` + `aria-label={\`${issue.title} 보기\`}` | `<Button variant="icon" aria-label={\`${issue.title} 보기\`} onClick={() => onSelectIssue?.(issue)}><Eye aria-hidden="true" size={18} /></Button>` |

- [ ] **Step 6: 기존 테스트가 여전히 통과하는지 확인한다**

```bash
npm test --workspace @trace/admin
```

Expected: PASS. 실패하면 버튼 문구나 `aria-label` 을 흘린 것이다.

- [ ] **Step 7: 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src/ui apps/admin/src
git commit -m "관리자: Button 프리미티브로 버튼을 통일"
```

---

### Task 2: Chip 프리미티브와 상태 표시

**Files:**
- Create: `apps/admin/src/ui/Chip.tsx`, `Chip.css`, `Chip.test.tsx`
- Modify: `apps/admin/src/components/IssueTable.tsx`, `pages/IssueDetailPage.tsx`

**Interfaces:**
- Consumes: Task 0 토큰
- Produces: `Chip` 컴포넌트. `props`: `status: "good" | "warn" | "serious" | "crit"`, `label: string` (**필수**). 그리고 `issueStatusToChip(status: Issue["status"]): { status: ChipStatus; label: string }` 헬퍼를 같은 파일에서 export 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin/src/ui/Chip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip, issueStatusToChip } from "./Chip.js";

describe("Chip", () => {
  it("라벨을 글자로 노출한다 — 색만으로 뜻을 전하지 않는다", () => {
    render(<Chip status="crit" label="심각" />);
    expect(screen.getByText("심각")).toBeInTheDocument();
  });

  it("이슈 상태를 칩 속성으로 옮긴다", () => {
    // 유니온은 packages/shared/src/events.ts 의 issueStatusSchema 를 따른다:
    // ["new", "reviewing", "ignored", "resolved"]
    expect(issueStatusToChip("new")).toEqual({ status: "crit", label: "신규" });
    expect(issueStatusToChip("reviewing")).toEqual({ status: "warn", label: "검토 중" });
    expect(issueStatusToChip("resolved")).toEqual({ status: "good", label: "해결됨" });
    expect(issueStatusToChip("ignored")).toEqual({ status: "good", label: "무시함" });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test --workspace @trace/admin -- src/ui/Chip.test.tsx
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 컴포넌트를 만든다**

`apps/admin/src/ui/Chip.tsx`:

```tsx
import type { Issue } from "@trace/shared";
import "./Chip.css";

export type ChipStatus = "good" | "warn" | "serious" | "crit";

export function Chip({ status, label }: { status: ChipStatus; label: string }) {
  return (
    <span className={`chip chip-${status}`}>
      <i className="chip-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function issueStatusToChip(status: Issue["status"]): { status: ChipStatus; label: string } {
  switch (status) {
    case "new":
      return { status: "crit", label: "신규" };
    case "reviewing":
      return { status: "warn", label: "검토 중" };
    case "resolved":
      return { status: "good", label: "해결됨" };
    case "ignored":
      return { status: "good", label: "무시함" };
  }
}
```

`apps/admin/src/ui/Chip.css`:

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  padding: var(--space-1) var(--space-4) var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  border: 1px solid currentColor;
  white-space: nowrap;
}

.chip-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}

.chip-good { color: #0a7d0a; }
.chip-warn { color: #b07d0c; }
.chip-serious { color: #b8613d; }
.chip-crit { color: var(--status-crit); }
```

> 주의: `good` · `warn` · `serious` 는 흰 표면 위 글자 대비를 맞추려고 상태색을 한 단계 어둡게 쓴 값이다. 점·막대 같은 면에는 `var(--status-*)` 원값을 쓴다. 이 예외는 여기서 끝이며 다른 컴포넌트로 번지지 않게 한다.

- [ ] **Step 4: 통과를 확인한다**

```bash
npm run test --workspace @trace/admin -- src/ui/Chip.test.tsx
```

Expected: PASS (2 tests)

- [ ] **Step 5: 이슈 표와 상세에 적용한다**

`IssueTable.tsx` 의 `<td>{issue.issueType}</td>` 를 상태 칩으로 바꾼다.

```tsx
import { Chip, issueStatusToChip } from "../ui/Chip.js";

// tbody 안에서
<td>
  {(() => {
    const chip = issueStatusToChip(issue.status);
    return <Chip status={chip.status} label={chip.label} />;
  })()}
</td>
```

`IssueDetailPage.tsx` 의 `<dd>{issue.status}</dd>` 도 같은 방식으로 칩으로 바꾼다.

- [ ] **Step 6: 기존 테스트 확인 후 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src
git commit -m "관리자: 상태 표시를 Chip 으로 바꾸고 색 단독 전달을 없앰"
```

---

### Task 3: Card 프리미티브

**Files:**
- Create: `apps/admin/src/ui/Card.tsx`, `Card.css`
- Modify: `components/MetricStrip.tsx`, `pages/IssueDetailPage.tsx`, `pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: Task 0 토큰
- Produces: `Card` 컴포넌트. `props`: `as?: "div" | "section" | "aside"` (기본 `"div"`), `className?: string`, `children: ReactNode`, `"aria-label"?: string`

- [ ] **Step 1: 컴포넌트를 만든다**

Card 는 표면을 그리는 것 외에 동작이 없으므로 단위 테스트를 따로 두지 않는다. 기존 테스트가 회귀 감시 역할을 한다.

`apps/admin/src/ui/Card.tsx`:

```tsx
import type { ReactNode } from "react";
import "./Card.css";

export function Card({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "aside";
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Tag className={className ? `card ${className}` : "card"} {...rest}>
      {children}
    </Tag>
  );
}
```

`apps/admin/src/ui/Card.css`:

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--pad);
}
```

- [ ] **Step 2: 지표 타일에 적용한다**

`MetricStrip.tsx` 의 `<div>` 4개를 `<Card>` 로 바꾼다. `aria-label="핵심 지표"` 는 바깥 `<section>` 에 그대로 남긴다.

```tsx
import { Card } from "../ui/Card.js";

<section className="metric-strip" aria-label="핵심 지표">
  <Card>
    <span>막힘 점수</span>
    <strong>{summary.frictionScore}</strong>
  </Card>
  {/* 나머지 3개도 같은 형태 */}
</section>
```

- [ ] **Step 3: 지표 숫자를 밀도에 맞춘다**

`styles.css` 의 `.metric-strip strong` 은 `font-size: 2rem`(32px)이다. 확정한 밀도는 22px 이므로 바꾼다.

```css
.metric-strip strong {
  display: block;
  margin-top: var(--space-4);
  color: var(--accent);
  font-size: var(--text-2xl);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.metric-strip span {
  display: block;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  font-weight: 600;
}
```

- [ ] **Step 4: 드로어에 적용한다**

`IssueDetailPage.tsx` 의 `<aside className="detail-drawer" aria-label="문제 상세">` 를 `<Card as="aside" className="detail-drawer" aria-label="문제 상세">` 로 바꾼다. `aria-label` 이 살아 있어야 한다.

- [ ] **Step 5: 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src
git commit -m "관리자: 표면을 Card 프리미티브로 통일"
```

---

### Task 4: Field 프리미티브

**Files:**
- Create: `apps/admin/src/ui/Field.tsx`, `Field.css`, `Field.test.tsx`
- Modify: `pages/CreateProjectPage.tsx`

**Interfaces:**
- Consumes: Task 0 토큰
- Produces: `Field` 컴포넌트. `props`: `id: string`, `label: string`, `value: string`, `onChange: (value: string) => void`, `placeholder?: string`, `hint?: string`, `error?: string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

힌트가 접근 가능한 이름에 섞이지 않는 것이 이 컴포넌트의 존재 이유다. 그것을 테스트로 고정한다.

`apps/admin/src/ui/Field.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./Field.js";

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
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test --workspace @trace/admin -- src/ui/Field.test.tsx
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 컴포넌트를 만든다**

`apps/admin/src/ui/Field.tsx`:

```tsx
import "./Field.css";

export function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="field">
      {/* 힌트를 label 안에 두면 접근 가능한 이름에 힌트 문구가 붙어
          getByLabelText 로 조회되지 않는다. 반드시 밖에 둔다. */}
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
```

`apps/admin/src/ui/Field.css`:

```css
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-6) 0;
  max-width: 420px;
  text-align: left;
}

.field input {
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
}

.field input:focus-visible {
  border-color: var(--accent);
}

.field-hint {
  color: var(--ink-muted);
  font-size: var(--text-md);
}

.field-error {
  color: var(--status-crit);
  font-size: var(--text-md);
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npm run test --workspace @trace/admin -- src/ui/Field.test.tsx
```

Expected: PASS (2 tests)

- [ ] **Step 5: 프로젝트 생성 화면에 적용한다**

`CreateProjectPage.tsx` 의 입력 두 개를 바꾼다. `id` 는 기존 값(`project-name`, `allowed-domains`)을 유지한다.

```tsx
<Field
  id="project-name"
  label="프로젝트 이름"
  value={name}
  onChange={setName}
  placeholder="내 사이트"
/>

<Field
  id="allowed-domains"
  label="허용 도메인"
  value={domains}
  onChange={setDomains}
  placeholder="http://localhost:5174"
  hint="이 프로젝트의 이벤트를 받을 사이트 주소입니다. 여러 개면 쉼표로 구분합니다."
/>

{error ? <p className="field-error">{error}</p> : null}
```

- [ ] **Step 6: 기존 테스트 확인**

```bash
npm test --workspace @trace/admin
```

Expected: PASS. `getByLabelText("프로젝트 이름")` 과 `getByLabelText("허용 도메인")` 이 걸리면 힌트가 label 안으로 들어간 것이다.

- [ ] **Step 7: 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src
git commit -m "관리자: Field 프리미티브로 입력 라벨 구조를 고정"
```

---

### Task 5: DataTable 프리미티브

**Files:**
- Create: `apps/admin/src/ui/DataTable.tsx`, `DataTable.css`, `DataTable.test.tsx`
- Modify: `apps/admin/src/components/IssueTable.tsx`

**Interfaces:**
- Consumes: Task 0 토큰, Task 1 `Button`, Task 2 `Chip`
- Produces: `DataTable<T>` 컴포넌트. `props`: `columns: Array<{ key: string; header: string; headerLabel?: string; render: (row: T) => ReactNode; align?: "start" | "end" }>`, `rows: T[]`, `rowKey: (row: T) => string`, `empty: string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin/src/ui/DataTable.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable.js";

type Row = { id: string; name: string };

const columns = [
  { key: "name", header: "이름", render: (row: Row) => row.name },
];

describe("DataTable", () => {
  it("행을 렌더한다", () => {
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "a", name: "결제 버튼 반복 클릭" }]}
        rowKey={(row) => row.id}
        empty="아직 감지된 문제가 없습니다."
      />,
    );
    expect(screen.getByText("결제 버튼 반복 클릭")).toBeInTheDocument();
  });

  it("행이 없으면 빈 문구를 보여준다", () => {
    render(
      <DataTable columns={columns} rows={[]} rowKey={(row) => row.id} empty="아직 감지된 문제가 없습니다." />,
    );
    expect(screen.getByText("아직 감지된 문제가 없습니다.")).toBeInTheDocument();
  });

  it("headerLabel 이 있으면 헤더 글자 대신 접근 가능한 이름으로 쓴다", () => {
    render(
      <DataTable
        columns={[{ key: "action", header: "", headerLabel: "작업", render: () => null }]}
        rows={[{ id: "a", name: "x" }]}
        rowKey={(row) => row.id}
        empty="비었습니다."
      />,
    );
    expect(screen.getByRole("columnheader", { name: "작업" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npm run test --workspace @trace/admin -- src/ui/DataTable.test.tsx
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: 컴포넌트를 만든다**

`apps/admin/src/ui/DataTable.tsx`:

```tsx
import type { ReactNode } from "react";
import "./DataTable.css";

export type Column<T> = {
  key: string;
  header: string;
  headerLabel?: string;
  render: (row: T) => ReactNode;
  align?: "start" | "end";
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="empty-state">{empty}</p>;
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-label={column.headerLabel}
                style={column.align === "end" ? { textAlign: "right" } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={column.align === "end" ? { textAlign: "right" } : undefined}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`apps/admin/src/ui/DataTable.css`:

```css
.data-table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

.data-table th {
  color: var(--ink-faint);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  text-align: left;
  padding: var(--space-3) var(--space-4);
  background: var(--surface-sunk);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.data-table td {
  padding: var(--row-y) var(--space-4);
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  font-size: var(--body);
}

.data-table tbody tr:last-child td {
  border-bottom: none;
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npm run test --workspace @trace/admin -- src/ui/DataTable.test.tsx
```

Expected: PASS (3 tests)

- [ ] **Step 5: 이슈 표를 DataTable 로 바꾼다**

`IssueTable.tsx` 전체를 아래로 바꾼다. 표 헤더 문구와 `aria-label={\`${issue.title} 보기\`}` 는 그대로다.

```tsx
import type { Issue } from "@trace/shared";
import { Eye } from "lucide-react";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Chip, issueStatusToChip } from "../ui/Chip.js";
import { DataTable, type Column } from "../ui/DataTable.js";

export function IssueTable({
  issues,
  onSelectIssue,
}: {
  issues: Issue[];
  onSelectIssue?: ((issue: Issue) => void) | undefined;
}) {
  const columns: Array<Column<Issue>> = [
    {
      key: "title",
      header: "제목",
      render: (issue) => (
        <>
          <strong>{issue.title}</strong>
          <span className="cell-sub">{issue.summary}</span>
        </>
      ),
    },
    {
      key: "status",
      header: "상태",
      render: (issue) => {
        const chip = issueStatusToChip(issue.status);
        return <Chip status={chip.status} label={chip.label} />;
      },
    },
    { key: "path", header: "화면", render: (issue) => issue.relatedUrlPath ?? "-" },
    { key: "sessions", header: "세션", align: "end", render: (issue) => issue.affectedSessionsCount },
    { key: "score", header: "점수", align: "end", render: (issue) => issue.severityScore },
    {
      key: "action",
      header: "",
      headerLabel: "작업",
      align: "end",
      render: (issue) => (
        <Button variant="icon" aria-label={`${issue.title} 보기`} onClick={() => onSelectIssue?.(issue)}>
          <Eye aria-hidden="true" size={18} />
        </Button>
      ),
    },
  ];

  return (
    <Card as="section" className="table-panel">
      <div className="section-heading">
        <h2>문제 목록</h2>
        <span>{issues.length}건</span>
      </div>
      <DataTable
        columns={columns}
        rows={issues}
        rowKey={(issue) => issue.issueId}
        empty="아직 감지된 문제가 없습니다."
      />
    </Card>
  );
}
```

`.cell-sub` 스타일을 `DataTable.css` 에 더한다.

```css
.data-table .cell-sub {
  display: block;
  margin-top: var(--space-1);
  color: var(--ink-faint);
  font-size: var(--text-sm);
}
```

- [ ] **Step 6: 기존 테스트 확인 후 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src
git commit -m "관리자: 이슈 표를 DataTable 프리미티브로 교체"
```

---

### Task 6: 상태 화면 4종을 StatusPage 로 추출

**Files:**
- Create: `apps/admin/src/pages/StatusPage.tsx`
- Modify: `apps/admin/src/App.tsx:105-160` (상태 분기 4곳)

**Interfaces:**
- Consumes: Task 1 `Button`
- Produces: `StatusPage` 컴포넌트. `props`: `title: string`, `description?: string`, `action?: { label: string; onClick: () => void }`

- [ ] **Step 1: 컴포넌트를 만든다**

`apps/admin/src/pages/StatusPage.tsx`:

```tsx
import { Button } from "../ui/Button.js";

export function StatusPage({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="app-shell auth-state">
      <p className="eyebrow">Trace 관리자</p>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {action ? (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 2: App.tsx 의 상태 분기 4개를 교체한다**

문구는 글자 그대로 유지한다.

```tsx
if (state.type === "loading") return <main className="app-shell">불러오는 중</main>;

if (state.type === "login") {
  return (
    <StatusPage
      title="관리자 로그인이 필요합니다."
      action={{
        label: "Google로 로그인",
        onClick: () => {
          window.location.href = `${API_BASE_URL}/auth/google/start`;
        },
      }}
    />
  );
}

if (state.type === "forbidden") {
  return <StatusPage title="접근 권한이 없습니다." />;
}

if (state.type === "network") {
  return (
    <StatusPage
      title="연결할 수 없습니다."
      description="잠시 후 다시 시도해주세요."
      action={{ label: "다시 시도", onClick: () => setReloadKey((key) => key + 1) }}
    />
  );
}
```

`App.tsx` 아래쪽의 `AppMessage` 함수는 쓰이지 않게 되므로 삭제한다.

- [ ] **Step 3: 기존 테스트로 이름 보존을 확인한다**

```bash
npm test --workspace @trace/admin
```

Expected: PASS. 특히 `findByRole("heading", { name: "접근 권한이 없습니다." })` 와 `{ name: "연결할 수 없습니다." }` 가 통과해야 한다.

- [ ] **Step 4: 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src
git commit -m "관리자: 상태 화면 4종을 StatusPage 로 분리"
```

---

### Task 7: 차트를 charts/ 로 가두고 재테마

**Files:**
- Create: `apps/admin/src/components/charts/FrictionTrendChart.tsx`
- Create: `apps/admin/src/components/charts/IssueTypeChart.tsx`
- Delete: `apps/admin/src/components/FrictionTrendChart.tsx`, `apps/admin/src/components/IssueTypeChart.tsx`
- Modify: `apps/admin/src/pages/DashboardPage.tsx` (import 경로)

**Interfaces:**
- Consumes: Task 0 토큰, Task 3 `Card`
- Produces: `FrictionTrendChart({ data }: { data: Array<{ date: string; score: number }> })` · `IssueTypeChart({ data }: { data: DashboardSummary["issueTypeDistribution"] })` — props 시그니처는 기존과 동일하게 유지한다.

- [ ] **Step 1: 추세 차트를 옮기고 다시 쓴다**

`apps/admin/src/components/charts/FrictionTrendChart.tsx`:

```tsx
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../../ui/Card.js";

export function FrictionTrendChart({ data }: { data: Array<{ date: string; score: number }> }) {
  return (
    <Card as="section" className="chart-panel">
      <h2>기간별 막힘 추세</h2>
      {data.length === 0 ? (
        <p className="empty-state">아직 표시할 추세가 없습니다.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--ink-faint)" }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "var(--ink-faint)" }} width={32} />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="score"
              name="막힘 점수"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: 유형 분포 차트를 옮기고 다시 쓴다**

`apps/admin/src/components/charts/IssueTypeChart.tsx`:

```tsx
import type { DashboardSummary } from "@trace/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "../../ui/Card.js";

export function IssueTypeChart({ data }: { data: DashboardSummary["issueTypeDistribution"] }) {
  return (
    <Card as="section" className="chart-panel">
      <h2>이슈 유형 분포</h2>
      {data.length === 0 ? (
        <p className="empty-state">아직 표시할 이슈가 없습니다.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="issueType" tick={{ fontSize: 12, fill: "var(--ink-faint)" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--ink-faint)" }} width={32} />
            <Tooltip
              cursor={{ fill: "var(--surface-sunk)" }}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: 12,
              }}
            />
            <Bar dataKey="count" name="이슈 수" fill="var(--accent)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: 옛 파일을 지우고 import 를 고친다**

```bash
git rm apps/admin/src/components/FrictionTrendChart.tsx apps/admin/src/components/IssueTypeChart.tsx
```

`DashboardPage.tsx` 의 import 두 줄을 `../components/charts/…` 로 바꾼다.

- [ ] **Step 4: 경계 규칙을 확인한다**

```bash
grep -rn "recharts" apps/admin/src | grep -v "src/components/charts/"
```

Expected: 출력 없음. 한 줄이라도 나오면 경계가 깨진 것이다.

- [ ] **Step 5: 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src
git commit -m "관리자: 차트를 charts/ 로 가두고 토큰·반응형으로 재작성"
```

---

### Task 8: 차트 lazy 분리와 번들 측정

**Files:**
- Modify: `apps/admin/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: Task 7 의 차트 컴포넌트
- Produces: 없음 (내부 최적화)

- [ ] **Step 1: 현재 번들 크기를 기록한다**

```bash
npm run build --workspace @trace/admin
```

출력의 `dist/assets/index-*.js` 줄을 적어둔다. 기준선은 raw 548.44 kB / gzip 158.86 kB 였다.

- [ ] **Step 2: 차트를 lazy 로 바꾼다**

`DashboardPage.tsx` 상단:

```tsx
import { lazy, Suspense } from "react";

const FrictionTrendChart = lazy(() =>
  import("../components/charts/FrictionTrendChart.js").then((module) => ({
    default: module.FrictionTrendChart,
  })),
);

const IssueTypeChart = lazy(() =>
  import("../components/charts/IssueTypeChart.js").then((module) => ({
    default: module.IssueTypeChart,
  })),
);
```

차트를 쓰는 자리를 `Suspense` 로 감싼다. fallback 은 자리만 잡아 레이아웃이 튀지 않게 한다.

```tsx
<section className="chart-grid" aria-label="막힘 분석 차트">
  <Suspense fallback={<Card as="section" className="chart-panel" />}>
    <FrictionTrendChart data={summary.trend} />
    <IssueTypeChart data={summary.issueTypeDistribution} />
  </Suspense>
</section>
```

- [ ] **Step 3: 테스트가 통과하는지 확인한다**

```bash
npm test --workspace @trace/admin
```

Expected: PASS. 기존 테스트는 차트 내용을 단언하지 않고 `findBy*` 로 비동기를 기다리므로 lazy 로 바뀌어도 걸리지 않는다. 만약 "not wrapped in act" 경고가 뜨면 단언을 `findBy*` 로 바꾼다.

- [ ] **Step 4: 분리 효과를 측정한다**

```bash
npm run build --workspace @trace/admin
```

Expected: `index-*.js` 가 눈에 띄게 줄고 별도 청크가 생긴다. 두 숫자(전·후)를 커밋 메시지에 적는다.

- [ ] **Step 5: 눈으로 확인한다**

로그인 → 프로젝트 생성 → 설치 안내 경로에서 차트 청크가 내려오지 않는지 브라우저 네트워크 탭에서 확인한다. 대시보드에 들어갈 때 비로소 받아야 한다.

- [ ] **Step 6: 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src
git commit -m "관리자: 차트를 lazy 로 분리해 설치 경로에서 제외"
```

---

### Task 9: styles.css 해체와 최종 검증

**Files:**
- Delete: `apps/admin/src/styles.css`
- Create: `apps/admin/src/pages/pages.css`
- Modify: `apps/admin/src/App.tsx` (import 정리)

**Interfaces:**
- Consumes: 앞선 모든 태스크
- Produces: 없음 (마무리)

- [ ] **Step 1: 남은 규칙을 옮긴다**

`styles.css` 에 남은 것 중 프리미티브가 흡수하지 못한 레이아웃 규칙 — `.auth-state` · `.metric-strip` · `.insight` · `.chart-grid` · `.section-heading` · `.detail-drawer` · `.detail-header` · `.detail-metrics` · `.detail-summary` · `.timeline` · `.install-snippet` · `.install-status` · `.page-header` · `.header-actions` · `.user-email` · 미디어 쿼리 — 를 `apps/admin/src/pages/pages.css` 로 옮긴다. 색은 이미 토큰이므로 그대로 복사한다.

`.primary-button` · `.secondary-button` · `.icon-button` · `table` · `th` · `td` · `.field*` · `.chip*` 규칙은 프리미티브가 대체했으므로 **버린다**.

- [ ] **Step 2: styles.css 를 지우고 import 를 정리한다**

```bash
git rm apps/admin/src/styles.css
```

`App.tsx`:

```tsx
import "./styles/tokens.css";
import "./styles/base.css";
import "./pages/pages.css";
```

- [ ] **Step 3: 죽은 클래스가 없는지 확인한다**

```bash
for c in primary-button secondary-button icon-button field-hint; do
  echo "== $c"; grep -rn "$c" apps/admin/src || echo "  (없음)";
done
```

Expected: 전부 `(없음)`.

- [ ] **Step 4: 하드코딩된 색이 남지 않았는지 확인한다**

```bash
grep -rnE "#[0-9a-fA-F]{6}" apps/admin/src --include=*.css --include=*.tsx | grep -v "styles/tokens.css" | grep -v "ui/Chip.css"
```

Expected: 출력 없음. `tokens.css` 와 `Chip.css`(대비 보정 예외, Task 2 주석 참고) 만 hex 를 갖는다.

- [ ] **Step 5: 화면 4개를 눈으로 확인한다**

```bash
npm run dev:api   # 터미널 1
npm run dev:admin # 터미널 2
```

확인 항목:
- 로그인 화면 — 감청 버튼, slate 바탕
- 프로젝트 생성 — 라벨 아래 힌트, 오류 문구 자리
- 설치 안내 — 스니펫 박스, 이벤트 도착 문구
- 문제 인박스 — 지표 4개, 인사이트, 차트 2개(창을 좁혔다 넓혀 반응형 확인), 이슈 표의 상태 칩
- 이슈 상세 — 드로어가 열리고 닫힘

- [ ] **Step 6: 3게이트와 Commit**

```bash
npm test && npm run typecheck && npm run build
git add apps/admin/src
git commit -m "관리자: styles.css 를 해체하고 토큰 체계로 마무리"
```

---

## Final Review Checklist

구현을 마친 뒤 확인한다.

- [ ] `npm test` 가 통과한다.
- [ ] `npm run typecheck` 가 통과한다.
- [ ] `npm run build` 가 통과한다.
- [ ] 기존 `App.test.tsx` 를 **한 줄도 고치지 않고** 통과한다.
- [ ] `grep -rn "recharts" apps/admin/src | grep -v "src/components/charts/"` 가 비어 있다.
- [ ] `tokens.css` 와 `ui/Chip.css` 외의 파일에 hex 색이 없다.
- [ ] 이전 청록 리터럴이 저장소 어디에도 남아 있지 않다.
- [ ] 차트가 별도 청크로 분리되고, 설치 경로 3화면에서 내려오지 않는다.
- [ ] 상태 표시가 전부 점 + 글자를 함께 쓴다.
- [ ] 창을 좁혔을 때 차트가 잘리지 않는다.

## 이번 범위에서 하지 않는 것

- 다크 모드. `tokens.css` 의 의미값 층에 블록을 더하면 되지만 이번엔 만들지 않는다.
- 밀도 전환 토글. `--pad` · `--row-y` · `--body` 세 변수로 잡아두므로 나중에 열 수 있다.
- 새 화면(프로젝트 설정 · 전환), 라우터 도입, 차트 라이브러리 교체.
