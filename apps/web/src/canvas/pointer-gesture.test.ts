// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  followPointer,
  isFollowing,
  putBackGesture,
} from "./pointer-gesture.ts";

/** A gesture that writes down what happens to it. */
const recorder = () => {
  const seen: string[] = [];
  return {
    gesture: {
      cancel: () => seen.push("cancel"),
      move: (e: PointerEvent) => seen.push(`move ${e.clientX}`),
      up: () => seen.push("up"),
    },
    seen,
  };
};

/** What the window hears of a pointer: the left button held unless `buttons` says otherwise. */
const hear = (type: string, { buttons = 1, clientX = 0, pointerId = 1 } = {}) =>
  window.dispatchEvent(new PointerEvent(type, { buttons, clientX, pointerId }));

afterEach(() => {
  putBackGesture();
});

describe("a pointer gesture", () => {
  it("follows the pointer that pressed until it is let go, and nothing after", () => {
    const { gesture, seen } = recorder();
    followPointer({ pointerId: 1 }, gesture);
    hear("pointermove", { clientX: 10 });
    // Another pointer, a second finger or a pen, is not this gesture's.
    hear("pointermove", { clientX: 99, pointerId: 2 });
    hear("pointerup", { pointerId: 2 });
    hear("pointerup", { buttons: 0 });
    hear("pointermove", { clientX: 20 });
    expect(seen).toEqual(["move 10", "up"]);
    expect(isFollowing()).toBe(false);
  });

  it("is let go at the first move with its button no longer held, its release never heard", () => {
    const { gesture, seen } = recorder();
    followPointer({ pointerId: 1 }, gesture);
    hear("pointermove", { buttons: 0, clientX: 10 });
    expect(seen).toEqual(["up"]);
  });

  it("pressed with the middle button or a pen's eraser, goes on while that button is held", () => {
    const middle = recorder();
    followPointer({ button: 1, pointerId: 1 }, middle.gesture);
    hear("pointermove", { buttons: 4, clientX: 10 });
    hear("pointermove", { buttons: 0, clientX: 20 });
    const eraser = recorder();
    followPointer({ button: 5, pointerId: 1 }, eraser.gesture);
    hear("pointermove", { buttons: 32, clientX: 30 });
    hear("pointermove", { buttons: 0, clientX: 40 });
    expect([middle.seen, eraser.seen]).toEqual([
      ["move 10", "up"],
      ["move 30", "up"],
    ]);
  });

  it("is put back when the browser takes the pointer away, or the window loses the focus", () => {
    const taken = recorder();
    followPointer({ pointerId: 1 }, taken.gesture);
    hear("pointercancel");
    expect(taken.seen).toEqual(["cancel"]);
    expect(isFollowing()).toBe(false);
    const blurred = recorder();
    followPointer({ pointerId: 1 }, blurred.gesture);
    window.dispatchEvent(new Event("blur"));
    hear("pointerup", { buttons: 0 });
    expect([taken.seen, blurred.seen]).toEqual([["cancel"], ["cancel"]]);
  });

  it("is put back by Escape, which says there was one", () => {
    const { gesture, seen } = recorder();
    followPointer({ pointerId: 1 }, gesture);
    expect(putBackGesture()).toBe(true);
    expect(putBackGesture()).toBe(false);
    expect(seen).toEqual(["cancel"]);
  });

  it("still followed when the next press comes, is put back before that one begins", () => {
    const first = recorder();
    const second = recorder();
    followPointer({ pointerId: 1 }, first.gesture);
    followPointer({ pointerId: 1 }, second.gesture);
    hear("pointermove", { clientX: 5 });
    expect([first.seen, second.seen]).toEqual([["cancel"], ["move 5"]]);
  });
});
