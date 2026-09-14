// 진짜 rrweb 을 물려 배선 전체를 확인한다.
//
// index.test.ts 는 rrweb 을 모킹해 "어떤 설정으로 부르는가" 를 보고, 여기서는
// "그 설정으로 실제로 무엇이 나가는가" 를 본다. 이 파일이 따로 있는 이유는
// 마스킹이 rrweb 내부 동작(maskTextFn 을 언제·어떤 인자로 부르는가)에
// 달려 있어서 모킹으로는 검증 자체가 불가능하기 때문이다 - 옆자리 Task 12 가
// 네 라운드를 초록으로 통과하고도 결함이 살아 있던 이유가 실패하는 모양을
// 덮는 테스트가 없었다는 것이었다.
import { describe, expect, it, vi } from "vitest";
import { startReplay } from "./index.js";

const config = {
  projectId: "proj_1",
  sessionId: "sess_1",
  endpoint: "https://trace.example.com/v1/sessions/sess_1/recording",
  maskSelectors: [".customer-name", "td.amount"],
};

/** 페이지를 세우고, 분노 클릭으로 드레인해, 실제로 업로더에 넘어간 것을 돌려준다. */
function recordAndDrain(html: string): { payload: string; batches: unknown[][] } {
  const batches: unknown[][] = [];
  const uploader = {
    enqueue: vi.fn((events: unknown[]) => {
      batches.push(events);
    }),
    flush: vi.fn(async () => true),
  };

  document.body.innerHTML = `${html}<button id="trigger">확인</button>`;
  const stop = startReplay(config, { uploader });

  const button = document.querySelector("#trigger")!;
  for (let index = 0; index < 3; index += 1) {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  stop();
  document.body.innerHTML = "";
  return { payload: JSON.stringify(batches[0] ?? []), batches };
}

describe("startReplay (진짜 rrweb)", () => {
  // 계획이 약속한 것: 운영자가 마스킹 셀렉터를 지정하면 패턴이 없는 PII 도 가려진다.
  // redactPatterns 는 사람 이름을 못 잡으므로, 여기서 통과하면 운영자가 지정한
  // 노드에 아무 마스킹도 걸리지 않았다는 뜻이다.
  it("운영자가 지정한 노드는 패턴이 없어도 통째로 가린다", () => {
    const { payload } = recordAndDrain('<div class="customer-name">홍길동</div>');

    expect(payload).not.toContain("홍길동");
  });

  it("운영자 셀렉터가 태그까지 적은 형태여도 가린다", () => {
    const { payload } = recordAndDrain("<table><tr><td class=\"amount\">1,250,000</td></tr></table>");

    expect(payload).not.toContain("1,250,000");
  });

  // mask.ts 가 약속한 것: 구조가 놓친 것을 패턴이 거른다. 셀렉터에 걸리지 않은
  // 노드의 텍스트는 rrweb 의 maskTextFn 에 도달조차 하지 않으므로, 직렬화된
  // 뒤에 한 번 더 훑지 않으면 그대로 나간다.
  it("셀렉터에 걸리지 않은 노드의 이메일도 지운다", () => {
    const { payload } = recordAndDrain('<div class="note">문의는 hong@example.com 으로</div>');

    expect(payload).not.toContain("hong@example.com");
  });

  it("셀렉터에 걸리지 않은 노드의 전화번호도 지운다", () => {
    const { payload } = recordAndDrain('<p>연락처 010-1234-5678</p>');

    expect(payload).not.toContain("010-1234-5678");
  });

  // 텍스트 노드가 정체성을 유지한 채 내용만 바뀌면 mutation 의 texts[].value 로
  // 실려 온다 - 스냅샷과는 다른 경로라 따로 막아야 한다.
  it("나중에 바뀐 텍스트의 이메일도 지운다", async () => {
    const batches: unknown[][] = [];
    const uploader = {
      enqueue: vi.fn((events: unknown[]) => {
        batches.push(events);
      }),
      flush: vi.fn(async () => true),
    };

    document.body.innerHTML = '<div class="note">준비 중</div><button id="trigger">확인</button>';
    const stop = startReplay(config, { uploader });

    const text = document.querySelector(".note")!.firstChild as Text;
    text.data = "담당자 lee@example.com";
    await new Promise((resolve) => setTimeout(resolve, 50));

    const button = document.querySelector("#trigger")!;
    for (let index = 0; index < 3; index += 1) {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    stop();
    document.body.innerHTML = "";

    expect(JSON.stringify(batches[0] ?? [])).not.toContain("lee@example.com");
  });

  // 과잉 마스킹도 결함이다 - 전부 지우면 재생 화면이 원본과 달라진다.
  it("민감하지 않은 본문은 그대로 남긴다", () => {
    const { payload } = recordAndDrain("<h1>주문 내역</h1>");

    expect(payload).toContain("주문 내역");
  });

  // 스펙 §6 이 가장 중요하다고 적은 항목을, 모킹 없이 네 조각이 배선된 채로 본다.
  it("트리거 전에는 아무것도 업로더에 넘기지 않는다", async () => {
    const uploader = { enqueue: vi.fn(), flush: vi.fn(async () => true) };

    document.body.innerHTML = '<div class="note">주문</div>';
    const stop = startReplay(config, { uploader });

    document.body.appendChild(document.createElement("p"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(uploader.enqueue).not.toHaveBeenCalled();
    expect(uploader.flush).not.toHaveBeenCalled();

    stop();
    document.body.innerHTML = "";
  });
});
