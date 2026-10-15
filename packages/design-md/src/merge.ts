/**
 * The document's mirrored values against the code's and against what the two last agreed on,
 * token by token (ADR 0027), as Figma's are compared (ADR 0025). Each value has a path:
 * `colors.primary`, `rounded.md`, `spacing.base`, `typography.body.fontSize`.
 *
 * - The same on both sides: kept as the document writes it (a reference stays a reference).
 * - Changed in the code only, or new there: the document takes the code's.
 * - Changed in the document only, or new there, or taken out of it: held, for Sync to offer.
 * - Changed on both sides: held, for the user to pick.
 *
 * With no agreement yet, a document that has no mirrored values takes them all, and one that
 * has some is held whole: it came from somewhere else and is matched first.
 */
import {
  MIRRORED_GROUPS,
  type TokenGroups,
  type Typography,
} from "./format.ts";
import type { DesignMd } from "./parse.ts";
import { follow, groupsOf, refOf } from "./tokens.ts";

/** Mirrored values by path. */
export type Flat = Readonly<Record<string, number | string>>;

/** Every mirrored value of the groups, by path. */
export const flatten = (
  groups: TokenGroups
): Record<string, number | string> => {
  const out: Record<string, number | string> = {};
  for (const group of MIRRORED_GROUPS) {
    for (const [key, value] of Object.entries(groups[group])) {
      if (typeof value === "object") {
        for (const [field, v] of Object.entries(value as Typography)) {
          if (v !== undefined) {
            out[`${group}.${key}.${field}`] = v;
          }
        }
      } else {
        out[`${group}.${key}`] = value;
      }
    }
  }
  return out;
};

/** The groups the paths make up, in the order they come. */
export const unflatten = (flat: Flat): TokenGroups => {
  const groups: Record<string, Record<string, unknown>> = Object.fromEntries(
    MIRRORED_GROUPS.map((g) => [g, {}])
  );
  for (const [path, value] of Object.entries(flat)) {
    const [group = "", key = "", field] = path.split(".");
    const target = groups[group];
    if (!target) {
      continue;
    }
    if (field === undefined) {
      target[key] = value;
    } else {
      target[key] = { ...(target[key] as object | undefined), [field]: value };
    }
  }
  return groups as unknown as TokenGroups;
};

/** Values by path, the references among them followed through `tree`. */
const resolveAgainst = (
  flat: Flat,
  tree: TokenGroups
): Record<string, number | string> => {
  const out: Record<string, number | string> = {};
  for (const [path, value] of Object.entries(flat)) {
    const ref = refOf(value);
    const followed =
      ref === null
        ? value
        : follow(tree as unknown as Record<string, unknown>, ref);
    if (followed !== null) {
      out[path] = followed;
    }
  }
  return out;
};

/** The groups' values by path, references followed, as an agreement keeps them. */
export const valuesOf = (groups: TokenGroups): Record<string, string> =>
  Object.fromEntries(
    Object.entries(resolveAgainst(flatten(groups), groups)).map(([k, v]) => [
      k,
      String(v),
    ])
  );

/** The document's mirrored values, references followed. */
export const resolvedValues = (
  doc: DesignMd
): Record<string, number | string> => {
  const raw = flatten(groupsOf(doc).groups);
  const out: Record<string, number | string> = {};
  for (const [path, value] of Object.entries(raw)) {
    const ref = refOf(value);
    const followed = ref === null ? value : follow(doc.values, ref);
    if (followed !== null) {
      out[path] = followed;
    }
  }
  return out;
};

/** Two values that say the same: `1.5` and `"1.5"` do. */
export const sameValue = (
  a: number | string | undefined,
  b: number | string | undefined
) => a !== undefined && b !== undefined && String(a) === String(b);

export interface Merged {
  /** What agreed after the merge, for the next one: the old value where one is held. */
  readonly agreed: Record<string, string>;
  /** The groups to write: the code's where it moved alone, the document's elsewhere. */
  readonly groups: TokenGroups;
  /** Paths whose document value is held for Sync, by what happened. */
  readonly held: readonly Held[];
}

export interface Held {
  /** The code's value, when it has one. */
  readonly code?: string;
  /** The document's value, when it has one. */
  readonly doc?: string;
  /** - `doc`: changed, added or taken out in the document only. - `both`: changed on both sides. */
  readonly kind: "both" | "doc";
  readonly path: string;
}

const str = (v: number | string | undefined) =>
  v === undefined ? undefined : String(v);

/** What one value comes to: the same, the code's to take, or held as `doc` or `both`. */
const outcomeOf = (
  c: number | string | undefined,
  d: number | string | undefined,
  base: string | undefined
): "both" | "code" | "doc" | "same" => {
  if (sameValue(c, d)) {
    return "same";
  }
  const docMoved = base === undefined ? d !== undefined : !sameValue(d, base);
  if (!docMoved) {
    return "code";
  }
  const codeMoved = base === undefined ? c !== undefined : !sameValue(c, base);
  return codeMoved ? "both" : "doc";
};

export const mergeMirror = (
  doc: DesignMd,
  code: TokenGroups,
  agreed: Readonly<Record<string, string>> | null
): Merged => {
  const raw = flatten(groupsOf(doc).groups);
  const resolved = resolvedValues(doc);
  const oursRaw = flatten(code);
  // The code's component tokens refer to its own colours: compared by what they come to.
  const ours = resolveAgainst(oursRaw, code);

  if (agreed === null && Object.keys(raw).length > 0) {
    // Not agreed on yet: nothing is written until Sync has matched it.
    return {
      agreed: {},
      groups: groupsOf(doc).groups,
      held: [...new Set([...Object.keys(raw), ...Object.keys(ours)])].map(
        (path) => heldOf(path, "doc", ours[path], resolved[path])
      ),
    };
  }

  const out: Record<string, number | string> = {};
  const nextAgreed: Record<string, string> = {};
  const held: Held[] = [];
  const paths = [...new Set([...Object.keys(raw), ...Object.keys(ours)])];
  for (const path of paths) {
    const c = ours[path];
    const d = resolved[path];
    const base = agreed?.[path];
    const outcome = outcomeOf(c, d, base);
    if (outcome === "code") {
      // The document has what was agreed: the code moved alone, or took it out.
      const written = oursRaw[path];
      if (c !== undefined && written !== undefined) {
        out[path] = written;
        nextAgreed[path] = String(c);
      }
      continue;
    }
    if (raw[path] !== undefined) {
      out[path] = raw[path];
    }
    if (outcome === "same") {
      nextAgreed[path] = String(c);
      continue;
    }
    held.push(heldOf(path, outcome, c, d));
    if (base !== undefined) {
      nextAgreed[path] = base;
    }
  }
  return { agreed: nextAgreed, groups: unflatten(out), held };
};

const heldOf = (
  path: string,
  kind: Held["kind"],
  code: number | string | undefined,
  doc: number | string | undefined
): Held => ({
  ...(code !== undefined && { code: String(code) }),
  ...(doc !== undefined && { doc: str(doc) }),
  kind,
  path,
});
