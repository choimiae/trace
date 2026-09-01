import { useEffect, useState, type FormEvent } from "react";
import type {
  AddProjectMemberInput,
  ProjectMemberCandidateResponse,
  ProjectMemberResponse,
  ProjectRole,
} from "../api.js";
import { formatKoreanDateTime } from "../time.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Field } from "../ui/Field.js";

export interface ProjectSettingsViewModel {
  projectId: string;
  name: string;
  allowedDomains: string[];
  role: "owner" | "admin" | "viewer";
}

interface ProjectSettingsPageProps {
  project: ProjectSettingsViewModel;
  members: ProjectMemberResponse[];
  onBack: () => void;
  onSave: (input: { name: string; allowedDomains: string[] }) => void;
  onAddMember: (input: AddProjectMemberInput) => void;
  currentAdminUserId: string;
  memberCandidates: ProjectMemberCandidateResponse[];
  memberCandidateSearchLoading?: boolean;
  memberCandidateSearchError?: string | undefined;
  selectedMemberCandidate?: ProjectMemberCandidateResponse | undefined;
  onSearchMemberCandidates: (query: string) => void;
  onSelectMemberCandidate: (candidate: ProjectMemberCandidateResponse) => void;
  memberActionsInFlight?: ReadonlySet<string> | undefined;
  memberActionError?: string | undefined;
  memberActionSavedMessage?: string | undefined;
  onUpdateMemberRole: (adminUserId: string, role: ProjectRole) => void;
  onRemoveMember: (adminUserId: string) => void;
  saving?: boolean;
  addingMember?: boolean;
  error?: string | undefined;
  savedMessage?: string | undefined;
  memberError?: string | undefined;
  memberSavedMessage?: string | undefined;
  onShowAuditLog?: (() => void) | undefined;
}

export function ProjectSettingsPage({
  project,
  members,
  onBack,
  onSave,
  onAddMember,
  currentAdminUserId,
  memberCandidates,
  memberCandidateSearchLoading = false,
  memberCandidateSearchError,
  selectedMemberCandidate,
  onSearchMemberCandidates,
  onSelectMemberCandidate,
  memberActionsInFlight,
  memberActionError,
  memberActionSavedMessage,
  onUpdateMemberRole,
  onRemoveMember,
  saving = false,
  addingMember = false,
  error,
  savedMessage,
  memberError,
  memberSavedMessage,
  onShowAuditLog,
}: ProjectSettingsPageProps) {
  const [name, setName] = useState(project.name);
  const [domains, setDomains] = useState(project.allowedDomains.join("\n"));
  const [successDismissed, setSuccessDismissed] = useState(false);
  const [memberCandidateQuery, setMemberCandidateQuery] = useState("");
  const [memberRole, setMemberRole] = useState<AddProjectMemberInput["role"]>("viewer");
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

  const handleAddMemberSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedMemberCandidate) return;
    onAddMember({ email: selectedMemberCandidate.email, role: memberRole });
  };

  const allowedDomains = domains
    .split("\n")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
  const canSave = !readOnly && !saving && name.trim().length > 0 && allowedDomains.length > 0;
  const ownerCount = members.filter((member) => member.role === "owner").length;

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

      <Card className="settings-panel members-panel">
        <div className="panel-heading">
          <h2>멤버</h2>
        </div>
        <div className="members-list">
          {members.map((member) => {
            const actionBusy = memberActionsInFlight?.has(member.adminUserId) ?? false;
            const isSelf = member.adminUserId === currentAdminUserId;
            const isLastOwner = member.role === "owner" && ownerCount === 1;
            const ownerLossDisabled = member.role === "owner" && (isSelf || isLastOwner);
            const removeDisabled = actionBusy || isSelf || isLastOwner;

            return (
              <div className="member-row" key={member.adminUserId}>
                <div>
                  <strong>{member.name !== undefined ? member.name : member.email}</strong>
                  {member.name ? <span>{member.email}</span> : null}
                </div>
                <div className="member-meta">
                  <span>{roleLabel(member.role)}</span>
                  <span>{formatKoreanDateTime(member.createdAt)}</span>
                </div>
                {project.role === "owner" ? (
                  <div className="member-row-actions">
                    <label className="sr-only" htmlFor={`member-role-${member.adminUserId}`}>
                      {member.email} 역할
                    </label>
                    <select
                      id={`member-role-${member.adminUserId}`}
                      value={member.role}
                      disabled={actionBusy}
                      onChange={(event) => {
                        const nextRole = event.target.value as ProjectRole;
                        if (nextRole !== member.role) {
                          onUpdateMemberRole(member.adminUserId, nextRole);
                        }
                      }}
                    >
                      <option value="owner">소유자</option>
                      <option value="admin" disabled={ownerLossDisabled}>관리자</option>
                      <option value="viewer" disabled={ownerLossDisabled}>조회자</option>
                    </select>
                    <Button
                      variant="secondary"
                      aria-label={`${member.email} 제거`}
                      disabled={removeDisabled}
                      onClick={() => {
                        if (window.confirm("이 멤버를 프로젝트에서 제거할까요?")) {
                          onRemoveMember(member.adminUserId);
                        }
                      }}
                    >
                      제거
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {memberActionSavedMessage ? <span className="settings-success">{memberActionSavedMessage}</span> : null}
        {memberActionError ? <p className="field-error">{memberActionError}</p> : null}
        {project.role === "owner" ? (
          <form className="member-add-form" onSubmit={handleAddMemberSubmit}>
            <Field
              id="settings-member-search"
              label="멤버 검색"
              value={memberCandidateQuery}
              onChange={(value) => {
                setMemberCandidateQuery(value);
                onSearchMemberCandidates(value);
              }}
              disabled={addingMember}
              hint="이름 또는 이메일로 검색"
            />
            {memberCandidateSearchLoading ? <p className="settings-subtitle">검색 중</p> : null}
            {memberCandidateSearchError ? <p className="field-error">{memberCandidateSearchError}</p> : null}
            {!memberCandidateSearchLoading && memberCandidates.length === 0 ? (
              <p className="settings-subtitle">검색 결과가 없습니다.</p>
            ) : null}
            <div className="member-candidate-list">
              {memberCandidates.map((candidate) => {
                const alreadyMember = candidate.membership !== undefined;
                const selected = selectedMemberCandidate?.adminUserId === candidate.adminUserId;

                return (
                  <button
                    type="button"
                    key={candidate.adminUserId}
                    className="member-candidate-row"
                    aria-pressed={selected}
                    disabled={alreadyMember || addingMember}
                    onClick={() => onSelectMemberCandidate(candidate)}
                  >
                    <span className="member-candidate-identity">
                      {candidate.name !== undefined ? <strong>{candidate.name}</strong> : null}
                      <span>{candidate.email}</span>
                    </span>
                    <span className="member-candidate-status">{candidateStatusLabel(candidate)}</span>
                  </button>
                );
              })}
            </div>
            {selectedMemberCandidate ? (
              <p className="member-candidate-selected">
                선택됨: {selectedMemberCandidate.name !== undefined
                  ? `${selectedMemberCandidate.name} · ${selectedMemberCandidate.email}`
                  : selectedMemberCandidate.email}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="settings-member-role">멤버 역할</label>
              <select
                id="settings-member-role"
                value={memberRole}
                onChange={(event) => setMemberRole(event.target.value as AddProjectMemberInput["role"])}
                disabled={addingMember}
              >
                <option value="viewer">조회자</option>
                <option value="admin">관리자</option>
              </select>
            </div>
            <div className="settings-actions">
              <Button variant="primary" type="submit" disabled={addingMember || !selectedMemberCandidate}>
                {addingMember ? "추가 중" : "멤버 추가"}
              </Button>
              {memberSavedMessage ? <span className="settings-success">{memberSavedMessage}</span> : null}
            </div>
            {memberError ? <p className="field-error">{memberError}</p> : null}
          </form>
        ) : (
          <p className="settings-subtitle">멤버 추가 권한이 없습니다.</p>
        )}
        {project.role === "owner" && onShowAuditLog ? (
          <div className="settings-actions">
            <Button onClick={onShowAuditLog}>활동 이력</Button>
          </div>
        ) : null}
      </Card>
    </main>
  );
}

function candidateStatusLabel(candidate: ProjectMemberCandidateResponse): string {
  return candidate.membership === undefined
    ? "추가 가능"
    : `이미 멤버 · ${roleLabel(candidate.membership.role)}`;
}

function roleLabel(role: ProjectSettingsViewModel["role"]): string {
  if (role === "owner") return "소유자";
  if (role === "admin") return "관리자";
  return "조회자";
}
