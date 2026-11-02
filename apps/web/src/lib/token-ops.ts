/**
 * What the board inspector's fields send (ADR 0045): a field's value as the design-system
 * operation it is, a palette's ramp generated from one colour as the operations that set it,
 * a text style's setting changed, and where a token is used. Pure; the inspector draws them and
 * `commitEdits` sends them.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { ComponentFile } from "@ultrapaint/contracts/components";
import type {
  DesignSystem,
  TextStyle,
  TextStyleSetting,
} from "@ultrapaint/contracts/design-system";
import type { DesignSystemEdit } from "@ultrapaint/contracts/design-system-edit";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  defaultTheme,
  isDarkTheme,
  themesOf,
} from "@ultrapaint/contracts/themes";
import { shortName, tokenOf } from "@ultrapaint/contracts/token-table";
import { RAMP_STEPS, rampOf, shadeOf } from "@ultrapaint/design-document/ramp";
import { tokensIn } from "@ultrapaint/design-document/tokens";
import { childrenOf } from "@ultrapaint/design-document/tree";

/** A token's own value in a theme, as it is written; undefined where it takes the default's. */
export const ownValueIn = (
  ds: DesignSystem,
  name: string,
  theme: string
): string | undefined => {
  const token = tokenOf(ds, name);
  if (!token) {
    return undefined;
  }
  return theme === defaultTheme(ds) ? token.value : token.values?.[theme];
};

/** A value typed into a theme's field, as the operation that sets it: null takes another theme's out. */
export const valueOp = (
  ds: DesignSystem,
  name: string,
  theme: string,
  value: string | null
): DesignSystemEdit =>
  theme === defaultTheme(ds)
    ? { name, op: "setValue", value: value ?? "" }
    : { name, op: "setValue", theme, value };

/** A palette a colour belongs to: the shades' prefix and the group they are in. */
export interface Palette {
  /** The group exists already. */
  readonly exists: boolean;
  readonly group: string;
  /** What each shade's name starts with: `color-primary` for `color-primary-600`. */
  readonly prefix: string;
}

/**
 * The palette "Generate ramp from…" fills: a shade's own (`color-primary-600` → `color-primary-*`
 * in its group), else one of the colour's name (`color-brand` → `color-brand-*` in a group
 * `brand`, made when there is none).
 */
export const paletteOf = (ds: DesignSystem, name: string): Palette => {
  const shade = shadeOf(name);
  const holder = ds.colors.find((g) => g.tokens.some((t) => t.name === name));
  if (shade && holder) {
    return { exists: true, group: holder.name, prefix: shade.prefix };
  }
  const group = shortName(name);
  return {
    exists: ds.colors.some((g) => g.name === group),
    group,
    prefix: name,
  };
};

/** A shade a ramp gives: its token and its value in each theme. */
interface GeneratedShade {
  readonly name: string;
  readonly step: number;
  readonly values: Readonly<Record<string, string>>;
}

/**
 * A palette's ramp from one colour: each shade's values, the default theme's run light to dark
 * and a dark theme's the other way (`rampOf`), and the operations that set them, one edit (the
 * group made first when it is not there, a shade it lacks added, the shades put in the order of
 * their steps). Null for a value that is no colour.
 */
export const rampEdits = (
  ds: DesignSystem,
  name: string,
  base: string
): {
  readonly ops: DesignSystemEdit[];
  readonly palette: Palette;
  readonly shades: GeneratedShade[];
} | null => {
  const themes = themesOf(ds);
  const runs = new Map(
    themes.map((theme) => [
      theme,
      rampOf(
        base,
        isDarkTheme(theme) && theme !== defaultTheme(ds) ? "dark" : "light"
      ),
    ])
  );
  if ([...runs.values()].some((run) => run === null)) {
    return null;
  }
  const palette = paletteOf(ds, name);
  const shades = RAMP_STEPS.map((step, i) => ({
    name: `${palette.prefix}-${step}`,
    step,
    values: Object.fromEntries(
      themes.map((theme) => [theme, runs.get(theme)?.[i]?.value ?? base])
    ),
  }));
  const [first = "light", ...others] = themes;
  const ops: DesignSystemEdit[] = palette.exists
    ? []
    : [{ name: palette.group, op: "addGroup" }];
  for (const shade of shades) {
    const value = shade.values[first] ?? base;
    if (tokenOf(ds, shade.name)) {
      ops.push({ name: shade.name, op: "setValue", value });
      for (const theme of others) {
        ops.push({
          name: shade.name,
          op: "setValue",
          theme,
          value: shade.values[theme] ?? value,
        });
      }
    } else {
      ops.push({
        group: palette.group,
        name: shade.name,
        op: "addToken",
        value,
        ...(others.length > 0 && {
          values: Object.fromEntries(
            others.map((theme) => [theme, shade.values[theme] ?? value])
          ),
        }),
      });
    }
  }
  // The shades in the order of their steps, at the head of the group.
  shades.forEach((shade, index) => {
    ops.push({
      group: palette.group,
      index,
      name: shade.name,
      op: "moveToken",
    });
  });
  return { ops, palette, shades };
};

/** A text style with one setting set, or taken out with null: the operation that saves it. */
export const textStyleOp = (
  style: TextStyle,
  setting: TextStyleSetting,
  value: JsonValue
): DesignSystemEdit => {
  const { [setting]: _was, ...rest } = style;
  const next =
    value === null || value === ""
      ? rest
      : { ...rest, [setting]: value as string | number };
  return { op: "setTextStyle", style: next as TextStyle };
};

/** A place a token is used in: a page and how many of its nodes, a component, a text style. */
export interface TokenUse {
  readonly count: number;
  readonly kind: "page" | "component" | "style";
  readonly name: string;
}

/** A node's own fields, without its children's. */
const ownFields = (node: DesignNode) =>
  "children" in node ? { ...node, children: undefined } : node;

/**
 * Where a token is used: the text styles that name it, the components whose files do, and the
 * pages given with how many of their nodes name it themselves or through their text style.
 */
export const usesOf = (
  name: string,
  given: {
    readonly components: readonly ComponentFile[];
    readonly ds: DesignSystem | null;
    readonly pages: readonly {
      readonly name: string;
      readonly root: DesignNode | null;
    }[];
  }
): TokenUse[] => {
  const styles = (given.ds?.typography.styles ?? []).filter((s) =>
    tokensIn(s).has(name)
  );
  const styled = new Set(styles.map((s) => s.name));
  const nodesUsing = (root: DesignNode | null): number => {
    if (!root) {
      return 0;
    }
    const own =
      tokensIn(ownFields(root)).has(name) ||
      (root.type === "text" &&
        root.textStyle !== undefined &&
        styled.has(root.textStyle))
        ? 1
        : 0;
    return childrenOf(root).reduce((n, child) => n + nodesUsing(child), own);
  };
  return [
    ...given.pages.flatMap((page): TokenUse[] => {
      const count = nodesUsing(page.root);
      return count > 0 ? [{ count, kind: "page", name: page.name }] : [];
    }),
    ...given.components
      .filter((c) => tokensIn(c).has(name))
      .map((c): TokenUse => ({ count: 1, kind: "component", name: c.name })),
    ...styles.map((s): TokenUse => ({ count: 1, kind: "style", name: s.name })),
  ];
};
