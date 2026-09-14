import { describe, expect, it } from "vitest";
import { maskText, redactEventText, stripDataUris, TRANSPARENT_PLACEHOLDER } from "./mask.js";

// maskText 는 rrweb 이 "운영자 셀렉터에 걸린 노드" 에만 부르는 콜백이다
// (rrweb 2.0.0-alpha.4 실측: needMaskingText 가 참일 때만, 인자 1개로).
// 그러므로 여기서 할 일은 패턴 치환이 아니라 전부 가리는 것이다 - 운영자가
// 가리라고 지정한 노드이기 때문이다.
describe("maskText", () => {
  // 예전에는 여기서 redactPatterns 를 돌렸다. 그러면 패턴 없는 이름이 그대로
  // 통과해, 운영자가 셀렉터를 지정했는데도 아무것도 가려지지 않았다 -
  // rrweb 기본 동작(전부 *)보다 나쁜 결과였다.
  it("패턴이 없는 사람 이름도 전부 가린다", () => {
    expect(maskText("최미애")).toBe("***");
  });

  it("이메일·휴대폰도 남기지 않는다", () => {
    expect(maskText("choi@example.com")).toBe("****************");
    expect(maskText("010-1234-5678")).toBe("*************");
  });

  // 공백은 남긴다 - rrweb 기본값과 같은 모양이라 재생 레이아웃이 원본과
  // 어긋나지 않는다.
  it("공백 모양을 보존한다", () => {
    expect(maskText("최 미애")).toBe("* **");
  });

  // 재생은 화면 본문의 길이를 그대로 보여준다. 자르면 원본과 다른 화면이 된다.
  it("긴 본문을 자르지 않는다", () => {
    expect(maskText("가".repeat(400))).toHaveLength(400);
  });

  it("빈 문자열에서 터지지 않는다", () => {
    expect(maskText("")).toBe("");
  });
});

// 셀렉터에 걸리지 않은 노드의 텍스트는 maskTextFn 에 도달조차 하지 않는다.
// 그 텍스트를 패턴으로 거르는 것이 이 함수의 일이다. 속성값도 같은 이유로 훑는다 -
// needMaskingText 는 텍스트 노드만 게이트하므로 title·aria-label 은 그대로 나간다.
describe("redactEventText", () => {
  const ids = () => new Set<number>();

  it("직렬화된 텍스트 노드의 이메일을 지운다", () => {
    const snapshot = {
      type: 2,
      data: { node: { childNodes: [{ type: 3, textContent: "문의 hong@example.com" }] } },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.childNodes[0]!.textContent).toBe("문의 [redacted]");
  });

  it("mutation 으로 추가되는 노드의 텍스트도 훑는다", () => {
    const mutation = {
      type: 3,
      data: { source: 0, adds: [{ node: { type: 3, textContent: "010-1234-5678" } }] },
    };

    redactEventText(mutation, ids());

    expect(mutation.data.adds[0]!.node.textContent).toBe("[redacted]");
  });

  it("texts[].value 의 텍스트도 훑는다", () => {
    const mutation = {
      type: 3,
      data: { source: 0, texts: [{ id: 7, value: "담당 lee@example.com" }], adds: [] },
    };

    redactEventText(mutation, ids());

    expect(mutation.data.texts[0]!.value).toBe("담당 [redacted]");
  });

  it("style 텍스트 노드는 건드리지 않는다", () => {
    const snapshot = {
      type: 2,
      data: { node: { childNodes: [{ type: 3, isStyle: true, textContent: ".a{z-index:999999999}" }] } },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.childNodes[0]!.textContent).toBe(".a{z-index:999999999}");
  });

  // rrweb 의 characterData 관찰자는 style 텍스트를 isStyle 표시 없이 texts[] 로
  // 낸다. 스냅샷에서 본 style 텍스트 노드의 id 를 기억해 두지 않으면 여기서
  // CSS 가 [redacted] 로 깨진다(실측: ".b{z-index:[redacted]}").
  it("제자리에서 바뀐 style 텍스트도 건드리지 않는다", () => {
    const styleIds = ids();
    const snapshot = {
      type: 2,
      data: { node: { childNodes: [{ type: 3, isStyle: true, id: 18, textContent: ".a{}" }] } },
    };
    redactEventText(snapshot, styleIds);

    const mutation = {
      type: 3,
      data: { source: 0, texts: [{ id: 18, value: ".b{z-index:888888888}" }], adds: [] },
    };
    redactEventText(mutation, styleIds);

    expect(mutation.data.texts[0]!.value).toBe(".b{z-index:888888888}");
  });

  it("나중에 붙은 style 의 텍스트 변경도 건드리지 않는다", () => {
    const styleIds = ids();
    const added = {
      type: 3,
      data: {
        source: 0,
        adds: [{ node: { type: 3, isStyle: true, id: 42, textContent: ".c{}" } }],
      },
    };
    redactEventText(added, styleIds);

    const mutation = {
      type: 3,
      data: { source: 0, texts: [{ id: 42, value: ".d{width:123456789}" }], adds: [] },
    };
    redactEventText(mutation, styleIds);

    expect(mutation.data.texts[0]!.value).toBe(".d{width:123456789}");
  });

  // style 이 아닌 텍스트 노드는 계속 훑어야 한다 - 위 예외가 너무 넓으면 안 된다.
  it("style 이 아닌 id 의 texts 는 계속 훑는다", () => {
    const styleIds = ids();
    redactEventText(
      { type: 2, data: { node: { childNodes: [{ type: 3, isStyle: true, id: 18 }] } } },
      styleIds,
    );

    const mutation = {
      type: 3,
      data: { source: 0, texts: [{ id: 19, value: "담당 lee@example.com" }], adds: [] },
    };
    redactEventText(mutation, styleIds);

    expect(mutation.data.texts[0]!.value).toBe("담당 [redacted]");
  });

  // --- 속성값 (라운드 2) ---

  it("사용자 텍스트를 담는 속성값을 훑는다", () => {
    const snapshot = {
      type: 2,
      data: {
        node: {
          type: 2,
          tagName: "a",
          attributes: {
            title: "홍길동 hong@example.com",
            "aria-label": "연락처 010-1234-5678",
            alt: "주문 987654321",
            placeholder: "you@example.com",
            "data-owner": "kim@example.com",
          },
        },
      },
    };

    redactEventText(snapshot, ids());

    const attributes = snapshot.data.node.attributes;
    expect(attributes.title).toBe("홍길동 [redacted]");
    expect(attributes["aria-label"]).toBe("연락처 [redacted]");
    expect(attributes.alt).toBe("주문 [redacted]");
    expect(attributes.placeholder).toBe("[redacted]");
    expect(attributes["data-owner"]).toBe("[redacted]");
  });

  it("mutation 의 속성 변경도 훑는다", () => {
    const mutation = {
      type: 3,
      data: {
        source: 0,
        attributes: [{ id: 3, attributes: { title: "담당 lee@example.com" } }],
        texts: [],
      },
    };

    redactEventText(mutation, ids());

    expect(mutation.data.attributes[0]!.attributes.title).toBe("담당 [redacted]");
  });

  // option 의 value 는 속성으로만 실려 온다 - rrweb 의 입력 마스킹은
  // input·textarea·select 태그에만 걸리고 option 에는 닿지 않는다.
  it("option 의 value 속성도 훑는다", () => {
    const snapshot = {
      data: { node: { type: 2, tagName: "option", attributes: { value: "secret@example.com" } } },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.attributes.value).toBe("[redacted]");
  });

  // CSS 에는 9자리 이상 숫자가 흔하다. 여기에 패턴을 돌리면 스타일이 깨진다.
  it("style 속성과 _cssText 는 건드리지 않는다", () => {
    const snapshot = {
      data: {
        node: {
          type: 2,
          tagName: "div",
          attributes: { style: "width:123456789px", _cssText: ".a{z-index:999999999}" },
        },
      },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.attributes.style).toBe("width:123456789px");
    expect(snapshot.data.node.attributes._cssText).toBe(".a{z-index:999999999}");
  });

  // stripDataUris 가 이미 책임지는 속성이다. 여기서 또 만지면 긴 숫자를 담은
  // 자산 경로(/img/1234567890.jpg)가 깨져 재생 화면이 원본과 달라진다.
  it("src·srcset·href 는 건드리지 않는다", () => {
    const snapshot = {
      data: {
        node: {
          type: 2,
          tagName: "img",
          attributes: {
            src: "/img/1234567890.jpg",
            srcset: "/img/1234567890.jpg 2x",
            href: "/orders/987654321",
          },
        },
      },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.attributes.src).toBe("/img/1234567890.jpg");
    expect(snapshot.data.node.attributes.srcset).toBe("/img/1234567890.jpg 2x");
    expect(snapshot.data.node.attributes.href).toBe("/orders/987654321");
  });

  // href 예외의 구멍이었다 - mailto:·tel: 은 PII 를 그대로 싣는데 경로처럼
  // 생기지 않아서, 이 둘만 훑으면 긴 숫자를 깨뜨릴 위험 없이 막을 수 있다.
  it("mailto: href 의 이메일을 지운다", () => {
    const snapshot = {
      data: { node: { type: 2, tagName: "a", attributes: { href: "mailto:hong@example.com" } } },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.attributes.href).toBe("mailto:[redacted]");
  });

  it("tel: href 의 전화번호를 지운다", () => {
    const snapshot = {
      data: { node: { type: 2, tagName: "a", attributes: { href: "tel:010-1234-5678" } } },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.attributes.href).toBe("tel:[redacted]");
  });

  it("대문자 스킴과 국가번호 형태도 지운다", () => {
    const snapshot = {
      data: {
        node: {
          type: 2,
          tagName: "a",
          attributes: { href: "MAILTO:Hong@Example.com", "data-alt": "tel:+82-10-1234-5678" },
        },
      },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.attributes.href).toBe("MAILTO:[redacted]");
    // 숫자는 전부 사라진다. 앞의 "+" 하나가 남는 것은 공용 PHONE_PATTERN 의
    // 선행 \b 가 ":" 와 "+" 사이에 설 수 없어서다 - 자릿수는 남지 않으므로
    // 유출은 아니고, 그 정규식은 이벤트 파이프라인 전체가 함께 쓰는 것이라
    // 여기서 바꾸지 않는다.
    expect(snapshot.data.node.attributes["data-alt"]).toBe("tel:+[redacted]");
    expect(snapshot.data.node.attributes["data-alt"]).not.toContain("1234");
  });

  it("mailto·tel 이 아닌 스킴의 href 는 그대로 둔다", () => {
    const snapshot = {
      data: {
        node: {
          type: 2,
          tagName: "a",
          attributes: { href: "https://shop.example.com/orders/987654321" },
        },
      },
    };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.attributes.href).toBe("https://shop.example.com/orders/987654321");
  });

  it("민감하지 않은 본문은 그대로 둔다", () => {
    const snapshot = { data: { node: { type: 3, textContent: "주문 내역" } } };

    redactEventText(snapshot, ids());

    expect(snapshot.data.node.textContent).toBe("주문 내역");
  });

  it("null 과 원시값에서 터지지 않는다", () => {
    expect(() => redactEventText(null, ids())).not.toThrow();
    expect(() => redactEventText(42, ids())).not.toThrow();
    expect(() => redactEventText([null, { textContent: null }], ids())).not.toThrow();
  });

  it("깊은 중첩에서도 스택 오버플로 없이 끝까지 훑는다", () => {
    const DEPTH = 50_000;
    const leaf: { textContent: string } = { textContent: "hong@example.com" };
    let root: unknown = leaf;
    for (let i = 0; i < DEPTH; i++) {
      root = { child: root };
    }

    expect(() => redactEventText(root, ids())).not.toThrow();
    expect(leaf.textContent).toBe("[redacted]");
  });
});

describe("stripDataUris", () => {
  it("스냅샷 트리 안쪽의 data: 이미지를 자리표시자로 바꾼다", () => {
    const snapshot = {
      type: 2,
      data: {
        node: {
          childNodes: [
            { tagName: "img", attributes: { src: "data:image/png;base64,AAAA", alt: "로고" } },
            { tagName: "img", attributes: { src: "/static/logo.png" } },
          ],
        },
      },
    };

    stripDataUris(snapshot);

    const nodes = snapshot.data.node.childNodes;
    expect(nodes[0]!.attributes.src).toBe(TRANSPARENT_PLACEHOLDER);
    expect(nodes[0]!.attributes.alt).toBe("로고");
    expect(nodes[1]!.attributes.src).toBe("/static/logo.png");
  });

  // 스냅샷만 훑으면 새어 나간다. 페이지가 나중에 붙이는 노드도 같은 base64 를 싣는다.
  it("mutation 으로 추가되는 노드도 훑는다", () => {
    const mutation = {
      type: 3,
      data: { source: 0, adds: [{ node: { tagName: "img", attributes: { srcset: "data:image/gif;base64,BBBB 2x" } } }] },
    };

    stripDataUris(mutation);

    expect(mutation.data.adds[0]!.node.attributes.srcset).toBe(TRANSPARENT_PLACEHOLDER);
  });

  it("data: href 는 빈 값으로 만든다", () => {
    const event = { data: { node: { tagName: "link", attributes: { href: "data:text/css,body{}" } } } };

    stripDataUris(event);

    expect(event.data.node.attributes.href).toBe("");
  });

  it("null 과 원시값에서 터지지 않는다", () => {
    expect(() => stripDataUris(null)).not.toThrow();
    expect(() => stripDataUris(42)).not.toThrow();
    expect(() => stripDataUris([null, { attributes: null }])).not.toThrow();
  });

  // srcset 은 콤마로 구분된 후보 목록이다. 시작 앵커 패턴은 두 번째 이후
  // 후보의 data: 를 놓친다 - 정확히 이 새어 나감을 막으려고 srcset 을
  // STRIPPED_ATTRIBUTES 에 넣은 것이므로 실제로 걸러야 한다.
  it("srcset 두 번째 후보가 data: 여도 전체를 자리표시자로 바꾼다", () => {
    const event = {
      data: {
        node: { tagName: "img", attributes: { srcset: "thumb.jpg 1x, data:image/png;base64,AAAA 2x" } },
      },
    };

    stripDataUris(event);

    expect(event.data.node.attributes.srcset).toBe(TRANSPARENT_PLACEHOLDER);
  });

  // rrweb 의 emit 콜백 안에서, 고객 페이지가 만든 임의 깊이의 트리를 훑는다.
  // 재귀는 깊이만큼 네이티브 스택을 먹으므로 깊은 트리에서 RangeError 로
  // 죽을 수 있다 - 죽으면 그 이벤트의 마스킹이 통째로 스킵된다.
  it("깊은 중첩에서도 스택 오버플로 없이 끝까지 훑는다", () => {
    const DEPTH = 50_000;
    const leaf: { attributes: { src: string } } = { attributes: { src: "data:image/png;base64,AAAA" } };
    let root: unknown = leaf;
    for (let i = 0; i < DEPTH; i++) {
      root = { child: root };
    }

    expect(() => stripDataUris(root)).not.toThrow();
    expect(leaf.attributes.src).toBe(TRANSPARENT_PLACEHOLDER);
  });
});
