import { Button } from "../ui/Button.js";

export function InstallPage({
  projectId,
  snippet,
  eventsSeen,
  onContinue,
}: {
  projectId: string;
  snippet: string;
  eventsSeen: number;
  onContinue: () => void;
}) {
  const arrived = eventsSeen > 0;

  return (
    <main className="app-shell auth-state">
      <p className="eyebrow">Trace 관리자</p>
      <h1>스크립트를 붙여주세요.</h1>
      <p>
        사이트의 <code>&lt;head&gt;</code>에 아래 한 줄을 붙이면 수집이 시작됩니다.
      </p>

      <pre className="install-snippet">{snippet}</pre>

      <p className="install-status">
        {arrived ? "첫 이벤트가 도착했습니다." : "아직 이벤트를 기다리고 있습니다."}
      </p>

      <Button variant="primary" onClick={onContinue}>
        {arrived ? "대시보드 보기" : "대시보드로 이동"}
      </Button>

      <p className="install-note">
        프로젝트 ID는 <code>{projectId}</code>입니다. 동의 배너를 쓰는 사이트는{" "}
        <code>data-consent="pending"</code>을 추가하고 <code>window.trace.consent.grant()</code>로
        수집을 시작하세요.
      </p>
    </main>
  );
}
