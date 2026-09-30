import { isSafeElementSelectorHash } from "@trace/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { getElementMetadata } from "./dom.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("getElementMetadata", () => {
  it("returns safe button metadata", () => {
    document.body.innerHTML = `<button id="invite">멤버 초대</button>`;
    const button = document.querySelector("button")!;

    expect(getElementMetadata(button)).toMatchObject({
      elementRole: "button",
      elementTextMaskedOrLimited: "멤버 초대",
    });
  });

  it("does not expose input values", () => {
    document.body.innerHTML = `<input id="email" type="email" value="choi@example.com" />`;
    const input = document.querySelector("input")!;

    expect(getElementMetadata(input).elementTextMaskedOrLimited).toBeUndefined();
  });

  it("자손에 contenteditable 이 있으면 그 요소의 텍스트를 담지 않는다", () => {
    // textContent 는 자손을 포함한다. isTextEntryElement 는 요소 자신과 조상만
    // 보므로, 화이트리스트 요소 안에 편집 가능 자손이 있으면 그 안의 글자가
    // textContent 를 통해 새어 나간다.
    document.body.innerHTML = `<h1>고객 상세 <span contenteditable="true">김철수 010-1111-2222 메모</span></h1>`;
    const heading = document.querySelector("h1")!;

    expect(getElementMetadata(heading).elementTextMaskedOrLimited).toBeUndefined();
  });

  it("자손에 textarea 가 있으면 그 요소의 텍스트를 담지 않는다", () => {
    document.body.innerHTML = `<a href="/x"><span>행 열기</span><textarea>서울시 성동구 어딘가</textarea></a>`;
    const link = document.querySelector("a")!;

    expect(getElementMetadata(link).elementTextMaskedOrLimited).toBeUndefined();
  });
});

describe("요소 지문", () => {
  function render(html: string): void {
    document.body.innerHTML = html;
  }

  function hashOf(selector: string): string {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`요소를 찾지 못했다: ${selector}`);
    return getElementMetadata(element).elementSelectorHash!;
  }

  it("구조가 다른 버튼은 지문이 갈린다", () => {
    render(`
      <main>
        <form><button type="submit" id="save">저장</button></form>
        <div class="button-group">
          <button id="export">리포트 내보내기</button>
        </div>
      </main>
    `);

    expect(hashOf("#save")).not.toBe(hashOf("#export"));
  });

  it("id·role·속성이 없어도 조상 구조가 다르면 갈린다", () => {
    render(`
      <main>
        <form><button>저장</button></form>
        <div><button>리포트 내보내기</button></div>
      </main>
    `);

    const [inForm, inDiv] = Array.from(document.querySelectorAll("button"));
    expect(getElementMetadata(inForm!).elementSelectorHash).not.toBe(
      getElementMetadata(inDiv!).elementSelectorHash,
    );
  });

  // 안정 속성은 하나씩 못박는다. 두 속성을 동시에 바꾸는 테스트 하나로는 둘 중
  // 어느 쪽을 STABLE_ATTRIBUTES 에서 지워도 여전히 통과한다.
  it("data-trace-id 만 달라도 갈린다", () => {
    render(`
      <main><div>
        <button data-trace-id="settings-save">저장</button>
        <button data-trace-id="settings-cancel">저장</button>
      </div></main>
    `);

    const [save, cancel] = Array.from(document.querySelectorAll("button"));
    expect(getElementMetadata(save!).elementSelectorHash).not.toBe(
      getElementMetadata(cancel!).elementSelectorHash,
    );
  });

  it("data-testid 만 달라도 갈린다", () => {
    render(`
      <main><div>
        <button data-testid="save-button">저장</button>
        <button data-testid="cancel-button">저장</button>
      </div></main>
    `);

    const [save, cancel] = Array.from(document.querySelectorAll("button"));
    expect(getElementMetadata(save!).elementSelectorHash).not.toBe(
      getElementMetadata(cancel!).elementSelectorHash,
    );
  });

  it("name 만 달라도 갈린다", () => {
    render(`
      <main><div>
        <input type="text" name="workspaceName" />
        <input type="text" name="ownerName" />
      </div></main>
    `);

    const [workspace, owner] = Array.from(document.querySelectorAll("input"));
    expect(getElementMetadata(workspace!).elementSelectorHash).not.toBe(
      getElementMetadata(owner!).elementSelectorHash,
    );
  });

  it("type 만 달라도 갈린다", () => {
    render(`
      <main><div>
        <input type="text" name="owner" />
        <input type="email" name="owner" />
      </div></main>
    `);

    const [text, email] = Array.from(document.querySelectorAll("input"));
    expect(getElementMetadata(text!).elementSelectorHash).not.toBe(
      getElementMetadata(email!).elementSelectorHash,
    );
  });

  it("목록 행처럼 구조·속성이 같은 반복 컨트롤은 하나의 요소로 유지된다", () => {
    render(`
      <main><table><tbody>
        <tr><td><button class="row-3">삭제</button></td></tr>
        <tr><td><button class="row-5">삭제</button></td></tr>
      </tbody></table></main>
    `);

    expect(hashOf(".row-3")).toBe(hashOf(".row-5"));
  });

  // 다음 두 테스트가 ANCESTOR_DEPTH 를 정확히 3 에 못박는다. 하나만 있으면 깊이를
  // 1 로 줄이거나 10 으로 늘려도 전부 통과한다. 10 은 spec 위반이다 — 페이지
  // 껍데기(body>main>...)가 지문을 지배해 판별력이 떨어진다.
  it("조상 4단에서만 다른 두 요소는 지문을 공유한다", () => {
    render(`
      <main><div><section><span><button class="in-main">저장</button></span></section></div></main>
      <aside><div><section><span><button class="in-aside">저장</button></span></section></div></aside>
    `);

    // 조상 사슬은 양쪽 모두 div>section>span 이고, main/aside 는 4단이라 밖이다.
    expect(hashOf(".in-main")).toBe(hashOf(".in-aside"));
  });

  it("조상 3단에서 다른 두 요소는 지문이 갈린다", () => {
    render(`
      <main><div><span><button class="in-main">저장</button></span></div></main>
      <aside><div><span><button class="in-aside">저장</button></span></div></aside>
    `);

    // 조상 사슬이 main>div>span 과 aside>div>span 으로 갈린다.
    expect(hashOf(".in-main")).not.toBe(hashOf(".in-aside"));
  });

  it("콜론을 포함한 생성 id 는 지문에 넣지 않는다", () => {
    render(`<main><div><button id=":r1:">저장</button></div></main>`);
    const first = hashOf("#\\:r1\\:");

    render(`<main><div><button id=":r7:">저장</button></div></main>`);
    const second = hashOf("#\\:r7\\:");

    expect(first).toBe(second);
  });

  it("콜론 없는 id 는 지문에 계속 반영된다", () => {
    render(`<main><div><button id="save">저장</button></div></main>`);
    const withId = hashOf("#save");

    render(`<main><div><button>저장</button></div></main>`);
    const withoutId = getElementMetadata(document.querySelector("button")!).elementSelectorHash;

    expect(withId).not.toBe(withoutId);
  });

  it("지문은 항상 16 hex 이고 계약을 통과한다", () => {
    render(`<main><div><button id="save">저장</button></div></main>`);
    const hash = hashOf("#save");

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(isSafeElementSelectorHash(hash)).toBe(true);
  });

  it("비정상적으로 긴 속성값이 지문을 통째로 지배하지 않는다", () => {
    const long = "x".repeat(500);
    render(`<main><div>
      <button name="${long}a">저장</button>
      <button name="${long}b">저장</button>
    </div></main>`);

    const [first, second] = Array.from(document.querySelectorAll("button"));
    // 64자에서 절단되므로 500자 뒤의 a/b 차이는 지문에 남지 않는다.
    expect(getElementMetadata(first!).elementSelectorHash).toBe(
      getElementMetadata(second!).elementSelectorHash,
    );
  });
});
