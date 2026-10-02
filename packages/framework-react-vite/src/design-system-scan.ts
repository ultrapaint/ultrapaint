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
import type {
  DesignSystemContext,
  DesignSystemScan,
} from "@ultrapaint/framework-api/node";

const COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const IMPORT_RE = /@import\s+(?:url\()?\s*["']([^"']+)["']/g;
const DECLARATION_RE = /(--[\w-]+)\s*:\s*([^;]+);?/;
const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/;
const PALETTE_RE = /^color-([a-z]+)-(\d{2,3})$/;
const DARK_RE =
  /\.dark\b|\[data-theme=["']?dark["']?\]|prefers-color-scheme:\s*dark|@variant\s+dark|@custom-variant\s+dark/;
const OTHER_THEME_RE = /\[data-theme=["']?([\w-]+)["']?\]/;
const TAILWIND_IMPORT_RE = /^tailwindcss(\/.*)?$/;

/** A block of declarations and where it was written. */
interface Scope {
  /** The at-rule or selector chain that holds it: `@theme inline`, `:root`, `.dark`. */
  readonly prelude: string;
  readonly vars: Map<string, string>;
}

/** Splits a stylesheet into the declaration blocks it has, nested ones with their outer prelude. */
const scopesOf = (css: string): Scope[] => {
  const scopes: Scope[] = [];
  const text = css.replace(COMMENT_RE, "");
  const stack: { prelude: string; vars: Map<string, string> }[] = [];
  let buffer = "";
  for (const char of text) {
    if (char === "{") {
      const outer = stack.map((s) => s.prelude).join(" ");
      stack.push({
        prelude: `${outer} ${buffer.trim()}`.trim(),
        vars: new Map(),
      });
      buffer = "";
    } else if (char === "}") {
      const top = stack.pop();
      const tail: RegExpExecArray | null = DECLARATION_RE.exec(buffer.trim());
      if (top && tail?.[1] && tail[2]) {
        top.vars.set(tail[1], tail[2].trim());
      }
      if (top && top.vars.size > 0) {
        scopes.push(top);
      }
      buffer = "";
    } else if (char === ";") {
      const decl: RegExpExecArray | null = DECLARATION_RE.exec(
        `${buffer.trim()};`
      );
      const top = stack.at(-1);
      if (decl?.[1] && decl[2] && top) {
        top.vars.set(decl[1], decl[2].trim());
      }
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return scopes;
};

/** Which theme a block's values belong to: the default, `dark`, or a named one. */
const themeOf = (prelude: string): string | null => {
  if (DARK_RE.test(prelude)) {
    return "dark";
  }
  const named: RegExpExecArray | null = OTHER_THEME_RE.exec(prelude);
  return named?.[1] && named[1] !== "light" ? named[1] : null;
};

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

/** The directory of an installed package, looked up the way Node would from `start`. */
const packageRoot = (pkg: string, start: string): string | null => {
  let dir = start;
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
const resolveImport = (
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

interface Collected {
  /** Files read, in order. */
  readonly files: string[];
  readonly scopes: Scope[];
  /** Whether `tailwindcss` itself was imported, which brings its default theme. */
  tailwind: boolean;
  /** Tailwind's own theme stylesheet, when it can be found. */
  tailwindTheme: string | null;
}

const collect = (entries: readonly string[], anchorDir: string): Collected => {
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
    for (const match of css.replace(COMMENT_RE, "").matchAll(IMPORT_RE)) {
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
const resolver = (vars: ReadonlyMap<string, string>) => {
  const resolve = (value: string, depth = 0): string => {
    if (depth > 10) {
      return value;
    }
    const match: RegExpExecArray | null = VAR_RE.exec(value);
    if (!match) {
      return value;
    }
    const [whole, name, fallback] = match;
    const replacement = vars.get(name as string) ?? fallback?.trim() ?? whole;
    if (replacement === whole) {
      return value;
    }
    return resolve(value.replace(whole, replacement), depth + 1);
  };
  return resolve;
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

/** Smallest first, for scales whose names do not sort: `sm`, `md`, `lg`, `xl`, `2xl`. */
const byLength = (a: Token, b: Token) =>
  lengthOf(a.value) - lengthOf(b.value) || byName(a, b);

const MS_RE = /^([\d.]+)ms$/;
const S_RE = /^([\d.]+)s$/;

/** A length or a duration as one number to sort by: rem as 16px, seconds as 1000ms. */
const lengthOf = (value: string) => {
  const v = value.trim();
  const ms: RegExpExecArray | null = MS_RE.exec(v);
  if (ms) {
    return Number(ms[1]);
  }
  const s: RegExpExecArray | null = S_RE.exec(v);
  if (s) {
    return Number(s[1]) * 1000;
  }
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return v.endsWith("rem") ? n * 16 : n;
};

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
  /** Tailwind's own `@theme`. */
  readonly defaultThemeVars: Map<string, string>;
  /** Custom properties outside any `@theme` and any theme selector. */
  readonly rootVars: Map<string, string>;
  /** Per theme (`dark`, …), what its selector sets. */
  readonly themed: Map<string, Map<string, string>>;
  /** The repository's `@theme` blocks. */
  readonly themeVars: Map<string, string>;
}

const setAll = (
  into: Map<string, string>,
  from: ReadonlyMap<string, string>
) => {
  for (const [k, v] of from) {
    into.set(k, v);
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
      setAll(out.defaultThemeVars, scope.vars);
    }
  }
  for (const scope of scopes) {
    const theme = themeOf(scope.prelude);
    if (theme) {
      const vars = out.themed.get(theme) ?? new Map<string, string>();
      setAll(vars, scope.vars);
      out.themed.set(theme, vars);
    } else if (scope.prelude.startsWith("@theme")) {
      setAll(out.themeVars, scope.vars);
    } else {
      setAll(out.rootVars, scope.vars);
    }
  }
  return out;
};

/** The theme variables that make tokens: Tailwind's defaults, less what the repository resets. */
const themeTokensOf = (
  defaultThemeVars: ReadonlyMap<string, string>,
  themeVars: ReadonlyMap<string, string>
) => {
  const ownColors = [...themeVars.keys()].some((k) => k.startsWith("--color-"));
  // A theme that resets a namespace (`--color-*: initial`) drops Tailwind's defaults for it.
  const reset = (ns: string) => themeVars.get(`--${ns}-*`) === "initial";
  const all = new Map<string, string>();
  for (const [k, v] of defaultThemeVars) {
    const ns = k.slice(2).split("-")[0] ?? "";
    // Tailwind's whole palette only when the repository has no colours of its own.
    if (!((k.startsWith("--color-") && ownColors) || reset(ns))) {
      all.set(k, v);
    }
  }
  for (const [k, v] of themeVars) {
    if (!k.endsWith("-*")) {
      all.set(k, v);
    }
  }
  return all;
};

/** Where a theme variable's token goes, by its Tailwind v4 namespace. First match wins. */
const NAMESPACES = [
  ["font-weight-", "weights"],
  ["font-", "fonts"],
  ["leading-", "leading"],
  ["tracking-", "tracking"],
  ["radius-", "radius"],
  ["shadow-", "shadows"],
  ["spacing-", "spacing"],
  ["border-width-", "borderWidths"],
  ["breakpoint-", "breakpoints"],
  ["container-", "containers"],
  ["ease-", "easings"],
  ["animate-", "animations"],
  ["duration-", "durations"],
  // Tailwind's own duration for `transition`, when nothing else says how long.
  ["default-transition-duration", "durations"],
] as const;

type Bucket = (typeof NAMESPACES)[number][1];

/** The theme's tokens sorted into what the design system shows. */
const classify = (
  all: ReadonlyMap<string, string>,
  token: (name: string, raw: string) => Token,
  resolveDefault: (value: string) => string
) => {
  const buckets: Record<Bucket, Token[]> = {
    animations: [],
    borderWidths: [],
    breakpoints: [],
    containers: [],
    durations: [],
    easings: [],
    fonts: [],
    leading: [],
    radius: [],
    shadows: [],
    spacing: [],
    tracking: [],
    weights: [],
  };
  const palettes = new Map<string, Token[]>();
  const semantic: Token[] = [];
  const sizes: FontSizeToken[] = [];
  let spacingBase = "0.25rem";
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
    const bucket = NAMESPACES.find(([prefix]) => name.startsWith(prefix))?.[1];
    if (name.startsWith("color-")) {
      color(name, raw);
    } else if (name.startsWith("text-") && !name.startsWith("text-shadow-")) {
      const lineHeight = all.get(`${variable}--line-height`);
      sizes.push({
        ...token(name, raw),
        ...(lineHeight && { lineHeight: resolveDefault(lineHeight) }),
      });
    } else if (name === "spacing") {
      spacingBase = resolveDefault(raw);
    } else if (bucket) {
      buckets[bucket].push(token(name, raw));
    }
  }
  return { ...buckets, palettes, semantic, sizes, spacingBase };
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

/** Border widths, elevation, icons, layout and motion: each left out when the theme has none. */
const moreFoundations = (found: {
  readonly animations: Token[];
  readonly borderWidths: Token[];
  readonly breakpoints: Token[];
  readonly colors: readonly TokenGroup[];
  readonly containers: Token[];
  readonly durations: Token[];
  readonly easings: Token[];
  readonly iconDirs: readonly string[];
  readonly shadows: readonly Token[];
}): Pick<
  DesignSystem,
  "borderWidths" | "elevation" | "icons" | "layout" | "motion"
> => {
  const sorted = (tokens: Token[], order: (a: Token, b: Token) => number) =>
    tokens.length > 0 ? tokens.sort(order) : undefined;
  const borderWidths = sorted(found.borderWidths, byLength);
  const breakpoints = sorted(found.breakpoints, byLength);
  const containers = sorted(found.containers, byLength);
  const animations = sorted(found.animations, byName);
  const durations = sorted(found.durations, byLength);
  const easings = sorted(found.easings, byName);
  const elevation = starterElevation(found);
  const icons = iconSetOf(found.iconDirs);
  return {
    ...(borderWidths && { borderWidths }),
    ...(elevation.length > 0 && { elevation }),
    ...(icons && { icons }),
    ...((breakpoints || containers) && {
      layout: {
        ...(breakpoints && { breakpoints }),
        ...(containers && { containers }),
      },
    }),
    ...((animations || durations || easings) && {
      motion: {
        ...(animations && { animations }),
        ...(durations && { durations }),
        ...(easings && { easings }),
      },
    }),
  };
};

export const scanDesignSystem = (
  ctx: DesignSystemContext
): DesignSystemScan => {
  // The preview's stylesheet imports them from the generated directory, and so they resolve.
  const generated = path.join(
    ctx.root,
    ctx.settings.designsDir,
    ".ultrapaint"
  );
  const entries = ctx.settings.hostCss
    .map((spec) =>
      resolveImport(spec, path.join(generated, "host.css"), ctx.anchorDir)
    )
    .filter((file): file is string => file !== null);
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
      const other = resolve(raw);
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

  const {
    animations,
    borderWidths,
    breakpoints,
    containers,
    durations,
    easings,
    fonts,
    leading,
    palettes,
    radius,
    semantic,
    shadows,
    sizes,
    spacing,
    spacingBase,
    tracking,
    weights,
  } = classify(all, token, resolveDefault);

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
  const styles = starterTextStyles({ fonts, leading, sizes, weights });
  notes.push(
    styles.length > 0
      ? "The text styles are a starter scale built from the theme's sizes, weights and leading; the product's own styles, component categories and example props cannot be read from CSS: ask the user or read the components."
      : "Text styles, component categories and example props cannot be read from CSS; ask the user or read the components."
  );

  const sorted = shadows.sort(byName);
  const more = moreFoundations({
    animations,
    borderWidths,
    breakpoints,
    colors,
    containers,
    durations,
    easings,
    iconDirs: [ctx.anchorDir, ctx.root],
    shadows: sorted,
  });
  if (more.elevation) {
    notes.push(
      "The elevation levels are a starter built from the surface colours and shadows the theme has; ask the user which surfaces and shadows the product pairs, and the z-index of each layer."
    );
  }

  const designSystem: DesignSystem = {
    ...more,
    colors,
    radius: radius.sort(byName),
    shadows: sorted,
    source: `Tailwind v4 theme in ${found.files.map((f) => path.relative(ctx.root, f)).join(", ") || "no stylesheet"}`,
    spacing: {
      base: spacingBase,
      ...(spacing.length > 0 && { tokens: spacing.sort(byName) }),
    },
    ...(themeNames.length > 0 && { themes: ["light", ...themeNames] }),
    typography: {
      fonts: fonts.sort(byName),
      ...(leading.length > 0 && { leading: leading.sort(byName) }),
      sizes: sizes.sort(
        (a, b) => Number.parseFloat(a.value) - Number.parseFloat(b.value)
      ),
      styles,
      ...(tracking.length > 0 && { tracking: tracking.sort(byName) }),
      weights: weights.sort(
        (a, b) => Number.parseFloat(a.value) - Number.parseFloat(b.value)
      ),
    },
    version: 1,
  };
  return {
    designSystem,
    files: found.files.map((f) =>
      path.relative(ctx.root, f).replaceAll("\\", "/")
    ),
    notes,
  };
};
