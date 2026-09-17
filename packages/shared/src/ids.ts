let counter = 0;

/** Short unique id, good enough for a single-user local process. */
export const newId = (prefix = "id"): string => {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};
