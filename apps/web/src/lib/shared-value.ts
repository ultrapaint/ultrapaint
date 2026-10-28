/**
 * What several selected nodes have in one field, for a field that shows them all at once: the
 * value they agree on, or `MIXED` when they differ. Unset and `null` are the same thing here, as
 * they are to a field, which shows both as its placeholder.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";

/** The nodes do not agree on the field. */
export const MIXED: unique symbol = Symbol("mixed");

export type Shared<T> = T | undefined | typeof MIXED;

const unset = (v: JsonValue | undefined): v is null | undefined =>
  v === undefined || v === null;

/** Whether two values are the same, objects and lists by what they hold. */
export const sameValue = (
  a: JsonValue | undefined,
  b: JsonValue | undefined
): boolean => {
  if (unset(a) || unset(b)) {
    return unset(a) && unset(b);
  }
  if (typeof a !== "object" || typeof b !== "object") {
    return a === b;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const xs = a as readonly JsonValue[];
    const ys = b as readonly JsonValue[];
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      xs.length === ys.length &&
      xs.every((v, i) => sameValue(v, ys[i]))
    );
  }
  const x = a as { readonly [key: string]: JsonValue };
  const y = b as { readonly [key: string]: JsonValue };
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => sameValue(x[k], y[k]));
};

/** The one value every node has, `undefined` when none is given, `MIXED` when they differ. */
export const sharedValue = <T extends JsonValue>(
  values: readonly (T | undefined)[]
): Shared<T> => {
  const [first] = values;
  return values.every((v) => sameValue(v, first)) ? first : MIXED;
};

/**
 * What a field shows for a shared value: the value under its own placeholder, or no value with
 * `Mixed` in its place, so that picking one sets it on every node.
 */
export const shownAs = <T>(
  shared: T | typeof MIXED,
  placeholder?: string
): { placeholder: string | undefined; value: T | undefined } =>
  shared === MIXED
    ? { placeholder: "Mixed", value: undefined }
    : { placeholder, value: shared };

/** What a select shows in place of a value the nodes do not agree on. */
export const MIXED_LABEL = "mixed";

/** What a select shows for a shared value: the value, `fallback` when none is given. */
export const labelOf = (shared: Shared<string>, fallback: string): string => {
  if (shared === MIXED) {
    return MIXED_LABEL;
  }
  return shared ?? fallback;
};
