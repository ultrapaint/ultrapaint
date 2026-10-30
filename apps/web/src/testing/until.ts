/**
 * Waits for a store to say something, rather than for time to pass (`docs/TESTING.md`, rule 2):
 * resolves at once when `holds` is true of its state, else at the change that makes it true. A
 * test awaits what an answer it set up sets off (a canvas opened, documents read) through it.
 */
export const until = <S>(
  store: {
    getState: () => S;
    subscribe: (listener: (state: S) => void) => () => void;
  },
  holds: (state: S) => boolean
): Promise<void> =>
  new Promise((resolve) => {
    if (holds(store.getState())) {
      resolve();
      return;
    }
    const stop = store.subscribe((state) => {
      if (holds(state)) {
        stop();
        resolve();
      }
    });
  });
