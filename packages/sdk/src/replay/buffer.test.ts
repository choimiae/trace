import { describe, expect, it } from "vitest";
import { CheckpointBuffer, type RecordedEvent } from "./buffer.js";

const event = (timestamp: number): RecordedEvent => ({ type: 3, timestamp });
const snapshot = (timestamp: number): RecordedEvent => ({ type: 2, timestamp });

describe("CheckpointBuffer", () => {
  it("담은 순서대로 돌려준다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.push(event(2));
    buffer.push(event(3));

    expect(buffer.drain().map((item) => item.timestamp)).toEqual([1, 2, 3]);
  });

  // 세대 하나만 쥐면 체크포인트 직후에 난 문제는 앞 맥락이 0초가 된다.
  // 두 세대면 최소 2분, 최대 4분이 보장된다.
  it("두 세대를 쥐고 그 이전 세대를 버린다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.push(event(2));
    buffer.push(snapshot(3), true);
    buffer.push(event(4));
    buffer.push(snapshot(5), true);
    buffer.push(event(6));

    expect(buffer.drain().map((item) => item.timestamp)).toEqual([3, 4, 5, 6]);
  });

  it("drain 뒤에는 비어 있다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.drain();

    expect(buffer.size).toBe(0);
    expect(buffer.drain()).toEqual([]);
  });

  // 트리거 뒤에는 계속 이어 올린다. 이때도 세대를 버리면 아직 올리지 못한
  // 구간이 사라져 재생에 구멍이 생긴다.
  it("stopDiscarding 뒤에는 아무 세대도 버리지 않는다", () => {
    const buffer = new CheckpointBuffer();
    buffer.stopDiscarding();
    buffer.push(snapshot(1), true);
    buffer.push(snapshot(2), true);
    buffer.push(snapshot(3), true);

    expect(buffer.drain().map((item) => item.timestamp)).toEqual([1, 2, 3]);
  });

  // drain 이 비운 자리는 isCheckout 없이 시작하는 세대라 스냅샷 앵커가 없다.
  // 이 테스트는 그 실제 동작을 고정한다 - 앵커가 없다는 사실 자체를 막지는
  // 않는다(그 배치를 유실 없이 순서대로 배달하는 책임은 Task 12 업로더에 있다).
  it("drain 뒤에 쌓인 이벤트는 스냅샷 없는 세대에 그대로 쌓인다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.push(event(2));
    buffer.drain();

    buffer.push(event(3));
    buffer.push(event(4));

    expect(buffer.size).toBe(2);
    expect(buffer.drain().map((item) => item.timestamp)).toEqual([3, 4]);
  });

  it("size 는 모든 세대의 합이다", () => {
    const buffer = new CheckpointBuffer();
    buffer.push(snapshot(1), true);
    buffer.push(event(2));
    buffer.push(snapshot(3), true);

    expect(buffer.size).toBe(3);
  });
});
