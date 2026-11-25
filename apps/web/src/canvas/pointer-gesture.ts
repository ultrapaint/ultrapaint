/**
 * The pointer gesture on the canvas (ADR 0133): what a press begins and its release ends, a
 * marquee, a frame moved or sized, a node dragged, a group drawn, the ground panned. It is
 * followed on the window by the pointer that pressed, from the press to the release, whatever
 * element or frame the pointer crosses and whatever is taken off the page under it (a frame's
 * select layer goes while Space is held): no element's pointer capture or handlers are needed for
 * it to end. One is followed at a time.
 *
 * It ends let go (`up`) on that pointer's release, or on its first move with the button no longer
 * held, a release the window never heard (outside it). It is put back (`cancel`: what it moved
 * or picked as it was, a pan keeping its view) when the browser takes the pointer away, when the
 * window loses the focus, by Escape (`putBackGesture`), and by
 * the next press, before that one begins.
 */

/** What a gesture does as the pointer moves, is let go, or is taken away. */
export interface Gesture {
  cancel: () => void;
  move: (e: PointerEvent) => void;
  up: () => void;
}

/** The press a gesture begins with: which pointer, and which of its buttons. */
interface Press {
  readonly button?: number;
  readonly pointerId: number;
}

/**
 * The `buttons` bit of a `button`: bit n for button n (a pen's eraser is 5, bit 32), but for the
 * middle and right buttons, which are swapped.
 */
const bitOf = (button: number) => {
  if (button === 1) {
    return 4;
  }
  return button === 2 ? 2 : 2 ** button;
};

/** What puts back the gesture being followed and stops following it; null when there is none. */
let putBack: (() => void) | null = null;

/** Whether a gesture follows the pointer: what the canvas would show under it waits. */
export const isFollowing = () => putBack !== null;

/** What waits for the gesture followed now to end. */
let waiting: (() => void)[] = [];

/** Runs what waited for the gesture that just ended, once it has done what its end does. */
const ended = () => {
  const now = waiting;
  waiting = [];
  for (const then of now) {
    then();
  }
};

/**
 * Runs `then` once the gesture followed now ends, let go or put back, whatever began it (a pan,
 * a drag, a marquee): what the canvas shows under a pointer that has not moved since is seen to
 * then. At once when none is followed.
 */
export const afterGesture = (then: () => void) => {
  if (putBack === null) {
    then();
  } else {
    waiting.push(then);
  }
};

/** Puts back the gesture being followed, if one is: whether there was one. */
export const putBackGesture = (): boolean => {
  const was = putBack;
  was?.();
  return was !== null;
};

/**
 * Follows the pointer that pressed until it is let go or taken away, as `gesture` says. A gesture
 * still followed is put back first: put back after, it would take the new one with it.
 */
export const followPointer = (press: Press, gesture: Gesture) => {
  putBack?.();
  const { pointerId } = press;
  const held = bitOf(press.button ?? 0);
  const ours = (e: PointerEvent) => e.pointerId === pointerId;
  // Listened to as the event begins its way, so nothing on the way can keep it from the gesture.
  const options = { capture: true } as const;
  const stop = () => {
    window.removeEventListener("pointermove", move, options);
    window.removeEventListener("pointerup", up, options);
    window.removeEventListener("pointercancel", cancelled, options);
    window.removeEventListener("blur", cancel);
    if (putBack === cancel) {
      putBack = null;
    }
  };
  const letGo = () => {
    stop();
    gesture.up();
    ended();
  };
  const move = (e: PointerEvent) => {
    if (!ours(e)) {
      return;
    }
    // biome-ignore lint/suspicious/noBitwiseOperators: `buttons` is a bit field, one bit a button.
    if ((e.buttons & held) === 0) {
      letGo();
      return;
    }
    gesture.move(e);
  };
  const up = (e: PointerEvent) => {
    if (ours(e)) {
      letGo();
    }
  };
  const cancel = () => {
    stop();
    gesture.cancel();
    ended();
  };
  const cancelled = (e: PointerEvent) => {
    if (ours(e)) {
      cancel();
    }
  };
  putBack = cancel;
  window.addEventListener("pointermove", move, options);
  window.addEventListener("pointerup", up, options);
  window.addEventListener("pointercancel", cancelled, options);
  window.addEventListener("blur", cancel);
};
