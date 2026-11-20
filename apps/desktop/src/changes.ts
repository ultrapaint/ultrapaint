/**
 * Telling only a change: a value compared with the last one by what it holds (its JSON), as what
 * the main process tells the pages and writes to disk is.
 */

/** Whether two values hold the same. */
export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Remembers the last value it is given: whether each one differs from the one before. */
export const changes = () => {
  let last: string | undefined;
  return (value: unknown) => {
    const text = JSON.stringify(value);
    const differs = text !== last;
    last = text;
    return differs;
  };
};
