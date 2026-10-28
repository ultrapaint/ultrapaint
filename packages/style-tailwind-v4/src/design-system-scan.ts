/**
 * Reads a Tailwind v4 design system by fixed rules: the stylesheets the preview imports, the
 * stylesheets they import, their `@theme` blocks, and the custom properties those refer to. It
 * is the starting point `/init` hands an agent, and all there is when no agent is used. What
 * it cannot interpret — which colours are the brand, which text styles the product really uses
 * — it leaves to the agent, and says so in `notes`.
 */
import { existsSync, readFileSync } from "node:fs";
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
  tokenKindOf,
} from "@ultrapaint/contracts/token-table";
import {
  parseNumber,
  ROOT_PX,
  resolveVars,
  toMs,
  toPx,
} from "@ultrapaint/contracts/token-value";
import type { TokenKind } from "@ultrapaint/contracts/tokens";
import type {
  DesignSystemContext,
  DesignSystemScan,
} from "@ultrapaint/framework-api/node";
import {
  applyThemeDeclaration,
  isReset,
  masked,
  parseStylesheet,
} from "./stylesheet.ts";

const IMPORT_RE = /@import\s+(?:url\()?\s*["']([^"']+)["']/g;
const PALETTE_RE = /^color-([a-z]+)-(\d{2,3})$/;
const DARK_RE =
  /\.dark(?![\w-])|\[data-theme=["']?dark["']?\]|prefers-color-scheme:\s*dark|@(?:custom-)?variant\s+dark(?![\w-])/;
const OTHER_THEME_RE = /\[data-theme=["']?([\w-]+)["']?\]/;
const TAILWIND_IMPORT_RE = /^tailwindcss(\/.*)?$/;
/** A scope whose variables hold for the whole document: the default theme's. */
const ROOT_SCOPE_RE = /(^|[\s,])(:root|html|:host)\b/;

/** A block of declarations and where it was written. */
interface Scope {
  /** The at-rule or selector chain that holds it: `@theme inline`, `:root`, `.dark`. */
  readonly prelude: string;
  /** Its custom properties in the order they are written, which a reset depends on. */
  readonly vars: (readonly [string, string])[];
}

/** The blocks of a stylesheet that declare custom properties, nested ones with their outer prelude. */
const scopesOf = (css: string): Scope[] => {
  const scopes = new Map<number, Scope>();
  for (const decl of parseStylesheet("", css).declarations) {
    if (!decl.name.startsWith("--")) {
      continue;
    }
    const scope = scopes.get(decl.block) ?? { prelude: decl.prelude, vars: [] };
    scope.vars.push([decl.name, decl.value]);
    scopes.set(decl.block, scope);
  }
  return [...scopes.values()];
};

/** A prelude without its `:not(…)`s: what they name is where the block does not apply. */
const withoutNegations = (prelude: string): string => {
  let out = prelude;
  let at = out.indexOf(":not(");
  while (at !== -1) {
    let depth = 0;
    let end = at + 4;
    for (; end < out.length; end += 1) {
      depth += out[end] === "(" ? 1 : 0;
      depth -= out[end] === ")" ? 1 : 0;
      if (depth === 0) {
        break;
      }
    }
    out = out.slice(0, at) + out.slice(end + 1);
    at = out.indexOf(":not(");
  }
  return out;
};

/** Which theme a block's values belong to: the default, `dark`, or a named one. */
export const themeOf = (prelude: string): string | null => {
  const applies = withoutNegations(prelude);
  if (DARK_RE.test(applies)) {
    return "dark";
  }
  const named: RegExpExecArray | null = OTHER_THEME_RE.exec(applies);
  return named?.[1] && named[1] !== "light" ? named[1] : null;
};

/**
 * Whether a block that is no theme's gives the default theme its values: `:root`, `html` or
 * `:host`, not a class such as `.dark-blue` that only some of the page has.
 */
export const isRootScope = (prelude: string): boolean =>
  ROOT_SCOPE_RE.test(prelude);

/** The stylesheet a package exports under `sub` (its main one when `sub` is empty). */
const packageEntry = (root: string, sub: readonly string[]): string | null => {
  const direct = path.join(root, ...sub);
  if (sub.length > 0 && existsSync(direct)) {
    return direct;
  }
  let manifest: { exports?: Record<string, unknown>; style?: string };
  try {
    manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8")
    );
  } catch {
    // A manifest that cannot be read exports nothing we could follow.
    return null;
  }
  const entry = manifest.exports?.[sub.length > 0 ? `./${sub.join("/")}` : "."];
  const conditions = entry as { style?: string; default?: string } | undefined;
  const target =
    typeof entry === "string"
      ? entry
      : (conditions?.style ??
        conditions?.default ??
        (sub.length === 0 ? manifest.style : undefined));
  if (!target) {
    return null;
  }
  const file = path.join(root, target);
  return existsSync(file) ? file : null;
};

/**
 * The directory of an installed package, looked up the way Node would from `start`: in its own
 * `node_modules` or an ancestor's.
 */
export const packageRoot = (pkg: string, start: string): string | null => {
  let dir = path.resolve(start);
  for (;;) {
    const root = path.join(dir, "node_modules", pkg);
    if (existsSync(path.join(root, "package.json"))) {
      return root;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
};

/** The file a stylesheet import names: relative to the importer, or a package's. */
export const resolveImport = (
  specifier: string,
  from: string,
  anchorDir: string
): string | null => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const file = path.resolve(path.dirname(from), specifier);
    return existsSync(file) ? file : null;
  }
  // A package: look it up from the importer, then from the anchor.
  const [scope = "", name, ...rest] = specifier.split("/");
  const scoped = scope.startsWith("@");
  const pkg = scoped ? `${scope}/${name}` : scope;
  const sub = (scoped ? rest : [name, ...rest]).filter((part): part is string =>
    Boolean(part)
  );
  for (const start of [path.dirname(from), anchorDir]) {
    const root = packageRoot(pkg, start);
    if (root) {
      return packageEntry(root, sub);
    }
  }
  return null;
};

export interface Collected {
  /** Files read, in order. */
  readonly files: string[];
  readonly scopes: Scope[];
  /** Whether `tailwindcss` itself was imported, which brings its default theme. */
  tailwind: boolean;
  /** Tailwind's own theme stylesheet, when it can be found. */
  tailwindTheme: string | null;
}

export const collect = (
  entries: readonly string[],
  anchorDir: string
): Collected => {
  const out: Collected = {
    files: [],
    scopes: [],
    tailwind: false,
    tailwindTheme: null,
  };
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    let css: string;
    try {
      css = readFileSync(file, "utf8");
    } catch {
      return;
    }
    out.files.push(file);
    for (const match of masked(css).matchAll(IMPORT_RE)) {
      const specifier = match[1] as string;
      if (TAILWIND_IMPORT_RE.test(specifier)) {
        out.tailwind = true;
        out.tailwindTheme ??= resolveImport(
          "tailwindcss/theme.css",
          file,
          anchorDir
        );
        continue;
      }
      const target = resolveImport(specifier, file, anchorDir);
      if (target?.endsWith(".css")) {
        visit(target);
      }
    }
    out.scopes.push(...scopesOf(css));
  };
  for (const entry of entries) {
    visit(entry);
  }
  return out;
};

/** Follows `var(--x)` through the custom properties of one theme, to the value it ends at. */
const resolver = (vars: ReadonlyMap<string, string>) => (value: string) =>
  resolveVars(value, (name) => vars.get(name));

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

interface Variables {
  /** Tailwind's own `@theme`, less what the repository's resets take out. */
  readonly defaultThemeVars: Map<string, string>;
  /** Custom properties outside any `@theme` and any theme selector. */
  readonly rootVars: Map<string, string>;
  /** Per theme (`dark`, …), what its selector sets. */
  readonly themed: Map<string, Map<string, string>>;
  /** The repository's `@theme` blocks, their resets applied in order. */
  readonly themeVars: Map<string, string>;
}

const setAll = (
  into: Map<string, string>,
  from: Iterable<readonly [string, string]>
) => {
  for (const [k, v] of from) {
    into.set(k, v);
  }
};

/** One of the repository's `@theme` blocks, applied over what is declared before it. */
const applyRepositoryTheme = (out: Variables, scope: Scope) => {
  for (const [k, v] of scope.vars) {
    // Tailwind's defaults come before anything the repository writes, so a reset anywhere in
    // its theme takes them out.
    applyThemeDeclaration(out.themeVars, k, v);
    if (isReset(v)) {
      applyThemeDeclaration(out.defaultThemeVars, k, v);
    }
  }
};

const variablesOf = (
  defaults: readonly Scope[],
  scopes: readonly Scope[]
): Variables => {
  const out: Variables = {
    defaultThemeVars: new Map(),
    rootVars: new Map(),
    themed: new Map(),
    themeVars: new Map(),
  };
  for (const scope of defaults) {
    if (scope.prelude.startsWith("@theme")) {
      for (const [k, v] of scope.vars) {
        applyThemeDeclaration(out.defaultThemeVars, k, v);
      }
    }
  }
  for (const scope of scopes) {
    const theme = themeOf(scope.prelude);
    if (theme) {
      const vars = out.themed.get(theme) ?? new Map<string, string>();
      setAll(vars, scope.vars);
      out.themed.set(theme, vars);
    } else if (scope.prelude.startsWith("@theme")) {
      applyRepositoryTheme(out, scope);
    } else if (isRootScope(scope.prelude)) {
      setAll(out.rootVars, scope.vars);
    }
  }
  return out;
};

/**
 * Tailwind's defaults a design system leaves out, as it does its palette once the repository has
 * colours of its own: its inset, drop and text shadows, which the repository's are kept beside.
 */
const DEFAULTS_LEFT_OUT = [
  "--inset-shadow-",
  "--drop-shadow-",
  "--text-shadow-",
];

/** The theme variables that make tokens: Tailwind's defaults that are left, then the repository's. */
const themeTokensOf = (
  defaultThemeVars: ReadonlyMap<string, string>,
  themeVars: ReadonlyMap<string, string>
) => {
  const ownColors = [...themeVars.keys()].some((k) => k.startsWith("--color-"));
  const all = new Map<string, string>();
  for (const [k, v] of defaultThemeVars) {
    // Tailwind's whole palette only when the repository has no colours of its own.
    const palette = k.startsWith("--color-") && ownColors;
    if (!(palette || DEFAULTS_LEFT_OUT.some((p) => k.startsWith(p)))) {
      all.set(k, v);
    }
  }
  setAll(all, themeVars);
  return all;
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
 * The theme's tokens sorted into what the design system shows, each by its kind (the token
 * table's): the colours into Tailwind's palettes and the rest, a font size with its line height,
 * every other kind in its order. A variable of no kind the table knows is left out.
 */
const classify = (
  all: ReadonlyMap<string, string>,
  token: (name: string, raw: string) => Token,
  resolveDefault: (value: string) => string
) => {
  const byKind = new Map<TokenKind, Token[]>();
  const palettes = new Map<string, Token[]>();
  const semantic: Token[] = [];
  const sizes: FontSizeToken[] = [];
  let spacingBase = DEFAULT_SPACING_BASE;
  const color = (name: string, raw: string) => {
    const palette: RegExpExecArray | null = PALETTE_RE.exec(name);
    const group = palette?.[1];
    if (group) {
      palettes.set(group, [...(palettes.get(group) ?? []), token(name, raw)]);
    } else {
      semantic.push(token(name, raw));
    }
  };

  for (const [variable, raw] of all) {
    const name = variable.slice(2);
    // `--text-sm--line-height`, `--font-sans--font-feature-settings`: companions, read below.
    if (name.includes("--")) {
      continue;
    }
    const kind = tokenKindOf(name);
    if (name === SPACING_BASE) {
      spacingBase = resolveDefault(raw);
    } else if (kind === "color") {
      color(name, raw);
    } else if (kind === "fontSize") {
      const lineHeight = all.get(`${variable}--line-height`);
      sizes.push({
        ...token(name, raw),
        ...(lineHeight && { lineHeight: resolveDefault(lineHeight) }),
      });
    } else if (kind !== "other") {
      byKind.set(kind, [...(byKind.get(kind) ?? []), token(name, raw)]);
    }
  }
  const of = (kind: TokenKind) =>
    (byKind.get(kind) ?? []).sort(ORDERS[kind] ?? byName);
  const sorted = [...byKind.keys()].flatMap(of);
  return { of, palettes, semantic, sizes, sorted, spacingBase };
};

const VAR_ONLY_RE = /^var\(\s*--[\w-]+\s*\)$/;

/**
 * The variables `@theme inline` defines as another variable (`--color-foreground:
 * var(--foreground)`). Tailwind resolves them once, at the root, so a design drawn inside a
 * theme's scope — a `.dark` wrapper, a `[data-theme]` — still gets the root's values; declared
 * again on every element, they follow the scope they are used in.
 */
export const inlineThemeAliases = (
  hostCss: readonly string[],
  hostFile: string,
  anchorDir: string
): Map<string, string> => {
  const entries = hostCss
    .map((spec) => resolveImport(spec, hostFile, anchorDir))
    .filter((file): file is string => file !== null);
  const aliases = new Map<string, string>();
  for (const scope of collect(entries, anchorDir).scopes) {
    if (!scope.prelude.includes("@theme inline")) {
      continue;
    }
    for (const [name, value] of scope.vars) {
      if (VAR_ONLY_RE.test(value)) {
        aliases.set(name, value);
      }
    }
  }
  return aliases;
};

/**
 * What the stylesheets the settings name are relative to: the preview's stylesheet as it was
 * once generated, `<designs>/.ultrapaint/host.css`. It is generated elsewhere since ADR 0034;
 * the settings keep their meaning.
 */
export const hostCssBase = (
  ctx: Pick<DesignSystemContext, "root" | "settings">
): string =>
  path.join(ctx.root, ctx.settings.designsDir, ".ultrapaint", "host.css");

/** The stylesheets the settings name, as files. */
export const hostEntries = (ctx: DesignSystemContext): string[] =>
  ctx.settings.hostCss
    .map((spec) => resolveImport(spec, hostCssBase(ctx), ctx.anchorDir))
    .filter((file): file is string => file !== null);

export const scanDesignSystem = (
  ctx: DesignSystemContext
): DesignSystemScan => {
  const entries = hostEntries(ctx);
  const found = collect(entries, ctx.anchorDir);
  const notes: string[] = [];
  if (entries.length === 0) {
    notes.push(
      "No stylesheet is configured for the preview (Settings → Stylesheets), so no token could be read."
    );
  }
  if (!found.tailwind) {
    notes.push(
      "The stylesheets do not import tailwindcss. Only Tailwind v4 design systems are supported."
    );
  }

  // Tailwind's defaults first, the repository's own theme over them.
  const defaults = found.tailwindTheme
    ? scopesOf(readFileSync(found.tailwindTheme, "utf8"))
    : [];
  const { defaultThemeVars, rootVars, themed, themeVars } = variablesOf(
    defaults,
    found.scopes
  );
  const all = themeTokensOf(defaultThemeVars, themeVars);

  const base = new Map([...defaultThemeVars, ...rootVars, ...themeVars]);
  const resolveDefault = resolver(base);
  const themeNames = [...themed.keys()];
  const resolveIn = new Map(
    themeNames.map((name) => [
      name,
      resolver(new Map([...base, ...(themed.get(name) ?? [])])),
    ])
  );

  const token = (name: string, raw: string): Token => {
    const value = resolveDefault(raw);
    const values: Record<string, string> = {};
    for (const [theme, resolve] of resolveIn) {
      // A theme's block may set the theme variable itself (`.dark { --color-accent: … }`), not
      // only what an `@theme inline` alias points at: the design system holds both (ADR 0028).
      const own = themed.get(theme)?.get(`--${name}`);
      const other = resolve(own ?? raw);
      if (other !== value) {
        values[theme] = other;
      }
    }
    return {
      name,
      value,
      ...(Object.keys(values).length > 0 && { values }),
    };
  };

  const { of, palettes, semantic, sizes, sorted, spacingBase } = classify(
    all,
    token,
    resolveDefault
  );

  const colors: TokenGroup[] = [
    ...(semantic.length > 0
      ? [{ name: "Semantic", tokens: semantic.sort(byName) }]
      : []),
    ...[...palettes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, tokens]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        tokens: tokens.sort(byName),
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
      ? "The text styles are a starter scale built from the theme's sizes, weights and leading; the product's own styles, component categories and example props cannot be read from CSS: ask the user or read the components."
      : "Text styles, component categories and example props cannot be read from CSS; ask the user or read the components."
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
      source: `Tailwind v4 theme in ${found.files.map((f) => path.relative(ctx.root, f)).join(", ") || "no stylesheet"}`,
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
    files: found.files.map((f) =>
      path.relative(ctx.root, f).replaceAll("\\", "/")
    ),
    notes,
    ownTokens: [...themeVars.keys()].map((k) => k.slice(2)),
  };
};
