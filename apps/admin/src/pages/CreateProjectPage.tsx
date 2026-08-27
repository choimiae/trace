import { useState } from "react";
import { Button } from "../ui/Button.js";

export function CreateProjectPage({
  onCreate,
  error,
}: {
  onCreate: (input: { name: string; allowedDomains: string[] }) => void;
  error?: string | undefined;
}) {
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");

  const submit = () => {
    const allowedDomains = domains
      .split(",")
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);

    onCreate({ name: name.trim(), allowedDomains });
  };

  return (
    <main className="app-shell auth-state">
      <p className="eyebrow">Trace 관리자</p>
      <h1>첫 프로젝트를 만들어주세요.</h1>
      <p>프로젝트를 만들면 사이트에 붙일 스크립트를 알려드립니다.</p>

      <label className="field" htmlFor="project-name">
        프로젝트 이름
        <input
          id="project-name"
          type="text"
          value={name}
          placeholder="내 사이트"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      {/* 힌트를 label 안에 두면 접근 가능한 이름에 힌트 문구까지 붙어 라벨이
          "허용 도메인" 으로 조회되지 않는다. 밖으로 빼고 aria-describedby 로 잇는다. */}
      <div className="field">
        <label htmlFor="allowed-domains">허용 도메인</label>
        <input
          id="allowed-domains"
          type="text"
          value={domains}
          placeholder="http://localhost:5174"
          aria-describedby="allowed-domains-hint"
          onChange={(event) => setDomains(event.target.value)}
        />
        <span className="field-hint" id="allowed-domains-hint">
          이 프로젝트의 이벤트를 받을 사이트 주소입니다. 여러 개면 쉼표로 구분합니다.
        </span>
      </div>

      {error ? <p className="field-error">{error}</p> : null}

      <Button
        variant="primary"
        disabled={name.trim().length === 0 || domains.trim().length === 0}
        onClick={submit}
      >
        프로젝트 만들기
      </Button>
    </main>
  );
}
