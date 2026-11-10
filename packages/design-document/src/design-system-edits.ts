/**
 * The design system changed by the editor's operations (ADR 0045, B8), applied in order: a
 * token's value in a theme, its description, a token added, taken out or moved, a colour group
 * added or renamed, a text style set or taken out. Pure, on the server for `designSystem.edit`
 * and in the editor for the value drawn while it is typed. An operation that does not fit the
 * design system is a problem naming it; nothing of the list is applied then.
 */
import type {
  DesignSystem,
  Token,
  TokenGroup,
} from "@ultrapaint/contracts/design-system";
import type { DesignSystemEdit } from "@ultrapaint/contracts/design-system-edit";
import { defaultTheme } from "@ultrapaint/contracts/themes";
import {
  addTokens,
  isTokenName,
  mapTokens,
  removeTokens,
  SPACING_BASE,
  TOKEN_NAME_SHAPE,
  tokenKindOf,
  tokenOf,
  withTokenChanges,
} from "@ultrapaint/contracts/token-table";
import type { TokenChange } from "@ultrapaint/contracts/tokens";

/** A design system with the operations made, or what the first one that did not fit says. */
export type Edited = DesignSystem | { readonly problem: string };

/** The theme an operation names, as a change says it: left out for the default theme. */
const themeOf = (ds: DesignSystem, theme: string | undefined) =>
  theme === undefined || theme === defaultTheme(ds) ? undefined : theme;

/** What an operation is called in a problem and in the undo history. */
const named = (op: DesignSystemEdit): string => {
  switch (op.op) {
    case "setValue":
      return `${op.name}${op.theme ? ` in ${op.theme}` : ""}`;
    case "setTextStyle":
      return op.style.name;
    default:
      return op.name;
  }
};

const problem = (op: DesignSystemEdit, why: string) => ({
  problem: `${op.op} ${named(op)}: ${why}`,
});

const has = (ds: DesignSystem, name: string) => tokenOf(ds, name) !== undefined;

/** The colour group a token is in, by index; -1 when it is in none. */
const groupIndexOf = (ds: DesignSystem, name: string) =>
  ds.colors.findIndex((g) => g.tokens.some((t) => t.name === name));

const withGroups = (
  ds: DesignSystem,
  f: (groups: readonly TokenGroup[]) => TokenGroup[]
): DesignSystem => ({ ...ds, colors: f(ds.colors) });

const setValue = (
  ds: DesignSystem,
  op: Extract<DesignSystemEdit, { op: "setValue" }>
): Edited => {
  if (!has(ds, op.name)) {
    return problem(op, "the design system has no such token");
  }
  const theme = themeOf(ds, op.theme);
  if (theme !== undefined && ds.themes && !ds.themes.includes(theme)) {
    return problem(op, `the design system has no theme ${theme}`);
  }
  if (theme !== undefined && op.name === SPACING_BASE) {
    return problem(op, "the spacing base is the same in every theme");
  }
  if (op.value === null) {
    return theme === undefined
      ? problem(op, "a token has a value in the default theme: remove it")
      : withTokenChanges(ds, [{ name: op.name, remove: true, theme }]);
  }
  if (op.value.trim() === "") {
    return problem(op, "a value cannot be empty");
  }
  return withTokenChanges(ds, [
    { name: op.name, value: op.value.trim(), ...(theme && { theme }) },
  ]);
};

const addToken = (
  ds: DesignSystem,
  op: Extract<DesignSystemEdit, { op: "addToken" }>
): Edited => {
  if (!isTokenName(op.name)) {
    return problem(op, `a token's name is ${TOKEN_NAME_SHAPE}`);
  }
  if (has(ds, op.name)) {
    return problem(op, "the design system has a token of that name already");
  }
  const kind = tokenKindOf(op.name);
  if (kind === "other") {
    return problem(
      op,
      "its name says no kind of token (color-, spacing-, text-, radius-, …)"
    );
  }
  if (op.value.trim() === "") {
    return problem(op, "a value cannot be empty");
  }
  const values = Object.fromEntries(
    Object.entries(op.values ?? {}).filter(
      ([theme, value]) =>
        themeOf(ds, theme) !== undefined && value.trim() !== ""
    )
  );
  const token: Token = {
    name: op.name,
    value: op.value.trim(),
    ...(op.description && { description: op.description }),
    ...(Object.keys(values).length > 0 && { values }),
  };
  if (op.group === undefined) {
    return addTokens(ds, [token]);
  }
  if (kind !== "color") {
    return problem(op, "only a colour is in a group");
  }
  if (!ds.colors.some((g) => g.name === op.group)) {
    return problem(op, `there is no group ${op.group}`);
  }
  return withGroups(ds, (groups) =>
    groups.map((g) =>
      g.name === op.group ? { ...g, tokens: [...g.tokens, token] } : g
    )
  );
};

const moveToken = (
  ds: DesignSystem,
  op: Extract<DesignSystemEdit, { op: "moveToken" }>
): Edited => {
  const from = groupIndexOf(ds, op.name);
  if (from < 0) {
    return problem(op, "no colour group has it: only a colour is moved");
  }
  if (!ds.colors.some((g) => g.name === op.group)) {
    return problem(op, `there is no group ${op.group}`);
  }
  const token = ds.colors[from]?.tokens.find((t) => t.name === op.name);
  if (!token) {
    return problem(op, "the design system has no such token");
  }
  return withGroups(ds, (groups) =>
    groups.map((g) => {
      const rest = g.tokens.filter((t) => t.name !== op.name);
      if (g.name !== op.group) {
        return rest.length === g.tokens.length ? g : { ...g, tokens: rest };
      }
      const at = Math.max(0, Math.min(op.index ?? rest.length, rest.length));
      return {
        ...g,
        tokens: [...rest.slice(0, at), token, ...rest.slice(at)],
      };
    })
  );
};

const setDescription = (
  ds: DesignSystem,
  op: Extract<DesignSystemEdit, { op: "setDescription" }>
): Edited => {
  if (!has(ds, op.name) || op.name === SPACING_BASE) {
    return problem(op, "the design system has no such token");
  }
  const text = op.description.trim();
  return mapTokens(ds, (t) => {
    if (t.name !== op.name) {
      return t;
    }
    const { description: _gone, ...rest } = t;
    return text === "" ? rest : { ...rest, description: text };
  });
};

const hasGroup = (ds: DesignSystem, name: string) =>
  ds.colors.some((g) => g.name === name);

/** A colour group added or renamed. */
const editGroup = (
  ds: DesignSystem,
  op: Extract<DesignSystemEdit, { op: "addGroup" | "renameGroup" }>
): Edited => {
  const to = op.op === "addGroup" ? op.name : op.to;
  if (to.trim() === "") {
    return problem(op, "a group has a name");
  }
  if (op.op === "addGroup") {
    return hasGroup(ds, op.name)
      ? problem(op, "there is a group of that name already")
      : withGroups(ds, (groups) => [...groups, { name: op.name, tokens: [] }]);
  }
  if (!hasGroup(ds, op.name)) {
    return problem(op, "there is no such group");
  }
  if (to !== op.name && hasGroup(ds, to)) {
    return problem(op, `there is a group ${to} already`);
  }
  return withGroups(ds, (groups) =>
    groups.map((g) => (g.name === op.name ? { ...g, name: to } : g))
  );
};

/** A text style set in its place or after the others, or taken out. */
const editTextStyle = (
  ds: DesignSystem,
  op: Extract<DesignSystemEdit, { op: "setTextStyle" | "removeTextStyle" }>
): Edited => {
  const { styles } = ds.typography;
  const withStyles = (next: DesignSystem["typography"]["styles"]) => ({
    ...ds,
    typography: { ...ds.typography, styles: next },
  });
  if (op.op === "removeTextStyle") {
    return styles.some((s) => s.name === op.name)
      ? withStyles(styles.filter((s) => s.name !== op.name))
      : problem(op, "there is no such text style");
  }
  const at = styles.findIndex((s) => s.name === op.style.name);
  return withStyles(
    at < 0
      ? [...styles, op.style]
      : styles.map((s, i) => (i === at ? op.style : s))
  );
};

const removeToken = (
  ds: DesignSystem,
  op: Extract<DesignSystemEdit, { op: "removeToken" }>
): Edited => {
  if (op.name === SPACING_BASE) {
    return problem(op, "the spacing base is always there");
  }
  return has(ds, op.name)
    ? removeTokens(ds, new Set([op.name]))
    : problem(op, "the design system has no such token");
};

/** A design system with one operation made. */
const applyEdit = (ds: DesignSystem, op: DesignSystemEdit): Edited => {
  switch (op.op) {
    case "setValue":
      return setValue(ds, op);
    case "setDescription":
      return setDescription(ds, op);
    case "addToken":
      return addToken(ds, op);
    case "removeToken":
      return removeToken(ds, op);
    case "moveToken":
      return moveToken(ds, op);
    case "addGroup":
    case "renameGroup":
      return editGroup(ds, op);
    default:
      return editTextStyle(ds, op);
  }
};

/** The design system with every operation made in order, or the problem of the first that does not fit. */
export const applyEdits = (
  ds: DesignSystem,
  ops: readonly DesignSystemEdit[]
): Edited => {
  let next = ds;
  for (const op of ops) {
    const edited = applyEdit(next, op);
    if ("problem" in edited) {
      return edited;
    }
    next = edited;
  }
  return next;
};

/**
 * Token changes another side gives (Sync taking the code's, Figma's or DESIGN.md's values) as
 * the editor's operations, so that they are checked as an edit is: a value set or another
 * theme's taken out of a token the design system lists, a token it does not list added with
 * the values given, one taken out. A change `applyEdits` cannot make is a problem it names (a
 * name that says no kind of token, a theme the design system does not have), not one left out.
 */
export const editsOf = (
  ds: DesignSystem,
  changes: readonly TokenChange[]
): DesignSystemEdit[] => {
  const byName = new Map<string, TokenChange[]>();
  for (const c of changes) {
    byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
  }
  const each = (name: string, c: TokenChange): DesignSystemEdit =>
    c.remove && c.theme === undefined
      ? { name, op: "removeToken" }
      : {
          name,
          op: "setValue",
          value: c.remove ? null : (c.value ?? null),
          ...(c.theme !== undefined && { theme: c.theme }),
        };
  return [...byName].flatMap(([name, own]): DesignSystemEdit[] => {
    const given = (c: TokenChange) => !c.remove && c.value !== undefined;
    const value = own.find((c) => c.theme === undefined && given(c))?.value;
    if (has(ds, name) || value === undefined) {
      // A token the design system has not, with nothing to add it with, is named in a problem.
      return own.map((c) => each(name, c));
    }
    const values = Object.fromEntries(
      own.flatMap((c) =>
        c.theme !== undefined && given(c) && c.value !== undefined
          ? [[c.theme, c.value] as const]
          : []
      )
    );
    return [
      {
        name,
        op: "addToken",
        value,
        ...(Object.keys(values).length > 0 && { values }),
      },
    ];
  });
};

/** What the undo history calls the operations: the one's own words, or a count. */
export const editLabel = (ops: readonly DesignSystemEdit[]): string => {
  const [op] = ops;
  if (!op) {
    return "Change the design system";
  }
  if (ops.length > 1) {
    return ops.every((o) => o.op === "setValue")
      ? `Change ${ops.length} tokens`
      : "Change the design system";
  }
  switch (op.op) {
    case "setValue":
      return `Change ${named(op)}`;
    case "setDescription":
      return `Describe ${op.name}`;
    case "addToken":
      return `Add ${op.name}`;
    case "removeToken":
      return `Remove ${op.name}`;
    case "moveToken":
      return `Move ${op.name} to ${op.group}`;
    case "addGroup":
      return `Add the group ${op.name}`;
    case "renameGroup":
      return `Rename ${op.name} to ${op.to}`;
    case "setTextStyle":
      return `Change the text style ${op.style.name}`;
    case "removeTextStyle":
      return `Remove the text style ${op.name}`;
    default:
      return "Change the design system";
  }
};
