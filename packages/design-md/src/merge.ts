/**
 * The document's mirrored values against the design system's (ADR 0028) and against what the two
 * last agreed on,
 * token by token (ADR 0027), by the rule every side is synced by
 * (`@ultrapaint/contracts/agreement`), the document being the side. Each value has a path:
 * `colors.primary`, `rounded.md`, `spacing.base`, `typography.body.fontSize`.
 *
 * - The same on both sides, as Sync compares (`#3b82f6` and its `oklch()` are one colour): kept
 *   as the document writes it (a reference stays a reference).
 * - Changed in the design system only, or new there: the document takes the design system's.
 * - Taken out of the document: the design system's is written back, as a side that leaves a token out
 *   gets it back; the design system is where a token is taken out.
 * - Changed in the document only, or new there: held, for Sync to offer.
 * - Changed on both sides: held, for the user to pick.
 *
 * With no agreement yet, a document that has no mirrored values takes them all, and one that
 * has some is held whole: it came from somewhere else and is matched first.
 */
import {
  agreedAfter,
  agreedOn,
  outcomeOf,
} from "@ultrapaint/contracts/agreement";
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

export interface Merged {
  /** What agreed after the merge, for the next one: the old value where one is held. */
  readonly agreed: Record<string, string>;
  /** The groups to write: the design system's where it moved alone, the document's elsewhere. */
  readonly groups: TokenGroups;
  /** Paths whose document value is held for Sync, by what happened. */
  readonly held: readonly Held[];
}

export interface Held {
  /** The design system's value, when it has one (named before ADR 0028, when it was the code's). */
  readonly code?: string;
  /** The document's value, when it has one. */
  readonly doc?: string;
  /** - `doc`: changed or added in the document only. - `both`: changed on both sides. */
  readonly kind: "both" | "doc";
  readonly path: string;
}

const str = (v: number | string | undefined) =>
  v === undefined ? undefined : String(v);

export const mergeMirror = (
  doc: DesignMd,
  design: TokenGroups,
  agreed: Readonly<Record<string, string>> | null
): Merged => {
  const raw = flatten(groupsOf(doc).groups);
  const resolved = resolvedValues(doc);
  const oursRaw = flatten(design);
  // The design system's component tokens refer to its own colours: compared by what they come to.
  const ours = resolveAgainst(oursRaw, design);

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
    const c = str(ours[path]);
    const d = str(resolved[path]);
    const before = agreedOn(agreed?.[path]);
    const outcome = outcomeOf(d, c, before);
    // The document is behind: the design system moved alone, or took it out, or the document did.
    const written = outcome === "source-behind" ? oursRaw[path] : raw[path];
    if (written !== undefined) {
      out[path] = written;
    }
    if (outcome === "to-design" || outcome === "conflict") {
      held.push(heldOf(path, outcome === "conflict" ? "both" : "doc", c, d));
    }
    const now = agreedAfter(
      outcome === "source-behind" ? c : d,
      c,
      before,
      false
    );
    if (now?.design !== undefined) {
      nextAgreed[path] = now.design;
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
