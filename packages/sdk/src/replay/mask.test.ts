import { describe, expect, it } from "vitest";
import { maskText, stripDataUris, TRANSPARENT_PLACEHOLDER } from "./mask.js";

describe("maskText", () => {
  it("이메일·휴대폰·9자리 이상 숫자를 지운다", () => {
    expect(maskText("문의 choi@example.com / 010-1234-5678")).toBe("문의 [redacted] / [redacted]");
  });

  // 재생은 화면 본문을 그대로 보여준다. 자르면 원본과 다른 화면이 된다.
  it("긴 본문을 자르지 않는다", () => {
    const long = "가".repeat(400);
    expect(maskText(long)).toBe(long);
  });

  // 정직하게 남는 구멍이다. 패턴이 없는 이름은 운영자가 셀렉터로 지정해야 가려진다.
  it("패턴 없는 사람 이름은 통과한다 — 운영자 셀렉터의 몫이다", () => {
    expect(maskText("최미애")).toBe("최미애");
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
});
