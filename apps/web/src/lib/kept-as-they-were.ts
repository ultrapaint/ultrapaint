/**
 * The new list, with each entry that did not change kept as the same object, and the old list
 * itself when nothing did. The server sends every page whenever one file changes (an agent saves
 * a page many times), and each frame on the canvas is drawn again for a page that is a new object.
 */
export const keptAsTheyWere = <T extends { readonly id: string }>(
  before: readonly T[],
  after: readonly T[]
): readonly T[] => {
  const byId = new Map(before.map((item) => [item.id, item]));
  const kept = after.map((item) => {
    const was = byId.get(item.id);
    return was && JSON.stringify(was) === JSON.stringify(item) ? was : item;
  });
  return kept.length === before.length && kept.every((k, i) => k === before[i])
    ? before
    : kept;
};
