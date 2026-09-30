import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_MASK_SELECTORS } from "@trace/shared/recording-limits";
import { ProjectSettingsPage } from "./ProjectSettingsPage.js";

expect.extend(matchers);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseProject = {
  projectId: "proj_demo",
  name: "Demo",
  allowedDomains: ["https://demo.example.com", "https://app.example.com"],
  replay: { enabled: false, maskSelectors: [] },
};

function renderRequiredProps(
  overrides: Partial<React.ComponentProps<typeof ProjectSettingsPage>> = {},
) {
  return render(
    <ProjectSettingsPage
      project={baseProject}
      onBack={() => undefined}
      onSave={() => undefined}
      {...overrides}
    />,
  );
}

describe("ProjectSettingsPage", () => {
  it("멤버 관리 영역을 보여주지 않는다", () => {
    renderRequiredProps();
    expect(screen.queryByText(/멤버/)).not.toBeInTheDocument();
    expect(screen.queryByText(/활동 이력/)).not.toBeInTheDocument();
  });

  it("renders editable project settings", () => {
    renderRequiredProps();

    expect(screen.getByRole("heading", { name: "프로젝트 설정" })).toBeInTheDocument();
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
      replay: { enabled: false, maskSelectors: [] },
    });
  });

  it("disables saving when required fields are empty", () => {
    renderRequiredProps();

    fireEvent.change(screen.getByLabelText("프로젝트 이름"), { target: { value: "" } });

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

  it("리플레이를 켜면 경고와 마스킹 셀렉터 입력이 나타난다", () => {
    renderRequiredProps();

    expect(screen.queryByLabelText(/마스킹 셀렉터/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("세션 리플레이 켜기"));

    expect(screen.getByLabelText(/마스킹 셀렉터/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("화면 전체가 기록됩니다");
  });

  it("저장이 리플레이 설정을 함께 보낸다", () => {
    const onSave = vi.fn();
    renderRequiredProps({ onSave });

    fireEvent.click(screen.getByLabelText("세션 리플레이 켜기"));
    fireEvent.change(screen.getByLabelText(/마스킹 셀렉터/), {
      target: { value: ".customer-name\n\n  [data-pii]  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "Demo",
      allowedDomains: ["https://demo.example.com", "https://app.example.com"],
      replay: { enabled: true, maskSelectors: [".customer-name", "[data-pii]"] },
    });
  });

  it("쓸 수 없는 문자가 섞인 셀렉터는 저장을 막고 이유를 보여준다", () => {
    renderRequiredProps();

    fireEvent.click(screen.getByLabelText("세션 리플레이 켜기"));
    fireEvent.change(screen.getByLabelText(/마스킹 셀렉터/), {
      target: { value: ".ok\n.bad{color:red}" },
    });

    expect(screen.getByText(/2번째 줄/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("셀렉터가 상한을 넘으면 저장을 막고 몇 개인지 알려준다", () => {
    renderRequiredProps();

    fireEvent.click(screen.getByLabelText("세션 리플레이 켜기"));
    fireEvent.change(screen.getByLabelText(/마스킹 셀렉터/), {
      target: {
        value: Array.from({ length: MAX_MASK_SELECTORS + 1 }, (_, index) => `.pii-${index}`).join("\n"),
      },
    });

    expect(screen.getByText(`셀렉터는 최대 ${MAX_MASK_SELECTORS}개까지 지정할 수 있습니다. 지금 ${MAX_MASK_SELECTORS + 1}개입니다.`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("다른 프로젝트로 바뀌면 리플레이 설정을 다시 읽는다", () => {
    const { rerender } = renderRequiredProps();

    expect(screen.getByLabelText("세션 리플레이 켜기")).not.toBeChecked();

    rerender(
      <ProjectSettingsPage
        project={{
          ...baseProject,
          projectId: "proj_other",
          replay: { enabled: true, maskSelectors: [".customer-name"] },
        }}
        onBack={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByLabelText("세션 리플레이 켜기")).toBeChecked();
    expect(screen.getByLabelText(/마스킹 셀렉터/)).toHaveValue(".customer-name");
  });

  it("리플레이를 켜면 이전 저장 성공 메시지를 숨긴다", () => {
    renderRequiredProps({ savedMessage: "저장했습니다." });

    fireEvent.click(screen.getByLabelText("세션 리플레이 켜기"));

    expect(screen.queryByText("저장했습니다.")).not.toBeInTheDocument();
  });

  it("마스킹 셀렉터를 고치면 이전 저장 성공 메시지를 숨긴다", () => {
    renderRequiredProps({
      project: { ...baseProject, replay: { enabled: true, maskSelectors: [] } },
      savedMessage: "저장했습니다.",
    });

    fireEvent.change(screen.getByLabelText(/마스킹 셀렉터/), {
      target: { value: ".customer-name" },
    });

    expect(screen.queryByText("저장했습니다.")).not.toBeInTheDocument();
  });

  it("저장 중에는 리플레이 항목을 잠근다", () => {
    renderRequiredProps({
      project: { ...baseProject, replay: { enabled: true, maskSelectors: [] } },
      saving: true,
    });

    expect(screen.getByLabelText("세션 리플레이 켜기")).toBeDisabled();
    expect(screen.getByLabelText(/마스킹 셀렉터/)).toBeDisabled();
  });

  // 회귀 방지 장치다. 끄기와 함께 셀렉터가 지워지면 다시 켤 때 운영자가
  // 지정해 둔 것을 잃는다.
  it("리플레이를 꺼도 지정해 둔 셀렉터는 그대로 저장한다", () => {
    const onSave = vi.fn();
    renderRequiredProps({
      project: { ...baseProject, replay: { enabled: true, maskSelectors: [".customer-name"] } },
      onSave,
    });

    fireEvent.click(screen.getByLabelText("세션 리플레이 켜기"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        replay: { enabled: false, maskSelectors: [".customer-name"] },
      }),
    );
  });

  it("경고 안에서 가리지 못하는 것 목록을 펼쳐 볼 수 있다", () => {
    renderRequiredProps({
      project: { ...baseProject, replay: { enabled: true, maskSelectors: [] } },
    });

    const disclosure = screen.getByText("가리지 못하는 것 전체 보기");
    expect(disclosure).toBeInTheDocument();

    const items = within(disclosure.closest("details") as HTMLElement).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("인라인 style"),
        expect.stringContaining("srcdoc"),
        expect.stringContaining("쿼리스트링"),
      ]),
    );
  });
});
