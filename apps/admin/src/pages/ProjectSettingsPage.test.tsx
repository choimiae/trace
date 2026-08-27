import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSettingsPage } from "./ProjectSettingsPage.js";

expect.extend(matchers);
afterEach(cleanup);

const ownerProject = {
  projectId: "proj_demo",
  name: "Demo",
  allowedDomains: ["https://demo.example.com", "https://app.example.com"],
  role: "owner" as const,
};

describe("ProjectSettingsPage", () => {
  it("renders editable project settings for owners", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
    expect(screen.getByText("소유자")).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toHaveValue("Demo");
    expect(screen.getByLabelText("허용 도메인")).toHaveValue(
      "https://demo.example.com\nhttps://app.example.com",
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("submits trimmed name and line-separated domains", () => {
    const onSave = vi.fn();
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={onSave}
      />,
    );

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
    render(
      <ProjectSettingsPage
        project={{ ...ownerProject, role: "admin" }}
        onBack={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(screen.getByText("관리자")).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith({
      name: "Demo",
      allowedDomains: ["https://demo.example.com", "https://app.example.com"],
    });
  });

  it("disables saving when required fields are empty", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("renders viewer settings as read-only", () => {
    render(
      <ProjectSettingsPage
        project={{ ...ownerProject, role: "viewer" }}
        onBack={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByText("읽기 전용 권한입니다.")).toBeInTheDocument();
    expect(screen.getByText("조회자")).toBeInTheDocument();
    expect(screen.getByLabelText("프로젝트 이름")).toBeDisabled();
    expect(screen.getByLabelText("허용 도메인")).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("shows save state messages", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={() => undefined}
        error="프로젝트 설정 값이 올바르지 않습니다."
        savedMessage="저장했습니다."
      />,
    );

    expect(screen.getByText("프로젝트 설정 값이 올바르지 않습니다.")).toBeInTheDocument();
    expect(screen.getByText("저장했습니다.")).toBeInTheDocument();
  });

  it("저장한 필드를 다시 수정하면 성공 메시지를 숨긴다", () => {
    render(
      <ProjectSettingsPage
        project={ownerProject}
        onBack={() => undefined}
        onSave={() => undefined}
        savedMessage="저장했습니다."
      />,
    );

    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "새 프로젝트" } });

    expect(screen.queryByText("저장했습니다.")).not.toBeInTheDocument();
  });
});
