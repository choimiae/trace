import type { ReplayConfig } from "@trace/shared";
import { isSafeMaskSelector, MAX_MASK_SELECTORS } from "@trace/shared/recording-limits";
import { useEffect, useState } from "react";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Field } from "../ui/Field.js";

export interface ProjectSettingsViewModel {
  projectId: string;
  name: string;
  allowedDomains: string[];
  replay: ReplayConfig;
}

interface ProjectSettingsPageProps {
  project: ProjectSettingsViewModel;
  onBack: () => void;
  onSave: (input: { name: string; allowedDomains: string[]; replay: ReplayConfig }) => void;
  saving?: boolean;
  error?: string | undefined;
  savedMessage?: string | undefined;
}

export function ProjectSettingsPage({
  project,
  onBack,
  onSave,
  saving = false,
  error,
  savedMessage,
}: ProjectSettingsPageProps) {
  const [name, setName] = useState(project.name);
  const [domains, setDomains] = useState(project.allowedDomains.join("\n"));
  const [replayEnabled, setReplayEnabled] = useState(project.replay.enabled);
  const [maskSelectors, setMaskSelectors] = useState(project.replay.maskSelectors.join("\n"));
  const [successDismissed, setSuccessDismissed] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDomains(project.allowedDomains.join("\n"));
    setReplayEnabled(project.replay.enabled);
    setMaskSelectors(project.replay.maskSelectors.join("\n"));
  }, [project.projectId, project.name, project.allowedDomains, project.replay]);

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

  const handleReplayEnabledChange = (value: boolean) => {
    setReplayEnabled(value);
    setSuccessDismissed(true);
  };

  const handleMaskSelectorsChange = (value: string) => {
    setMaskSelectors(value);
    setSuccessDismissed(true);
  };

  const allowedDomains = domains
    .split("\n")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);
  const parsedMaskSelectors = maskSelectors
    .split("\n")
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0);
  // 서버가 거절할 값을 저장 버튼 앞에서 잡는다. 400 을 받고 나서야 알면
  // 어느 줄이 문제인지 화면이 말해 줄 수 없다.
  const maskSelectorError = replayEnabled
    ? describeMaskSelectorError(maskSelectors)
    : undefined;
  const canSave =
    !saving &&
    name.trim().length > 0 &&
    allowedDomains.length > 0 &&
    maskSelectorError === undefined;

  return (
    <main className="app-shell settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>프로젝트 설정</h1>
          <p className="settings-subtitle">{project.projectId}</p>
        </div>
        <div className="header-actions">
          <Button onClick={onBack}>대시보드로 돌아가기</Button>
        </div>
      </header>

      <Card as="section" className="settings-panel">
        <Field
          id="settings-project-name"
          label="프로젝트 이름"
          value={name}
          onChange={handleNameChange}
          disabled={saving}
        />
        <Field
          id="settings-allowed-domains"
          label="허용 도메인"
          value={domains}
          onChange={handleDomainsChange}
          multiline
          rows={5}
          disabled={saving}
          hint="한 줄에 하나의 URL을 입력합니다."
          error={error}
        />
        <div className="replay-field">
          <label className="replay-toggle" htmlFor="settings-replay-enabled">
            <input
              id="settings-replay-enabled"
              type="checkbox"
              checked={replayEnabled}
              disabled={saving}
              onChange={(event) => handleReplayEnabledChange(event.target.checked)}
            />
            세션 리플레이 켜기
          </label>
        </div>

        {replayEnabled ? (
          <>
            <div className="replay-warning" role="note">
              <p>
                켜지면 화면 전체가 기록됩니다. 입력값·이메일·휴대폰은 가려지지만 인라인 style 의
                data: URI, title·aria-label 같은 속성, URL 쿼리스트링은 그대로 저장됩니다.
                사람 이름처럼 패턴이 없는 것은 아래 셀렉터로 지정해야 합니다.
              </p>
              {/* README 로 링크하지 않는다. self-hosted 라 이 화면은 저장소 주소를 모른다. */}
              <details className="replay-gaps">
                <summary>가리지 못하는 것 전체 보기</summary>
                <ul>
                  <li>인라인 style 안의 data: URI — 서명·신분증 이미지가 base64 로 남습니다</li>
                  <li>
                    셀렉터로 지정한 요소의 title·aria-label·data-* 속성 — 셀렉터는 텍스트에만
                    걸립니다
                  </li>
                  <li>iframe 의 srcdoc 속성에 적어 둔 마크업</li>
                  <li>radio·checkbox 의 값, 패턴이 없는 입력 텍스트</li>
                  <li>src·href 의 쿼리스트링 — 토큰이나 퍼센트 인코딩된 이메일이 남습니다</li>
                  <li>class·id 에 박힌 개인정보</li>
                </ul>
              </details>
            </div>
            <Field
              id="settings-mask-selectors"
              label={`마스킹 셀렉터 (한 줄에 하나, 최대 ${MAX_MASK_SELECTORS}개)`}
              value={maskSelectors}
              onChange={handleMaskSelectorsChange}
              multiline
              rows={4}
              disabled={saving}
              error={maskSelectorError}
            />
          </>
        ) : null}

        <div className="settings-actions">
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() =>
              onSave({
                name: name.trim(),
                allowedDomains,
                // 켜져 있든 아니든 항상 보낸다. 생략하면 store 가 기존 설정을
                // 유지해서, 화면에서 끈 것이 저장되지 않는다.
                replay: { enabled: replayEnabled, maskSelectors: parsedMaskSelectors },
              })
            }
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

// 줄 번호는 사용자가 보는 그대로 센다 - 빈 줄을 걸러내기 전의 원본 기준이다.
function describeMaskSelectorError(source: string): string | undefined {
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    const selector = line.trim();
    if (selector.length === 0) continue;
    if (!isSafeMaskSelector(selector)) {
      return `${index + 1}번째 줄은 셀렉터로 쓸 수 없습니다. CSS 선택자만 적습니다.`;
    }
  }

  const count = lines.filter((line) => line.trim().length > 0).length;
  if (count > MAX_MASK_SELECTORS) {
    return `셀렉터는 최대 ${MAX_MASK_SELECTORS}개까지 지정할 수 있습니다. 지금 ${count}개입니다.`;
  }

  return undefined;
}
