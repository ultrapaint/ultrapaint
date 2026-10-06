/**
 * A file whose changes are asked to be shown: a turn's "files changed" opens the Changes panel on
 * it. The panel is only mounted once its tab is picked, so the request waits here until it is.
 */
import { create } from "zustand";

interface DiffRequestStore {
  /** The file to show, until the Changes panel takes it up. */
  readonly path: string | null;
}

export const useDiffRequest = create<DiffRequestStore>(() => ({ path: null }));

/** Asks the Changes panel to show a file's diff, now or when it next opens. */
export const requestDiff = (path: string) => useDiffRequest.setState({ path });

/** The panel has taken the request up. */
export const takeDiffRequest = () => useDiffRequest.setState({ path: null });
