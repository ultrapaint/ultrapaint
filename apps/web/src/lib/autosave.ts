/**
 * Settings save as they change (ADR 0079): a switch or a choice at once, a name after a pause in
 * typing, a path when its field is left. One save runs at a time and each takes the latest value,
 * so an answer never lands after a newer save's; what still waits is saved when the form goes.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Autosave<T> {
  /** Saves what waits now: its field was left, or the form closes. */
  flush: () => void;
  /** Keeps `value` to save when its field is left: a path half typed names another folder. */
  later: (value: T) => void;
  /** Saves `value` at once, after the save in flight: a switch, a choice. */
  now: (value: T) => void;
  /** Saves `value` after `pause` ms with no other change: typing. */
  soon: (value: T) => void;
}

/** Saves through `save`, which says itself what became of a save; one at a time. */
export const autosave = <T>(
  save: (value: T) => Promise<unknown>,
  pause: number
): Autosave<T> => {
  let waiting: { value: T } | null = null;
  let due = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (running || !due || waiting === null) {
      return;
    }
    const { value } = waiting;
    waiting = null;
    due = false;
    running = true;
    const done = () => {
      running = false;
      run();
    };
    save(value).then(done, done);
  };
  const wait = (value: T, now: boolean) => {
    clearTimeout(timer);
    waiting = { value };
    due = now;
  };
  return {
    flush: () => {
      clearTimeout(timer);
      due = true;
      run();
    },
    later: (value) => wait(value, false),
    now: (value) => {
      wait(value, true);
      run();
    },
    soon: (value) => {
      wait(value, false);
      timer = setTimeout(() => {
        due = true;
        run();
      }, pause);
    },
  };
};

/** `autosave` for a component: the latest `save` is the one called, and closing flushes. */
export const useAutosave = <T>(
  save: (value: T) => Promise<unknown>,
  pause = 600
): Autosave<T> => {
  const latest = useRef(save);
  useLayoutEffect(() => {
    latest.current = save;
  });
  const [saver] = useState(() =>
    autosave<T>((value) => latest.current(value), pause)
  );
  useEffect(() => () => saver.flush(), [saver]);
  return saver;
};
