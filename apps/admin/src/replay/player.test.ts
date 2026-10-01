import { expect, it, vi } from "vitest";

// Replayer 는 jsdom 에서 돌지 않는다. 생성 옵션만 본다.
const { constructed } = vi.hoisted(() => ({ constructed: [] as unknown[] }));
vi.mock("rrweb", () => ({
  Replayer: class {
    wrapper = document.createElement("div");
    constructor(_events: unknown[], config: unknown) {
      constructed.push(config);
    }
    on() {}
    addEvent() {}
    play() {}
    pause() {}
    setConfig() {}
    destroy() {}
  },
}));
vi.mock("rrweb/dist/rrweb.css", () => ({}));

const { createPlayer } = await import("./player.js");

it("쉬는 구간을 건너뛰며 재생한다", () => {
  const mount = document.createElement("div");

  createPlayer(mount, []);

  expect(constructed[0]).toMatchObject({ root: mount, skipInactive: true });
});
