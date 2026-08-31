import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSettingsPage } from "./ProjectSettingsPage.js";

expect.extend(matchers);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ownerProject = {
  projectId: "proj_demo",
  name: "Demo",
  allowedDomains: ["https://demo.example.com", "https://app.example.com"],
  role: "owner" as const,
};

const members = [
  {
    adminUserId: "admin_owner",
    email: "owner@example.com",
    name: "Owner",
    role: "owner" as const,
    createdAt: "2026-08-25T00:00:00.000Z",
  },
  {
    adminUserId: "admin_viewer",
    email: "viewer@example.com",
    role: "viewer" as const,
    createdAt: "2026-08-26T00:00:00.000Z",
  },
];

function renderRequiredProps(
  overrides: Partial<React.ComponentProps<typeof ProjectSettingsPage>> = {},
) {
  return render(
    <ProjectSettingsPage
      project={ownerProject}
      members={members}
      currentAdminUserId="admin_owner"
      onBack={() => undefined}
      onSave={() => undefined}
      onAddMember={() => undefined}
      onUpdateMemberRole={() => undefined}
      onRemoveMember={() => undefined}
      {...overrides}
    />,
  );
}

const missingMemberProps = (
  // @ts-expect-error ProjectSettingsPage requires member data and an add handler.
  <ProjectSettingsPage
    project={ownerProject}
    onBack={() => undefined}
    onSave={() => undefined}
  />
);
void missingMemberProps;

describe("ProjectSettingsPage", () => {
  it("renders editable project settings for owners", () => {
    renderRequiredProps();

    expect(screen.getByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
    expect(screen.getByText("소유자", { selector: ".user-email" })).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toHaveValue("Demo");
    expect(screen.getByLabelText("허용 도메인")).toHaveValue(
      "https://demo.example.com\nhttps://app.example.com",
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("submits trimmed name and line-separated domains", () => {
    const onSave = vi.fn();
    renderRequiredProps({ onSave });

    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "  New Demo  " } });
    fireEvent.change(screen.getByLabelText("허용 도메인"), {
      target: { value: "https://new.example.com\n\nhttps://app.example.com  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "New Demo",
      allowedDomains: ["https://new.example.com", "https://app.example.com"],
    });
  });

  it("allows admins to save project settings", () => {
    const onSave = vi.fn();
    renderRequiredProps({ project: { ...ownerProject, role: "admin" }, onSave });

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(screen.getByText("관리자")).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith({
      name: "Demo",
      allowedDomains: ["https://demo.example.com", "https://app.example.com"],
    });
  });

  it("disables saving when required fields are empty", () => {
    renderRequiredProps();

    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("renders viewer settings as read-only", () => {
    renderRequiredProps({ project: { ...ownerProject, role: "viewer" } });

    expect(screen.getByText("읽기 전용 권한입니다.")).toBeInTheDocument();
    expect(screen.getByText("조회자", { selector: ".user-email" })).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toBeDisabled();
    expect(screen.getByLabelText("허용 도메인")).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("shows save state messages", () => {
    renderRequiredProps({ error: "프로젝트 설정 값이 올바르지 않습니다.", savedMessage: "저장했습니다." });

    expect(screen.getByText("프로젝트 설정 값이 올바르지 않습니다.")).toBeInTheDocument();
    expect(screen.getByText("저장했습니다.")).toBeInTheDocument();
  });

  it("저장한 필드를 다시 수정하면 성공 메시지를 숨긴다", () => {
    renderRequiredProps({ savedMessage: "저장했습니다." });

    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "새 프로젝트" } });

    expect(screen.queryByText("저장했습니다.")).not.toBeInTheDocument();
  });

  it("renders project members and owner add form", () => {
    renderRequiredProps();

    expect(screen.getByRole("heading", { name: "멤버" })).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("viewer@example.com")).toBeInTheDocument();
    expect(screen.getByText("조회자", { selector: ".member-meta span" })).toBeInTheDocument();
    expect(screen.getByLabelText("멤버 이메일")).toBeInTheDocument();
    expect(screen.getByLabelText("멤버 역할")).toHaveValue("viewer");
    expect(screen.getByRole("button", { name: "멤버 추가" })).toBeDisabled();
  });

  it("submits a member email and selected role", () => {
    const onAddMember = vi.fn();
    renderRequiredProps({ onAddMember });

    fireEvent.change(screen.getByLabelText("멤버 이메일"), { target: { value: " New@Example.com " } });
    fireEvent.change(screen.getByLabelText("멤버 역할"), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "멤버 추가" }));

    expect(onAddMember).toHaveBeenCalledWith({ email: "New@Example.com", role: "admin" });
  });

  it("renders non-owner member management as read-only", () => {
    renderRequiredProps({ project: { ...ownerProject, role: "admin" } });

    expect(screen.getByText("멤버 추가 권한이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByLabelText("멤버 이메일")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "멤버 추가" })).not.toBeInTheDocument();
  });

  it("shows member add state messages", () => {
    renderRequiredProps({
      memberError: "이미 이 프로젝트의 멤버입니다.",
      memberSavedMessage: "멤버를 추가했습니다.",
    });

    expect(screen.getByText("이미 이 프로젝트의 멤버입니다.")).toBeInTheDocument();
    expect(screen.getByText("멤버를 추가했습니다.")).toBeInTheDocument();
  });

  it("renders owner-only member row actions", () => {
    renderRequiredProps();

    expect(screen.getByLabelText("owner@example.com 역할")).toHaveValue("owner");
    expect(screen.getByLabelText("viewer@example.com 역할")).toHaveValue("viewer");
    expect(screen.getAllByRole("button", { name: "제거" })).toHaveLength(2);
  });

  it("hides member row actions from admins and viewers", () => {
    const { rerender } = renderRequiredProps({ project: { ...ownerProject, role: "admin" } });

    expect(screen.queryByLabelText("owner@example.com 역할")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "제거" })).not.toBeInTheDocument();

    rerender(
      <ProjectSettingsPage
        project={{ ...ownerProject, role: "viewer" }}
        members={members}
        currentAdminUserId="admin_owner"
        onBack={() => undefined}
        onSave={() => undefined}
        onAddMember={() => undefined}
        onUpdateMemberRole={() => undefined}
        onRemoveMember={() => undefined}
      />,
    );

    expect(screen.queryByLabelText("owner@example.com 역할")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "제거" })).not.toBeInTheDocument();
  });

  it("calls onUpdateMemberRole when owner changes a role select", () => {
    const onUpdateMemberRole = vi.fn();
    renderRequiredProps({ onUpdateMemberRole });

    fireEvent.change(screen.getByLabelText("viewer@example.com 역할"), { target: { value: "admin" } });

    expect(onUpdateMemberRole).toHaveBeenCalledWith("admin_viewer", "admin");
  });

  it("does not call onRemoveMember when the owner cancels removal confirmation", () => {
    const onRemoveMember = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderRequiredProps({ onRemoveMember });

    fireEvent.click(screen.getAllByRole("button", { name: "제거" })[1]!);

    expect(onRemoveMember).not.toHaveBeenCalled();
  });

  it("calls onRemoveMember after removal confirmation", () => {
    const onRemoveMember = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderRequiredProps({ onRemoveMember });

    fireEvent.click(screen.getAllByRole("button", { name: "제거" })[1]!);

    expect(onRemoveMember).toHaveBeenCalledWith("admin_viewer");
  });

  it("disables controls for the member action in flight", () => {
    renderRequiredProps({ memberActionInFlight: "admin_viewer" });

    expect(screen.getByLabelText("viewer@example.com 역할")).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "제거" })[1]).toBeDisabled();
  });

  it("disables self owner loss controls", () => {
    renderRequiredProps({
      members: [
        ...members,
        {
          adminUserId: "admin_second_owner",
          email: "second-owner@example.com",
          role: "owner",
          createdAt: "2026-08-27T00:00:00.000Z",
        },
      ],
    });

    const ownerRole = screen.getByLabelText("owner@example.com 역할");
    expect(screen.getAllByRole("button", { name: "제거" })[0]).toBeDisabled();
    expect(ownerRole.querySelector('option[value="admin"]')).toBeDisabled();
    expect(ownerRole.querySelector('option[value="viewer"]')).toBeDisabled();
    expect(ownerRole).toHaveValue("owner");
  });

  it("disables last owner loss controls", () => {
    renderRequiredProps();

    expect(screen.getAllByRole("button", { name: "제거" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "제거" })[1]).toBeEnabled();
    const ownerRole = screen.getByLabelText("owner@example.com 역할");
    expect(ownerRole.querySelector('option[value="admin"]')).toBeDisabled();
    expect(ownerRole.querySelector('option[value="viewer"]')).toBeDisabled();
  });

  it("renders member action error and success messages", () => {
    renderRequiredProps({
      memberActionError: "멤버 역할을 변경하지 못했습니다.",
      memberActionSavedMessage: "멤버 역할을 변경했습니다.",
    });

    expect(screen.getByText("멤버 역할을 변경하지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByText("멤버 역할을 변경했습니다.")).toBeInTheDocument();
  });
});
