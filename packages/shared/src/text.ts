/** A count and its noun, `1 page` or `3 pages`; `many` for a plural that is not the noun and an s. */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
