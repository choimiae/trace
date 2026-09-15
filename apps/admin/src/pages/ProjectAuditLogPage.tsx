import type { ProjectAuditLogEntryResponse } from "../api.js";
import { formatKoreanDateTime } from "../time.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

const RESOURCE_LABELS: Record<string, string> = {
  project_settings: "프로젝트 설정",
  project_members: "멤버 목록",
  project_member_candidates: "멤버 후보 검색",
  project_audit_logs: "활동 이력",
  project_summary: "대시보드 요약",
  project_issues: "문제 목록",
  issue_detail: "문제 상세",
  session_timeline: "세션 타임라인",
  page_stats: "페이지 통계",
};

function readString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function readSettings(
  metadata: Record<string, unknown>,
  key: "before" | "after",
): {
  name?: string;
  allowedDomains?: unknown[];
  replay?: { enabled?: boolean; maskSelectors?: unknown[] };
} | undefined {
  const value = metadata[key];
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : undefined;
  const allowedDomains = Array.isArray(record.allowedDomains) ? record.allowedDomains : undefined;
  const replay = readReplay(record.replay);
  return {
    ...(name === undefined ? {} : { name }),
    ...(allowedDomains === undefined ? {} : { allowedDomains }),
    ...(replay === undefined ? {} : { replay }),
  };
}

// 리플레이가 붙기 전의 기록에는 이 키가 없다. 없는 것과 꺼진 것은 다르므로
// undefined 를 false 로 메우지 않는다.
function readReplay(
  value: unknown,
): { enabled?: boolean; maskSelectors?: unknown[] } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const enabled = typeof record.enabled === "boolean" ? record.enabled : undefined;
  const maskSelectors = Array.isArray(record.maskSelectors) ? record.maskSelectors : undefined;
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(maskSelectors === undefined ? {} : { maskSelectors }),
  };
}

function roleLabel(role: string | undefined): string {
  if (role === "owner") return "소유자";
  if (role === "admin") return "관리자";
  if (role === "viewer") return "조회자";
  return role ?? "알 수 없는 역할";
}

function describeSettingsChange(metadata: Record<string, unknown>): string {
  const before = readSettings(metadata, "before");
  const after = readSettings(metadata, "after");
  if (before === undefined || after === undefined) return "";

  const details: string[] = [];
  if (before.name !== after.name) {
    details.push(`이름을 '${before.name ?? ""}'에서 '${after.name ?? ""}'로 바꿈`);
  }

  const beforeCount = before.allowedDomains?.length;
  const afterCount = after.allowedDomains?.length;
  if (beforeCount !== undefined && afterCount !== undefined) {
    if (beforeCount !== afterCount) {
      details.push(`허용 도메인 ${beforeCount}개에서 ${afterCount}개로 변경`);
    } else if (
      JSON.stringify(before.allowedDomains) !== JSON.stringify(after.allowedDomains)
    ) {
      details.push("허용 도메인 변경");
    }
  }

  const beforeReplay = before.replay;
  const afterReplay = after.replay;
  if (beforeReplay !== undefined && afterReplay !== undefined) {
    if (beforeReplay.enabled !== afterReplay.enabled && afterReplay.enabled !== undefined) {
      details.push(`세션 리플레이를 ${afterReplay.enabled ? "켬" : "끔"}`);
    }

    const beforeSelectors = beforeReplay.maskSelectors?.length;
    const afterSelectors = afterReplay.maskSelectors?.length;
    if (
      beforeSelectors !== undefined &&
      afterSelectors !== undefined &&
      beforeSelectors !== afterSelectors
    ) {
      details.push(`마스킹 셀렉터 ${beforeSelectors}개에서 ${afterSelectors}개로 변경`);
    }
  }

  return details.length === 0 ? "" : ` ${details.join(", ")}`;
}

export function describeAuditLogEntry(entry: ProjectAuditLogEntryResponse): string {
  const { metadata } = entry;

  if (entry.action === "project.created") {
    return `프로젝트 '${readString(metadata, "name") ?? ""}'을 만들었습니다.`;
  }
  if (entry.action === "project.updated") {
    return `프로젝트 설정을 변경했습니다.${describeSettingsChange(metadata)}`;
  }
  if (entry.action === "project.member_added") {
    return `${readString(metadata, "email") ?? ""}을 ${roleLabel(readString(metadata, "role"))}로 추가했습니다.`;
  }
  if (entry.action === "project.member_role_updated") {
    const before = roleLabel(readString(metadata, "beforeRole"));
    const after = roleLabel(readString(metadata, "afterRole"));
    return `${readString(metadata, "email") ?? ""}의 역할을 ${before}에서 ${after}로 변경했습니다.`;
  }
  if (entry.action === "project.member_removed") {
    return `${readString(metadata, "email") ?? ""}(${roleLabel(readString(metadata, "role"))})을 제거했습니다.`;
  }
  if (entry.action === "project.access_denied") {
    const resourceType = readString(metadata, "resourceType") ?? "";
    return `${RESOURCE_LABELS[resourceType] ?? resourceType} 접근이 거부되었습니다.`;
  }

  // 서버가 새 action 을 추가해도 화면이 비어 보이지 않게 한다.
  return `${entry.action} ${JSON.stringify(metadata)}`;
}

export function describeAuditLogActor(entry: ProjectAuditLogEntryResponse): string {
  if (entry.actor === undefined) return "시스템";
  if (entry.actor.email === undefined) return entry.actor.adminUserId;
  return entry.actor.name === undefined
    ? entry.actor.email
    : `${entry.actor.name} · ${entry.actor.email}`;
}

export interface ProjectAuditLogPageProps {
  projectId: string;
  entries: ProjectAuditLogEntryResponse[];
  hasMore: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | undefined;
  onBack: () => void;
  onLoadMore: () => void;
}

export function ProjectAuditLogPage({
  projectId,
  entries,
  hasMore,
  loading = false,
  loadingMore = false,
  error,
  onBack,
  onLoadMore,
}: ProjectAuditLogPageProps) {
  return (
    <main className="app-shell settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>활동 이력</h1>
          <p className="settings-subtitle">{projectId}</p>
        </div>
        <div className="header-actions">
          <Button onClick={onBack}>설정으로 돌아가기</Button>
        </div>
      </header>

      <Card as="section" className="settings-panel">
        {entries.length > 0 ? (
          <div className="audit-log-head">
            <span>시각 (KST)</span>
            <span>행위자</span>
            <span>내용</span>
          </div>
        ) : null}
        <div className="audit-log-list">
          {entries.map((entry) => (
            <div className="audit-log-row" key={entry.auditLogId}>
              <span className="audit-log-time">{formatKoreanDateTime(entry.createdAt)}</span>
              <span className="audit-log-actor">{describeAuditLogActor(entry)}</span>
              <span className="audit-log-detail">{describeAuditLogEntry(entry)}</span>
            </div>
          ))}
        </div>
        {loading ? <p className="settings-subtitle">불러오는 중</p> : null}
        {!loading && entries.length === 0 && error === undefined ? (
          <p className="settings-subtitle">활동 이력이 없습니다.</p>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
        {hasMore ? (
          <div className="settings-actions">
            <Button disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "불러오는 중" : "더 보기"}
            </Button>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
