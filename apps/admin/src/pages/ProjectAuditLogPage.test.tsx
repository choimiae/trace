import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectAuditLogPage,
  describeAuditLogActor,
  describeAuditLogEntry,
} from "./ProjectAuditLogPage.js";

expect.extend(matchers);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function entry(overrides: Partial<React.ComponentProps<typeof ProjectAuditLogPage>["entries"][number]> = {}) {
  return {
    auditLogId: "audit_1",
    action: "project.created",
    createdAt: "2026-08-31T01:23:45.000Z",
    metadata: { name: "Demo" },
    ...overrides,
  };
}

describe("describeAuditLogEntry", () => {
  it("프로젝트 생성을 설명한다", () => {
    expect(describeAuditLogEntry(entry({ action: "project.created", metadata: { name: "Demo" } })))
      .toBe("프로젝트 'Demo'을 만들었습니다.");
  });

  it("멤버 추가를 설명한다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.member_added",
      metadata: { email: "member@example.com", role: "viewer" },
    }))).toBe("member@example.com을 조회자로 추가했습니다.");
  });

  it("역할 변경을 설명한다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.member_role_updated",
      metadata: { email: "member@example.com", beforeRole: "viewer", afterRole: "admin" },
    }))).toBe("member@example.com의 역할을 조회자에서 관리자로 변경했습니다.");
  });

  it("멤버 제거를 설명한다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.member_removed",
      metadata: { email: "member@example.com", role: "admin" },
    }))).toBe("member@example.com(관리자)을 제거했습니다.");
  });

  it("접근 거부를 리소스 이름으로 설명한다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.access_denied",
      metadata: { resourceType: "project_members" },
    }))).toBe("멤버 목록 접근이 거부되었습니다.");
  });

  it("모르는 리소스는 코드를 그대로 보여준다", () => {
    expect(describeAuditLogEntry(entry({
      action: "project.access_denied",
      metadata: { resourceType: "future_resource" },
    }))).toBe("future_resource 접근이 거부되었습니다.");
  });
});

describe("describeAuditLogEntry project.updated", () => {
  const updated = (before: unknown, after: unknown) =>
    describeAuditLogEntry(entry({ action: "project.updated", metadata: { before, after } }));

  it("이름 변경을 덧붙인다", () => {
    expect(updated(
      { name: "Old", allowedDomains: ["https://a.example.com"] },
      { name: "New", allowedDomains: ["https://a.example.com"] },
    )).toBe("프로젝트 설정을 변경했습니다. 이름을 'Old'에서 'New'로 바꿈");
  });

  it("도메인 개수 변경을 덧붙인다", () => {
    expect(updated(
      { name: "Same", allowedDomains: ["https://a.example.com"] },
      { name: "Same", allowedDomains: ["https://a.example.com", "https://b.example.com"] },
    )).toBe("프로젝트 설정을 변경했습니다. 허용 도메인 1개에서 2개로 변경");
  });

  it("개수가 같고 내용만 바뀌면 도메인 변경만 덧붙인다", () => {
    expect(updated(
      { name: "Same", allowedDomains: ["https://a.example.com"] },
      { name: "Same", allowedDomains: ["https://b.example.com"] },
    )).toBe("프로젝트 설정을 변경했습니다. 허용 도메인 변경");
  });

  it("이름과 도메인이 모두 그대로면 상세를 덧붙이지 않는다", () => {
    expect(updated(
      { name: "Same", allowedDomains: ["https://a.example.com"] },
      { name: "Same", allowedDomains: ["https://a.example.com"] },
    )).toBe("프로젝트 설정을 변경했습니다.");
  });

  it("이름과 도메인이 모두 바뀌면 둘 다 덧붙인다", () => {
    expect(updated(
      { name: "Old", allowedDomains: ["https://a.example.com"] },
      { name: "New", allowedDomains: [] },
    )).toBe("프로젝트 설정을 변경했습니다. 이름을 'Old'에서 'New'로 바꿈, 허용 도메인 1개에서 0개로 변경");
  });
});

describe("describeAuditLogEntry fallback", () => {
  it("모르는 action 은 코드와 metadata JSON 으로 보여준다", () => {
    expect(describeAuditLogEntry(entry({ action: "project.future_thing", metadata: { a: 1 } })))
      .toBe('project.future_thing {"a":1}');
  });

  it("metadata 에 기대한 키가 없어도 예외를 던지지 않는다", () => {
    expect(() => describeAuditLogEntry(entry({ action: "project.member_added", metadata: {} })))
      .not.toThrow();
    expect(() => describeAuditLogEntry(entry({ action: "project.updated", metadata: {} })))
      .not.toThrow();
    expect(() => describeAuditLogEntry(entry({ action: "project.created", metadata: {} })))
      .not.toThrow();
  });
});

describe("describeAuditLogActor", () => {
  it("이름과 이메일이 있으면 둘 다 보여준다", () => {
    expect(describeAuditLogActor(entry({
      actor: { adminUserId: "admin_1", email: "owner@example.com", name: "Owner" },
    }))).toBe("Owner · owner@example.com");
  });

  it("이메일만 있으면 이메일만 보여준다", () => {
    expect(describeAuditLogActor(entry({
      actor: { adminUserId: "admin_1", email: "owner@example.com" },
    }))).toBe("owner@example.com");
  });

  it("adminUserId 만 있으면 그것을 보여준다", () => {
    expect(describeAuditLogActor(entry({ actor: { adminUserId: "admin_gone" } })))
      .toBe("admin_gone");
  });

  it("actor 가 없으면 시스템으로 보여준다", () => {
    expect(describeAuditLogActor(entry())).toBe("시스템");
  });
});

describe("ProjectAuditLogPage", () => {
  function renderPage(
    overrides: Partial<React.ComponentProps<typeof ProjectAuditLogPage>> = {},
  ) {
    return render(
      <ProjectAuditLogPage
        projectId="proj_demo"
        entries={[entry()]}
        hasMore={false}
        onBack={() => undefined}
        onLoadMore={() => undefined}
        {...overrides}
      />,
    );
  }

  it("시각을 UTC 로 표시하고 열 제목에 밝힌다", () => {
    renderPage();
    expect(screen.getByText("시각 (UTC)")).toBeInTheDocument();
    expect(screen.getByText("2026-08-31 01:23")).toBeInTheDocument();
  });

  it("행위자와 내용을 함께 보여준다", () => {
    renderPage({
      entries: [entry({ actor: { adminUserId: "admin_1", email: "owner@example.com", name: "Owner" } })],
    });
    expect(screen.getByText("Owner · owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("프로젝트 'Demo'을 만들었습니다.")).toBeInTheDocument();
  });

  it("hasMore 가 참일 때만 더 보기 버튼을 보여준다", () => {
    renderPage({ hasMore: false });
    expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
    cleanup();
    renderPage({ hasMore: true });
    expect(screen.getByRole("button", { name: "더 보기" })).toBeInTheDocument();
  });

  it("더 보기 클릭이 onLoadMore 를 호출한다", () => {
    const onLoadMore = vi.fn();
    renderPage({ hasMore: true, onLoadMore });
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("loadingMore 면 더 보기가 disabled 이고 불러오는 중을 보여준다", () => {
    renderPage({ hasMore: true, loadingMore: true });
    expect(screen.getByRole("button", { name: "불러오는 중" })).toBeDisabled();
  });

  it("첫 로드 중에는 불러오는 중만 보여주고 빈 목록 문구를 감춘다", () => {
    renderPage({ entries: [], loading: true });
    expect(screen.getByText("불러오는 중")).toBeInTheDocument();
    expect(screen.queryByText("활동 이력이 없습니다.")).not.toBeInTheDocument();
  });

  it("로드가 끝나고 이력이 없으면 안내를 보여준다", () => {
    renderPage({ entries: [] });
    expect(screen.getByText("활동 이력이 없습니다.")).toBeInTheDocument();
  });

  it("오류 문구를 보여준다", () => {
    renderPage({ error: "활동 이력을 불러오지 못했습니다." });
    expect(screen.getByText("활동 이력을 불러오지 못했습니다.")).toBeInTheDocument();
  });

  it("첫 로드가 실패하면 오류만 보여주고 빈 목록 문구는 감춘다", () => {
    renderPage({ entries: [], error: "활동 이력을 불러오지 못했습니다." });
    expect(screen.getByText("활동 이력을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByText("활동 이력이 없습니다.")).not.toBeInTheDocument();
  });

  it("이력이 없으면 열 제목을 감춘다", () => {
    renderPage({ entries: [] });
    expect(screen.queryByText("시각 (UTC)")).not.toBeInTheDocument();
  });

  it("뒤로가기 클릭이 onBack 을 호출한다", () => {
    const onBack = vi.fn();
    renderPage({ onBack });
    fireEvent.click(screen.getByRole("button", { name: "설정으로 돌아가기" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
