import { useState } from "react";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";

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

      <Field id="project-name" label="프로젝트 이름" value={name} onChange={setName} placeholder="내 사이트" />

      <Field
        id="allowed-domains"
        label="허용 도메인"
        value={domains}
        onChange={setDomains}
        placeholder="http://localhost:5174"
        hint="이 프로젝트의 이벤트를 받을 사이트 주소입니다. 여러 개면 쉼표로 구분합니다."
        error={error}
      />

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
