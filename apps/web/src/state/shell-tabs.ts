/**
 * The projects open in the desktop app's tabs (`Platform.tabs`, ADR 0107), as they change: the
 * tab strip draws them, and the start page keeps them on its list. None in a browser.
 */
import type { ShellTab } from "@ultrapaint/contracts/shell-bridge";
import { useMemo, useSyncExternalStore } from "react";
import { platform } from "../platform.ts";

type TabsSource = NonNullable<ReturnType<typeof platform>["tabs"]>;

const NONE: TabsSource = {
  current: () => [],
  subscribe: () => () => undefined,
};

/** The open projects' tabs, in their order. */
export const useShellTabs = (): readonly ShellTab[] => {
  const source = platform().tabs ?? NONE;
  // As text, which React compares by value: each read across the bridge is a fresh copy.
  const text = useSyncExternalStore(source.subscribe, () =>
    JSON.stringify(source.current())
  );
  return useMemo(() => JSON.parse(text) as readonly ShellTab[], [text]);
};
