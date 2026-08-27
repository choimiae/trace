import { useEffect, useState } from "react";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Field } from "../ui/Field.js";

export interface ProjectSettingsViewModel {
  projectId: string;
  name: string;
  allowedDomains: string[];
  role: "owner" | "admin" | "viewer";
}

export function ProjectSettingsPage({
  project,
  onBack,
  onSave,
  saving = false,
  error,
  savedMessage,
}: {
  project: ProjectSettingsViewModel;
  onBack: () => void;
  onSave: (input: { name: string; allowedDomains: string[] }) => void;
  saving?: boolean;
  error?: string | undefined;
  savedMessage?: string | undefined;
}) {
  const [name, setName] = useState(project.name);
  const [domains, setDomains] = useState(project.allowedDomains.join("\n"));
  const [successDismissed, setSuccessDismissed] = useState(false);
  const readOnly = project.role === "viewer";

  useEffect(() => {
    setName(project.name);
    setDomains(project.allowedDomains.join("\n"));
  }, [project.projectId, project.name, project.allowedDomains]);

  // 새 저장 결과가 도착하면 성공 메시지를 다시 보여줄 수 있게 초기화한다.
  useEffect(() => {
    setSuccessDismissed(false);
  }, [savedMessage]);

  const handleNameChange = (value: string) => {
    setName(value);
    setSuccessDismissed(true);
  };

  const handleDomainsChange = (value: string) => {
    setDomains(value);
    setSuccessDismissed(true);
  };

  const allowedDomains = domains
    .split("\n")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
  const canSave = !readOnly && !saving && name.trim().length > 0 && allowedDomains.length > 0;

  return (
    <main className="app-shell settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>프로젝트 설정</h1>
          <p className="settings-subtitle">{project.projectId}</p>
        </div>
        <div className="header-actions">
          <span className="user-email">{roleLabel(project.role)}</span>
          <Button onClick={onBack}>대시보드로 돌아가기</Button>
        </div>
      </header>

      {readOnly ? <p className="settings-notice">읽기 전용 권한입니다.</p> : null}

      <Card as="section" className="settings-panel">
        <Field
          id="settings-project-name"
          label="프로젝트 이름"
          value={name}
          onChange={handleNameChange}
          disabled={readOnly || saving}
        />
        <Field
          id="settings-allowed-domains"
          label="허용 도메인"
          value={domains}
          onChange={handleDomainsChange}
          multiline
          rows={5}
          disabled={readOnly || saving}
          hint="한 줄에 하나의 URL을 입력합니다."
          error={error}
        />
        <div className="settings-actions">
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() => onSave({ name: name.trim(), allowedDomains })}
          >
            {saving ? "저장 중" : "저장"}
          </Button>
          {savedMessage && !successDismissed ? (
            <span className="settings-success">{savedMessage}</span>
          ) : null}
        </div>
      </Card>
    </main>
  );
}

function roleLabel(role: ProjectSettingsViewModel["role"]): string {
  if (role === "owner") return "소유자";
  if (role === "admin") return "관리자";
  return "조회자";
}
