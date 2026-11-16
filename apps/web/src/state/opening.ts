/**
 * The project the desktop app is opening (`Platform.opening`, ADR 0099), as it goes: the splash
 * draws it. Nothing in a browser, where the editor keeps an open of its own (`StartSplash`).
 */
import type { Opening } from "@ultrapaint/contracts/opening";
import { useMemo, useSyncExternalStore } from "react";
import { platform } from "../platform.ts";

type OpeningSource = NonNullable<ReturnType<typeof platform>["opening"]>;

const NONE: OpeningSource = {
  current: () => null,
  subscribe: () => () => undefined,
};

/** The opening, as it changes; null when none is. */
export const useOpening = (): Opening | null => {
  const source = platform().opening ?? NONE;
  // As text, which React compares by value: each read across the bridge is a fresh copy.
  const text = useSyncExternalStore(source.subscribe, () =>
    JSON.stringify(source.current())
  );
  return useMemo(() => JSON.parse(text) as Opening | null, [text]);
};
