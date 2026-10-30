/**
 * A first Tailwind v4 design system by fixed rules, from the tokens the code declares as the
 * reader reads them (`tokens.ts`: the stylesheets the preview imports, their `@theme` blocks, the
 * variables those refer to, theme by theme): the same values Sync compares the design with, so
 * nothing is to settle right after `/init`. It is the starting point `/init` hands an agent, and
 * all there is when no agent is used. It sorts the tokens: the palettes, the colours named for
 * what they do, a starter type scale and elevation. What it cannot interpret — which colours are
 * the brand, which text styles the product really uses — it leaves to the agent, and says so in
 * `notes`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type DesignSystem,
  type FontSizeToken,
  type IconSet,
  starterElevation,
  starterTextStyles,
  type Token,
  type TokenGroup,
} from "@ultrapaint/contracts/design-system";
import {
  addTokens,
  DEFAULT_SPACING_BASE,
  SPACING_BASE,
  shortName,
} from "@ultrapaint/contracts/token-table";
import {
  parseNumber,
  ROOT_PX,
  toMs,
  toPx,
} from "@ultrapaint/contracts/token-value";
import type { SourceToken, TokenKind } from "@ultrapaint/contracts/tokens";
import { shadeOf } from "@ultrapaint/design-document/ramp";
import type {
  DesignSystemContext,
  DesignSystemScan,
} from "@ultrapaint/framework-api/node";
import { read } from "./tokens.ts";

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

/** Smallest first, for scales whose names do not sort: `sm`, `md`, `lg`, `xl`, `2xl`. */
const byLength = (a: Token, b: Token) =>
  lengthOf(a.value) - lengthOf(b.value) || byName(a, b);

/** A length or a duration as one number to sort by: pixels (an `em` as the root's) or milliseconds. */
const lengthOf = (value: string) =>
  toPx(value, { em: ROOT_PX }) ?? toMs(value) ?? parseNumber(value) ?? 0;

/** Icon packages a React project draws with, the most common first, and the sizes they default to. */
const ICON_PACKAGES: readonly (readonly [string, readonly number[]])[] = [
  ["lucide-react", [16, 20, 24]],
  ["@heroicons/react", [16, 20, 24]],
  ["@tabler/icons-react", [16, 20, 24]],
  ["@phosphor-icons/react", [16, 20, 24]],
  ["@radix-ui/react-icons", [15]],
  ["react-icons", [16, 20, 24]],
];

/** The icon package the project depends on, from the first manifest that names one. */
const iconSetOf = (dirs: readonly string[]): IconSet | null => {
  for (const dir of dirs) {
    let manifest: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    try {
      manifest = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8")
      );
    } catch {
      // No manifest here, or not one we can read: look in the next directory.
      continue;
    }
    const deps = { ...manifest.devDependencies, ...manifest.dependencies };
    const found = ICON_PACKAGES.find(([pkg]) => pkg in deps);
    if (found) {
      return { from: found[0], sizes: [...found[1]] };
    }
  }
  return null;
};

/**
 * Tailwind's defaults a design system leaves out, as it does its palette once the repository has
 * colours of its own: its inset, drop and text shadows, which the repository's are kept beside.
 */
const DEFAULTS_LEFT_OUT = ["inset-shadow-", "drop-shadow-", "text-shadow-"];

/** The tokens a first design system lists: Tailwind's defaults that are left, then the repository's. */
const tokensKept = (tokens: readonly SourceToken[]): SourceToken[] => {
  const ownColors = tokens.some((t) => t.own && t.kind === "color");
  return tokens.filter(
    (t) =>
      t.own ||
      !(
        // Tailwind's whole palette only when the repository has no colours of its own.
        (t.kind === "color" && ownColors) ||
        DEFAULTS_LEFT_OUT.some((p) => t.name.startsWith(p))
      )
  );
};

/** A token as the design system lists it: its values in the other themes where they differ. */
const tokenOf = (t: SourceToken): Token => {
  const values = Object.fromEntries(
    Object.entries(t.values ?? {}).filter(([, value]) => value !== t.value)
  );
  return {
    name: t.name,
    value: t.value,
    ...(Object.keys(values).length > 0 && { values }),
  };
};

/** The order a kind's tokens are listed in: by name, but where a name does not sort. */
const ORDERS: Partial<Record<TokenKind, (a: Token, b: Token) => number>> = {
  borderWidth: byLength,
  breakpoint: byLength,
  container: byLength,
  duration: byLength,
  fontWeight: (a, b) => Number.parseFloat(a.value) - Number.parseFloat(b.value),
};

/**
 * The tokens sorted into what the design system shows, each by its kind (the token table's): the
 * colours into Tailwind's palettes and the rest, a font size with its line height, every other
 * kind in its order. A token of no kind the table knows is left out.
 */
const classify = (
  tokens: readonly SourceToken[],
  lineHeightOf: (name: string) => string | undefined
) => {
  const byKind = new Map<TokenKind, Token[]>();
  const palettes = new Map<string, Token[]>();
  const semantic: Token[] = [];
  const sizes: FontSizeToken[] = [];
  let spacingBase = DEFAULT_SPACING_BASE;
  for (const t of tokens) {
    const { kind, name } = t;
    if (name === SPACING_BASE) {
      spacingBase = t.value;
    } else if (kind === "color") {
      const shade = shadeOf(name);
      const group = shade && shortName(shade.prefix);
      if (group) {
        palettes.set(group, [...(palettes.get(group) ?? []), tokenOf(t)]);
      } else {
        semantic.push(tokenOf(t));
      }
    } else if (kind === "fontSize") {
      const lineHeight = lineHeightOf(name);
      sizes.push({ ...tokenOf(t), ...(lineHeight && { lineHeight }) });
    } else if (kind !== "other") {
      byKind.set(kind, [...(byKind.get(kind) ?? []), tokenOf(t)]);
    }
  }
  const of = (kind: TokenKind) =>
    (byKind.get(kind) ?? []).sort(ORDERS[kind] ?? byName);
  const sorted = [...byKind.keys()].flatMap(of);
  return { of, palettes, semantic, sizes, sorted, spacingBase };
};

export const scanDesignSystem = (
  ctx: DesignSystemContext
): DesignSystemScan => {
  const reading = read(ctx);
  const { themes: themeNames, tokens } = reading.source;
  const notes = [...reading.source.notes];
  if (!reading.tailwind) {
    notes.push(
      "The stylesheets do not import tailwindcss. Only Tailwind v4 design systems are supported."
    );
  }

  const { of, palettes, semantic, sizes, sorted, spacingBase } = classify(
    tokensKept(tokens),
    reading.lineHeightOf
  );

  const colors: TokenGroup[] = [
    ...(semantic.length > 0
      ? [{ name: "Semantic", tokens: semantic.sort(byName) }]
      : []),
    ...[...palettes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, shades]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        tokens: shades.sort(byName),
      })),
  ];
  if (colors.length === 0) {
    notes.push("No colour tokens were found in the @theme blocks.");
  }
  const styles = starterTextStyles({
    fonts: of("font"),
    leading: of("leading"),
    sizes,
    weights: of("fontWeight"),
  });
  notes.push(
    styles.length > 0
      ? "The text styles are a starter scale built from the theme's sizes, weights and leading; the product's own styles cannot be read from CSS: ask the user or read the code."
      : "Text styles cannot be read from CSS; ask the user or read the code."
  );

  const elevation = starterElevation({ colors, shadows: of("shadow") });
  if (elevation.length > 0) {
    notes.push(
      "The elevation levels are a starter built from the surface colours and shadows the theme has; ask the user which surfaces and shadows the product pairs, and the z-index of each layer."
    );
  }
  const icons = iconSetOf([ctx.anchorDir, ctx.root]);

  // Every kind but the colours and sizes goes where the token table lists it.
  const designSystem: DesignSystem = addTokens(
    {
      ...(elevation.length > 0 && { elevation }),
      ...(icons && { icons }),
      colors,
      radius: [],
      shadows: [],
      source: `Tailwind v4 theme in ${reading.files.map((f) => path.relative(ctx.root, f)).join(", ") || "no stylesheet"}`,
      spacing: { base: spacingBase },
      ...(themeNames.length > 0 && { themes: ["light", ...themeNames] }),
      typography: {
        fonts: [],
        sizes: sizes.sort((a, b) => lengthOf(a.value) - lengthOf(b.value)),
        styles,
        weights: [],
      },
      version: 1,
    },
    sorted
  );
  return {
    designSystem,
    files: [...reading.source.files],
    notes,
    ownTokens: tokens.filter((t) => t.own).map((t) => t.name),
  };
};
