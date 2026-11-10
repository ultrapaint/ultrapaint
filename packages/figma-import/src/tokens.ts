/**
 * The tokens a Figma file defines (ADR 0025): its variables, mode by mode, and its colour and
 * shadow styles, named the way the code names tokens by contracts' token-naming
 * (`Colors/Primary/500` is `color-primary-500`, a number of a length kind is in pixels).
 * Variables win over a style of the same name. What has no place among the code's tokens — a
 * boolean, a string that is not a font, a number on no scale the name tells — is left out and
 * said in the notes. Pure and synchronous.
 */
import {
  foreignToken,
  type ListedKind,
  numberCss,
  type ValueHint,
} from "@ultrapaint/contracts/token-naming";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import type { FigColor, FigNode, FigPaint } from "openfig-core";
import { type FigFile, guidOf } from "./fig.ts";
import { cssColor, cssRgba, topPaint } from "./paint.ts";

interface FigmaToken {
  /** The variable its default mode points at, by its place in Figma: a semantic colour's palette entry. */
  readonly alias?: string;
  /** Figma's own id for the variable or style, which a rename keeps. */
  readonly id?: string;
  readonly kind: TokenKind;
  /** As the code names it: `color-primary-500`. */
  readonly name: string;
  /** Values by theme: `""` for the default mode, then `dark` and the other modes by name. */
  readonly values: Readonly<Record<string, string>>;
  /** Where it is in Figma: `Colors/Primary/500`, or the style's name. */
  readonly variable: string;
}

export interface FigmaTokenSet {
  readonly notes: readonly string[];
  /** The modes besides the default, as themes. */
  readonly themes: readonly string[];
  readonly tokens: readonly FigmaToken[];
}

/** The names Figma gives a collection nobody named: they say nothing about the token. */
const UNNAMED_SET_RE = /^(collection|variables|untitled)( ?\d+)?$/i;
/** Mode names that are the default theme, whatever the file calls it. */
const DEFAULT_MODE_RE = /^(light|default|mode ?1|value|base)$/i;

/** What a variable's type says its value is; a boolean is no token's. */
const HINTS: Readonly<Record<string, ValueHint>> = {
  COLOR: "color",
  FLOAT: "number",
  STRING: "string",
};

/**
 * A variable's or a style's kind and name from where it is in Figma (`Colors/Primary/500` is
 * `color-primary-500`), a collection nobody named left out; null when it is left out.
 */
const named = (
  path: string,
  hint: ValueHint
): { readonly kind: ListedKind; readonly name: string } | null => {
  const found = foreignToken(
    path.split("/").filter((s) => !UNNAMED_SET_RE.test(s.trim())),
    hint
  );
  return "name" in found ? found : null;
};

interface VariableValue {
  readonly alias?: string;
  readonly color?: FigColor;
  readonly number?: number;
  readonly text?: string;
}

interface Variable {
  readonly id: string;
  readonly path: string;
  readonly set: string;
  /** Its kind and name as a token, null when it is none. */
  readonly token: { readonly kind: ListedKind; readonly name: string } | null;
  readonly type: string;
  /** Mode id → value. */
  readonly values: ReadonlyMap<string, VariableValue>;
}

interface Mode {
  readonly id: string;
  /** `""` for the default theme. */
  readonly theme: string;
}

type Loose = Record<string, unknown>;
const field = (node: unknown, key: string): unknown =>
  typeof node === "object" && node !== null ? (node as Loose)[key] : undefined;
/** A field that should hold a list, or an empty one when the file has none there. */
const listOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const variableValueOf = (data: unknown): VariableValue => {
  const value = field(data, "value");
  const alias = guidOf(field(field(value, "alias"), "guid") as never);
  if (alias) {
    return { alias };
  }
  const color = field(value, "colorValue") as FigColor | undefined;
  if (color) {
    return { color };
  }
  const number = field(value, "floatValue");
  if (typeof number === "number") {
    return { number };
  }
  const text = field(value, "textValue");
  return typeof text === "string" ? { text } : {};
};

/**
 * A collection's modes as themes, the default one first: the first whose name says so (`Light`
 * after `Dark` is still the default), else the collection's first. Every other mode is the theme
 * of its name.
 */
const modesOf = (set: FigNode): Mode[] => {
  const modes = (
    (field(set, "variableSetModes") as unknown[] | undefined) ?? []
  )
    .map((m) => ({
      id: guidOf(field(m, "id") as never) ?? "",
      name: String(field(m, "name") ?? ""),
    }))
    .filter((m) => m.id !== "");
  const base = modes.find((m) => DEFAULT_MODE_RE.test(m.name)) ?? modes[0];
  return base === undefined
    ? []
    : [
        { id: base.id, theme: "" },
        ...modes
          .filter((m) => m !== base)
          .map((m) => ({ id: m.id, theme: m.name.toLowerCase().trim() })),
      ];
};

const variableOf = (node: FigNode, setName: string): Variable | null => {
  const id = guidOf(node.guid);
  const set = guidOf(field(field(node, "variableSetID"), "guid") as never);
  if (!(id && set)) {
    return null;
  }
  const type = String(field(node, "variableResolvedType") ?? "");
  const path = `${setName}/${node.name ?? ""}`;
  const hint = HINTS[type];
  const token = hint === undefined ? null : named(path, hint);
  const entries = listOf(field(field(node, "variableDataValues"), "entries"));
  const values = new Map<string, VariableValue>();
  for (const entry of entries) {
    const mode = guidOf(field(entry, "modeID") as never);
    if (mode) {
      values.set(mode, variableValueOf(field(entry, "variableData")));
    }
  }
  return { id, path, set, token, type, values };
};

/** The CSS a variable's value comes to in a mode, aliases followed. */
const resolverOf = (
  variables: ReadonlyMap<string, Variable>,
  defaultModeOf: ReadonlyMap<string, string>
) => {
  const resolve = (
    variable: Variable,
    mode: string,
    depth = 0
  ): VariableValue | null => {
    const value =
      variable.values.get(mode) ??
      variable.values.get(defaultModeOf.get(variable.set) ?? "");
    if (!value || depth > 8) {
      return null;
    }
    if (value.alias) {
      const target = variables.get(value.alias);
      if (!target) {
        return null;
      }
      // An alias into another collection takes that collection's default mode.
      const next = target.set === variable.set ? mode : "";
      return resolve(target, next, depth + 1);
    }
    return value;
  };
  return resolve;
};

const cssOf = (kind: TokenKind, value: VariableValue): string | null => {
  if (value.color) {
    return cssColor(value.color);
  }
  if (value.number !== undefined) {
    return numberCss(kind, value.number);
  }
  return value.text ?? null;
};

/** Every live variable, by id, with the collections they sit in and those collections' modes. */
const collectVariables = (file: FigFile) => {
  const nodes = file.doc.message.nodeChanges as FigNode[];
  const alive = nodes.filter((n) => n.phase !== "REMOVED");
  const sets = new Map(
    alive
      .filter((n) => n.type === "VARIABLE_SET")
      .map((n) => [guidOf(n.guid) ?? "", n] as const)
  );
  const variables = new Map<string, Variable>();
  for (const node of alive.filter((n) => n.type === "VARIABLE")) {
    const setId = guidOf(field(field(node, "variableSetID"), "guid") as never);
    const v = variableOf(node, String(sets.get(setId ?? "")?.name ?? ""));
    if (v) {
      variables.set(v.id, v);
    }
  }
  const modes = new Map([...sets].map(([id, set]) => [id, modesOf(set)]));
  return { modes, variables };
};

/** A variable's CSS theme by theme, or null when its default mode comes to nothing. */
const themeValuesOf = (
  variable: Variable,
  kind: TokenKind,
  modes: readonly Mode[],
  resolve: ReturnType<typeof resolverOf>
): Record<string, string> | null => {
  const values = new Map<string, string>();
  for (const mode of modes) {
    const value = resolve(variable, mode.id);
    const css = value ? cssOf(kind, value) : null;
    // A theme that only repeats the default's value has nothing of its own to say.
    const repeats = mode.theme !== "" && css === values.get("");
    if (css !== null && !values.has(mode.theme) && !repeats) {
      values.set(mode.theme, css);
    }
  }
  return values.has("") ? Object.fromEntries(values) : null;
};

const skippedNote = (skipped: readonly string[]): string =>
  `${skipped.length} variable${skipped.length === 1 ? " is" : "s are"} not a colour, a font or a number on a known scale, and ${skipped.length === 1 ? "was" : "were"} left out: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}.`;

const readVariables = (file: FigFile, notes: string[]): FigmaToken[] => {
  const { modes, variables } = collectVariables(file);
  const defaultModeOf = new Map(
    [...modes].map(([id, list]) => [id, list[0]?.id ?? ""])
  );
  const resolve = resolverOf(variables, defaultModeOf);

  const tokens: FigmaToken[] = [];
  const skipped: string[] = [];
  for (const variable of variables.values()) {
    const { token } = variable;
    if (!token) {
      skipped.push(variable.path);
      continue;
    }
    const values = themeValuesOf(
      variable,
      token.kind,
      modes.get(variable.set) ?? [],
      resolve
    );
    if (values) {
      const first = variable.values.get(defaultModeOf.get(variable.set) ?? "");
      const target = first?.alias ? variables.get(first.alias) : undefined;
      tokens.push({
        ...(target && { alias: target.path }),
        id: variable.id,
        kind: token.kind,
        name: token.name,
        values,
        variable: variable.path,
      });
    }
  }
  if (skipped.length > 0) {
    notes.push(skippedNote(skipped));
  }
  return tokens;
};

/** A drop shadow effect as CSS: `0 4px 8px 0 rgba(…)`. */
const shadowCss = (effects: readonly unknown[]): string | null => {
  const shadows = effects
    .filter(
      (e) =>
        field(e, "visible") !== false &&
        (field(e, "type") === "DROP_SHADOW" ||
          field(e, "type") === "INNER_SHADOW")
    )
    .map((e) => {
      const offset = field(e, "offset");
      const x = Number(field(offset, "x") ?? 0);
      const y = Number(field(offset, "y") ?? 0);
      const blur = Number(field(e, "radius") ?? 0);
      const spread = Number(field(e, "spread") ?? 0);
      const color = field(e, "color") as FigColor | undefined;
      const inset = field(e, "type") === "INNER_SHADOW" ? "inset " : "";
      return `${inset}${x}px ${y}px ${blur}px ${spread}px ${color ? cssRgba(color) : "rgba(0, 0, 0, 0.25)"}`;
    });
  return shadows.length > 0 ? shadows.join(", ") : null;
};

const readStyles = (file: FigFile): FigmaToken[] => {
  const nodes = (file.doc.message.nodeChanges as FigNode[]).filter(
    (n) =>
      n.phase !== "REMOVED" &&
      typeof field(n, "styleType") === "string" &&
      field(n, "isSoftDeletedStyle") !== true
  );
  const tokens: FigmaToken[] = [];
  for (const node of nodes) {
    const type = field(node, "styleType");
    const path = String(node.name ?? "");
    const id = guidOf(node.guid);
    if (type === "FILL") {
      const paint = topPaint(
        field(node, "fillPaints") as readonly FigPaint[] | undefined,
        "SOLID"
      );
      const token = named(path, "color");
      if (paint?.color && token) {
        tokens.push({
          ...(id && { id }),
          ...token,
          values: { "": cssColor(paint.color, paint.opacity ?? 1) },
          variable: path,
        });
      }
    } else if (type === "EFFECT") {
      const css = shadowCss(listOf(field(node, "effects")));
      const token = named(path, "shadow");
      if (css && token) {
        tokens.push({
          ...(id && { id }),
          ...token,
          values: { "": css },
          variable: path,
        });
      }
    }
  }
  return tokens;
};

export const readFigmaTokens = (file: FigFile): FigmaTokenSet => {
  const notes: string[] = [];
  const variables = readVariables(file, notes);
  const styles = readStyles(file);
  const byName = new Map<string, FigmaToken>();
  const collisions: string[] = [];
  for (const token of [...variables, ...styles]) {
    const seen = byName.get(token.name);
    if (seen) {
      // Variables come first and win; two variables on one name is worth saying.
      if (seen.variable !== token.variable) {
        collisions.push(`${token.variable} and ${seen.variable}`);
      }
      continue;
    }
    byName.set(token.name, token);
  }
  if (collisions.length > 0) {
    notes.push(
      `Some Figma names come to the same token, and the first was kept: ${collisions.slice(0, 3).join("; ")}.`
    );
  }
  if (byName.size === 0) {
    notes.push(
      "The file defines no variables and no colour or shadow styles to take tokens from."
    );
  }
  const tokens = [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  const themes = [
    ...new Set(tokens.flatMap((t) => Object.keys(t.values)).filter((k) => k)),
  ];
  return { notes, themes, tokens };
};
