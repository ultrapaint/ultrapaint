/**
 * What the shell is doing for the open project (`Platform.shellStatus`): reconnecting to the
 * machine a project over SSH is on, say. Nothing in a browser.
 */
import { useMemo, useSyncExternalStore } from "react";
import {
  platform,
  type ShellStatus,
  type ShellStatusSource,
} from "../platform.ts";

const NONE: ShellStatusSource = {
  current: () => null,
  subscribe: () => () => undefined,
};

/**
 * The status as text, which React compares by value: across the shell's bridge each read is a
 * fresh copy, which React would take for a change on every render.
 */
export const shellStatusText = (source: ShellStatusSource = NONE) =>
  JSON.stringify(source.current());

/** The status, as it changes. */
export const useShellStatus = () => {
  const source = platform().shellStatus ?? NONE;
  const text = useSyncExternalStore(source.subscribe, () =>
    shellStatusText(source)
  );
  return useMemo(() => JSON.parse(text) as ShellStatus | null, [text]);
};
