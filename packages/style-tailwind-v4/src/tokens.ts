/**
 * Tailwind v4's tokens as the code declares them, and written back where they are declared
 * (ADR 0024, 0152). A token is a variable of an `@theme` block: `--color-primary: #2563eb`, or a
 * variable with a token's name in a plain root block, `:root { --color-panel: #f5f5f5; }`, which
 * Tailwind makes no utility of (`variableOnly`). A block under `@media`, `@supports` or
 * `@container` is that condition's override (ADR 0158): it makes no token, gives none its base
 * value or a theme's, and is never written by an export. The common shadcn arrangement declares
 * a token as an alias of its own per-theme variable, `--color-primary: var(--primary)` in `@theme
 * inline`, with the value in `:root` and `.dark`; the value is then read from, and written to,
 * the variable the alias names, once per theme. An alias of a variable other declarations share,
 * a palette step, is read through but never written through.
 *
 * Reading follows the stylesheets the preview imports, and their imports, as Tailwind does;
 * Tailwind's own `theme.css` gives the defaults, which are listed but never written. Which theme
 * a block's values belong to is read here once, for every reader: the tokens Sync compares and
 * the first design system `/init` starts from (`design-system-scan.ts`) alike.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  nameOfVariable,
  tokenKindOf,
  variableOf,
} from "@ultrapaint/contracts/token-table";
import { resolveVars, sameValue } from "@ultrapaint/contracts/token-value";
import type {
  FileEdit,
  SourceToken,
  TokenChange,
  TokenOrigin,
  TokenSource,
  TokenWrite,
  TokenWriting,
} from "@ultrapaint/contracts/tokens";
import type { DesignSystemContext } from "@ultrapaint/framework-api/node";
import { toPosix } from "@ultrapaint/shared/path";
import {
  applyThemeDeclaration,
  type Block,
  type Declaration,
  isReset,
  masked,
  parseStylesheet,
  resetCovers,
} from "./stylesheet.ts";

const ALIAS_RE = /^var\(\s*(--[\w-]+)\s*\)$/;
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
const IMPORT_RE = /@import\s+(?:url\()?\s*["']([^"']+)["']/g;
const DARK_RE =
  /\.dark(?![\w-])|\[data-theme=["']?dark["']?\]|prefers-color-scheme:\s*dark|@(?:custom-)?variant\s+dark(?![\w-])/;
/** A theme's name in quotes is any text (`"dark mode"`, as `selectorOf` writes it); bare, one word. */
const OTHER_THEME_RE = /\[data-theme=(?:"([^"]+)"|'([^']+)'|([\w-]+))\]/;
const TAILWIND_IMPORT_RE = /^tailwindcss(\/.*)?$/;
/** The variables a value names: `--gray-200` of `var(--gray-200)`. */
const VAR_NAME_RE = /var\(\s*(--[\w-]+)/g;
/** The selectors a block that holds for the whole document is written under. */
const ROOT_SELECTORS = new Set([":root", "html", ":host"]);
/** A cascade layer around a block: it changes which value wins, not where the value holds. */
const LAYER_RE = /@layer(?:\s+[\w.-]+)?/g;
/**
 * The media query that is the dark theme's, as `DARK_RE` reads it: a theme, not a condition. Only
 * on its own: `and (min-width: 1024px)` after it is a condition again.
 */
const DARK_SCHEME_RE =
  /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)(?!\s*(?:and|or|,))/g;
/** The simple selectors a document's or a theme's block is written with: `:root`, `.dark`, `[…]`. */
const SIMPLE_SELECTOR_RE = /:root|:host|html|body|\.[\w-]+|\[[^\]]+\]/g;

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
  const name = named?.[1] ?? named?.[2] ?? named?.[3];
  return name && name !== "light" ? name : null;
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

/**
 * The directory of an installed package, looked up the way Node would from `start`: in its own
 * `node_modules` or an ancestor's.
 */
const packageRoot = (pkg: string, start: string): string | null => {
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

const readFile = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // Imported but missing, unreadable, or gone since it was listed: there is nothing to
    // read, and the stylesheets that are there are read without it.
    return null;
  }
};

export interface Collected {
  /**
   * The same files in the order their rules apply: what a stylesheet imports before the
   * stylesheet itself, as CSS puts an `@import`ed sheet where the `@import` stands.
   */
  readonly cascade: string[];
  /**
   * Files read, in the order the stylesheets name them: an entry, then what it imports.
   */
  readonly files: string[];
  /** Whether `tailwindcss` itself was imported, which brings its default theme. */
  tailwind: boolean;
  /** Tailwind's own theme stylesheet, when it can be found. */
  tailwindTheme: string | null;
}

/** The stylesheets the entries import, in the order Tailwind reads them, Tailwind's own aside. */
export const collect = (
  entries: readonly string[],
  anchorDir: string
): Collected => {
  const out: Collected = {
    cascade: [],
    files: [],
    tailwind: false,
    tailwindTheme: null,
  };
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    const css = readFile(file);
    if (css === null) {
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
    out.cascade.push(file);
  };
  for (const entry of entries) {
    visit(entry);
  }
  return out;
};

/**
 * What the stylesheets the settings name are relative to: the preview's stylesheet as it was
 * once generated, `<designs>/.ultrapaint/host.css`. It is generated elsewhere since ADR 0034;
 * the settings keep their meaning.
 */
const hostCssBase = (
  ctx: Pick<DesignSystemContext, "root" | "settings">
): string =>
  path.join(ctx.root, ctx.settings.designsDir, ".ultrapaint", "host.css");

/** The stylesheets the settings name, as files. */
const hostEntries = (ctx: DesignSystemContext): string[] =>
  ctx.settings.hostCss
    .map((spec) => resolveImport(spec, hostCssBase(ctx), ctx.anchorDir))
    .filter((file): file is string => file !== null);

/** The variable a value is an alias of, `var(--primary)`; undefined for anything else. */
const aliasOf = (value: string): string | undefined => {
  const match: RegExpExecArray | null = ALIAS_RE.exec(value);
  return match?.[1];
};

/** The custom properties a stylesheet declares, with their offsets, and its blocks. */
const customPropertiesOf = (file: string, text: string) => {
  const parsed = parseStylesheet(file, text);
  return {
    blocks: parsed.blocks,
    declarations: parsed.declarations.filter((d) => d.name.startsWith("--")),
  };
};

const isTheme = (prelude: string) => prelude.includes("@theme");

/**
 * The theme a block of plain variables gives values for whatever the page is like (`""` the
 * default, as `themeKeyOf` names them), or none: a block under `@media`, `@supports` or
 * `@container`, or one that is not the whole document's (`:root .card`, `.dark .card`), holds
 * only some of the time or some of the page. `body` is a theme's place (`body.dark`), not the
 * document's.
 */
const plainThemeKeyOf = (prelude: string): string | null => {
  const unlayered = prelude.replace(LAYER_RE, "");
  const bare = unlayered.replace(DARK_SCHEME_RE, "").trim();
  if (bare.includes("@")) {
    return null;
  }
  /** Under `@media (prefers-color-scheme: dark)`, which the replace above took out. */
  const schemeDark = bare !== unlayered.trim();
  // A selector list holds wherever one of its selectors does: `:root, .x` is the document's. A
  // selector counts when it is the document's or a theme's alone, with no descendant: `:root`,
  // `.dark`, `html[data-theme="dim"]`, not `.dark .card`.
  const keys = withoutNegations(bare)
    .split(",")
    .map((selector): string | null => {
      const s = selector.trim();
      const simples: readonly string[] = s.match(SIMPLE_SELECTOR_RE) ?? [];
      if (s === "" || simples.join("") !== s) {
        return null;
      }
      const named = simples
        .filter((simple) => !(ROOT_SELECTORS.has(simple) || simple === "body"))
        .map(themeOf);
      if (named.includes(null)) {
        return null;
      }
      const [theme] = named;
      if (theme === undefined) {
        return simples.includes("body") ? null : "";
      }
      return theme;
    })
    .filter((key): key is string => key !== null);
  if (keys.length === 0) {
    return null;
  }
  if (schemeDark) {
    return "dark";
  }
  return keys.find((key) => key !== "") ?? "";
};

/** A token's name from its variable; null for what is not a token of its own. */
const tokenNameOf = (variable: string): string | null => {
  const name = variable.slice(2);
  // `--text-xs--line-height` belongs to `text-xs`; `--color-*: initial` resets a namespace.
  if (name.includes("--") || name.includes("*") || name === "") {
    return null;
  }
  // `--spacing-1_5` is the step `spacing-1.5`, as Tailwind writes it.
  return nameOfVariable(variable);
};

/** The declarations of the stylesheets, sorted into what reading and writing need. */
interface Declared {
  /** Every custom property declared, in every block, in the order read. */
  readonly all: Declaration[];
  readonly blocks: Block[];
  /** The `@theme` declarations of what belongs to a token, `--text-sm--line-height`, by variable. */
  readonly companions: Map<string, Declaration>;
  /** The `@theme` declaration of each token, by name; the last one wins, as in CSS. */
  readonly declared: Map<string, Declaration>;
  /**
   * The plain variables of the blocks that hold whatever the page is like, by theme (`""` the
   * default), then by variable: none under `@media`, `@supports` or `@container`, or of part of
   * the page (`:root .card`). A token's name among the default theme's is a token declared
   * outside `@theme`.
   */
  readonly plain: Map<string, Map<string, Declaration>>;
  /** The `@theme` resets, `--color-*` of `--color-*: initial`, which take Tailwind's defaults out. */
  readonly resets: string[];
  /** The same resets where they are written: a token added before one would be taken out. */
  readonly resetsAt: Declaration[];
}

/** A `@theme` declaration taken in: a token, or a reset of the tokens declared before it. */
const takeTheme = (out: Declared, decl: Declaration) => {
  if (!isReset(decl.value)) {
    const name = tokenNameOf(decl.name);
    if (name) {
      out.declared.set(name, decl);
    } else {
      out.companions.set(decl.name, decl);
    }
    return;
  }
  // As Tailwind reads it: the tokens declared so far that it covers are gone too.
  for (const declared of [...out.declared.keys()]) {
    if (resetCovers(decl.name, variableOf(declared))) {
      out.declared.delete(declared);
    }
  }
  for (const companion of [...out.companions.keys()]) {
    if (resetCovers(decl.name, companion)) {
      out.companions.delete(companion);
    }
  }
  out.resets.push(decl.name);
  out.resetsAt.push(decl);
};

const declarationsOf = (files: readonly string[]): Declared => {
  const out: Declared = {
    all: [],
    blocks: [],
    companions: new Map(),
    declared: new Map(),
    plain: new Map(),
    resets: [],
    resetsAt: [],
  };
  const put = (key: string, decl: Declaration) => {
    const vars = out.plain.get(key) ?? new Map<string, Declaration>();
    vars.set(decl.name, decl);
    out.plain.set(key, vars);
  };
  for (const file of files) {
    const text = readFile(file);
    if (text === null) {
      continue;
    }
    const parsed = customPropertiesOf(file, text);
    out.blocks.push(...parsed.blocks);
    out.all.push(...parsed.declarations);
    for (const decl of parsed.declarations) {
      const key = isTheme(decl.prelude) ? null : plainThemeKeyOf(decl.prelude);
      if (isTheme(decl.prelude)) {
        takeTheme(out, decl);
      } else if (key !== null) {
        put(key, decl);
      }
    }
  }
  return out;
};

/**
 * Tailwind's own theme as written, less what the resets take out: its variables, a token's
 * companions among them, and its tokens by name.
 */
const defaultsOf = (
  file: string | null,
  resets: readonly string[]
): {
  readonly tokens: Map<string, string>;
  readonly variables: Map<string, string>;
} => {
  const vars = new Map<string, string>();
  const text = file ? readFile(file) : null;
  if (file && text) {
    for (const decl of customPropertiesOf(file, text).declarations) {
      if (isTheme(decl.prelude)) {
        applyThemeDeclaration(vars, decl.name, decl.value);
      }
    }
  }
  for (const reset of resets) {
    applyThemeDeclaration(vars, reset, "initial");
  }
  const tokens = new Map<string, string>();
  for (const [variable, value] of vars) {
    const name = tokenNameOf(variable);
    if (name) {
      tokens.set(name, value);
    }
  }
  return { tokens, variables: vars };
};

/**
 * Where a token's values are in the app, for reading and writing alike (ADR 0152). An unlayered
 * root declaration of the token's own variable overrides its `@theme` one, which Tailwind writes
 * into its `theme` layer, alias or not; under `@theme inline` the utilities take the `@theme`
 * value itself, and it stays the token's. A theme's value is in the theme's own block, never in
 * one under a condition (ADR 0158).
 */
const holderOf = (found: Declared, name: string) => {
  const decl = found.declared.get(name);
  const own = decl?.name ?? variableOf(name);
  const document = found.plain.get("");
  const root = document?.get(own);
  const rootWins = root !== undefined && !decl?.prelude.includes("inline");
  const alias = decl && !rootWins ? aliasOf(decl.value) : undefined;
  // `--color-primary: var(--primary)`: the value is the variable's, theme by theme. Else a theme
  // may declare the token's variable again, `.dark { --color-primary: … }`.
  const variable = alias && document?.has(alias) ? alias : own;
  const ownTarget = rootWins ? root : decl;
  return {
    decl,
    own,
    root,
    /** The declaration the default value is read from, and a change of it written to. */
    target: variable === own ? ownTarget : document?.get(variable),
    variable,
  };
};

/** What the reading keeps beyond the tokens: what a write needs to find its place. */
export interface Reading extends Declared {
  /** Every stylesheet read, absolute, in the order their rules apply (`Collected.cascade`). */
  readonly cascade: readonly string[];
  /** Tailwind's own theme variables, less what the resets take out. */
  readonly defaultVariables: ReadonlyMap<string, string>;
  /** Every stylesheet read, absolute, an entry before what it imports. */
  readonly files: readonly string[];
  /** A font size's line height (`--text-sm--line-height`), the value it ends at; none without. */
  readonly lineHeightOf: (name: string) => string | undefined;
  /** A value with its `var()`s followed in a theme, as the tokens' values are. */
  readonly resolve: (value: string, theme: string) => string;
  readonly source: TokenSource;
  /** Whether the stylesheets import `tailwindcss`, which brings its default theme. */
  readonly tailwind: boolean;
  /** The stylesheets the repository writes, absolute, in the order they are read. */
  readonly writable: string[];
}

/**
 * Follows the `var()`s of a value through one theme's unconditional variables, then the
 * default's, then the tokens'.
 */
const resolverOf =
  (found: Declared, defaults: ReadonlyMap<string, string>) =>
  (value: string, theme: string): string =>
    resolveVars(value, (variable) => {
      const name = tokenNameOf(variable) ?? "";
      return (
        found.plain.get(theme)?.get(variable)?.value ??
        found.plain.get("")?.get(variable)?.value ??
        found.declared.get(name)?.value ??
        defaults.get(name)
      );
    });

export const read = (ctx: DesignSystemContext): Reading => {
  const entries = hostEntries(ctx);
  const found = collect(entries, ctx.anchorDir);
  const notes =
    entries.length === 0
      ? [
          "No stylesheet is configured for the preview (Settings → Stylesheets), so no token could be read.",
        ]
      : [];
  const inside = path.resolve(ctx.root) + path.sep;
  const writable = found.files.filter(
    (file) =>
      !NODE_MODULES_RE.test(file) && path.resolve(file).startsWith(inside)
  );
  const declared = declarationsOf(found.cascade);
  const { tokens: defaults, variables: defaultVariables } = defaultsOf(
    found.tailwindTheme,
    declared.resets
  );
  const resolve = resolverOf(declared, defaults);
  const themes = [...declared.plain.keys()].filter((k) => k !== "");
  const relative = (file: string) => toPosix(path.relative(ctx.root, file));

  /** A token's value and where it is written, in each theme, as `holderOf` finds them. */
  const tokenOf = (name: string): SourceToken => {
    const { decl, target: base, variable } = holderOf(declared, name);
    const origins: Record<string, TokenOrigin> = {};
    const values: Record<string, string> = {};
    const at = (theme: string, where: Declaration) => {
      if (writable.includes(where.file)) {
        origins[theme] = {
          end: where.valueEnd,
          file: relative(where.file),
          start: where.valueStart,
        };
      }
    };
    if (base) {
      at("", base);
    }
    for (const theme of themes) {
      const own = declared.plain.get(theme)?.get(variable);
      if (own) {
        values[theme] = resolve(own.value, theme);
        at(theme, own);
      }
    }
    return {
      kind: tokenKindOf(name),
      name,
      ...(Object.keys(origins).length > 0 && { origins }),
      own: true,
      value: base ? resolve(base.value, "") : "",
      ...(Object.keys(values).length > 0 && { values }),
      ...(decl === undefined && { variableOnly: true }),
    };
  };

  const tokens: SourceToken[] = [...declared.declared.keys()].map(tokenOf);
  const rootVariables =
    declared.plain.get("") ?? new Map<string, Declaration>();
  for (const [name, decl] of declared.declared) {
    const root = rootVariables.get(decl.name);
    if (root && decl.prelude.includes("inline")) {
      notes.push(
        `${name} is declared both in @theme inline (${relative(decl.file)}) and in a plain :root block (${relative(root.file)}). Its utilities draw the @theme inline value, so that is the one read and written; var(${decl.name}) draws the :root one.`
      );
    } else if (root) {
      notes.push(
        `${name} is declared both in @theme (${relative(decl.file)}) and in a plain :root block (${relative(root.file)}). The :root value is the one the app draws, so it is the one read and written.`
      );
    }
  }
  /** The tokens declared outside `@theme`: a token's name in a plain root block. */
  const variableOnly = new Set<string>();
  for (const variable of rootVariables.keys()) {
    const name = tokenNameOf(variable);
    if (!name || tokenKindOf(name) === "other" || declared.declared.has(name)) {
      continue;
    }
    variableOnly.add(name);
    tokens.push(tokenOf(name));
  }
  for (const [name, raw] of defaults) {
    if (!(declared.declared.has(name) || variableOnly.has(name))) {
      tokens.push({
        kind: tokenKindOf(name),
        name,
        own: false,
        value: resolve(raw, ""),
      });
    }
  }
  return {
    ...declared,
    cascade: found.cascade,
    defaultVariables,
    files: found.files,
    lineHeightOf: (name) => {
      const variable = `${variableOf(name)}--line-height`;
      const raw =
        declared.companions.get(variable)?.value ??
        defaultVariables.get(variable);
      return raw === undefined ? undefined : resolve(raw, "");
    },
    resolve,
    source: { files: found.files.map(relative), notes, themes, tokens },
    tailwind: found.tailwind,
    writable,
  };
};

export const readTokens = (ctx: DesignSystemContext): TokenSource =>
  read(ctx).source;

/** A change to one file: the text between `start` and `end` replaced. */
interface Splice {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

/** The selector a theme's values are written under when it has no block yet. */
const selectorOf = (theme: string) =>
  theme === "dark" ? ".dark" : `[data-theme="${theme}"]`;

/** Where declarations go in a block: each on a line of its own before the `}`, indented. */
const insertion = (
  text: string,
  block: Block,
  lines: readonly string[]
): Splice => {
  const lineStart = text.lastIndexOf("\n", block.close - 1) + 1;
  if (text.slice(lineStart, block.close).trim() === "") {
    // The `}` is on a line of its own.
    const added = lines.map((line) => `  ${line}\n`).join("");
    return { end: lineStart, start: lineStart, text: added };
  }
  return { end: block.close, start: block.close, text: ` ${lines.join(" ")} ` };
};

/** The whole line a declaration is on, when it is alone on it; else just the declaration. */
const removal = (text: string, decl: Declaration): Splice => {
  const lineStart = text.lastIndexOf("\n", decl.declStart - 1) + 1;
  const newline = text.indexOf("\n", decl.declEnd);
  const lineEnd = newline === -1 ? text.length : newline + 1;
  const alone =
    text.slice(lineStart, decl.declStart).trim() === "" &&
    text.slice(decl.declEnd, lineEnd).trim() === "";
  return alone
    ? { end: lineEnd, start: lineStart, text: "" }
    : { end: decl.declEnd, start: decl.declStart, text: "" };
};

/** Whether two changes touch the same text; two insertions at one place both stand. */
const overlaps = (a: Splice, b: Splice) =>
  a.end > a.start && b.end > b.start && a.start < b.end && b.start < a.end;

/** Edits gathered file by file, then applied from the end of each file back. */
const editor = (root: string) => {
  const texts = new Map<string, string>();
  const splices = new Map<string, Splice[]>();
  const appended = new Map<string, string>();
  const textOf = (file: string) => {
    const known = texts.get(file) ?? readFile(file) ?? "";
    texts.set(file, known);
    return known;
  };
  return {
    /** Text appended to a file: a block it did not have. */
    append: (file: string, css: string) =>
      appended.set(file, `${appended.get(file) ?? ""}${css}`),
    done: (): FileEdit[] =>
      [...new Set([...splices.keys(), ...appended.keys()])].map((file) => {
        let text = textOf(file);
        const ordered = [...(splices.get(file) ?? [])].sort(
          (a, b) => b.start - a.start
        );
        for (const s of ordered) {
          text = text.slice(0, s.start) + s.text + text.slice(s.end);
        }
        return {
          file: toPosix(path.relative(root, file)),
          text: text + (appended.get(file) ?? ""),
        };
      }),
    /** A change to the text; one that rewrites what an earlier one did takes its place. */
    splice: (file: string, make: (text: string) => Splice) => {
      const next = make(textOf(file));
      const kept = (splices.get(file) ?? []).filter((s) => !overlaps(s, next));
      splices.set(file, [...kept, next]);
    },
  };
};

/** How many of a reading's own tokens each writable stylesheet declares, `@theme` or `:root`. */
const tokensIn = (reading: Reading): Map<string, number> => {
  const counts = new Map<string, number>();
  const count = (decl: Declaration) =>
    counts.set(decl.file, (counts.get(decl.file) ?? 0) + 1);
  for (const decl of reading.declared.values()) {
    count(decl);
  }
  for (const [variable, decl] of reading.plain.get("") ?? []) {
    const name = tokenNameOf(variable);
    if (name && tokenKindOf(name) !== "other") {
      count(decl);
    }
  }
  return counts;
};

/** The declarations that name each variable in their value, by the variable they name. */
const referrersOf = (reading: Reading): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const decl of reading.all) {
    for (const match of decl.value.matchAll(VAR_NAME_RE)) {
      const named = match[1] as string;
      out.set(named, (out.get(named) ?? new Set()).add(decl.name));
    }
  }
  return out;
};

/** The length of the start two names share: how near two steps of a palette are. */
const sharedStart = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && a[n] === b[n]) {
    n += 1;
  }
  return n;
};

/** What a change did, its file absolute until the writer makes it the repository's. */
const writeOf = (
  change: TokenChange,
  does: TokenWrite["does"],
  file: string | undefined,
  was: Declaration | undefined,
  to: string | undefined
): TokenWrite => ({
  does,
  ...(file !== undefined && { file }),
  ...(was && does !== "add" && { from: was.value }),
  name: change.name,
  ...(change.theme !== undefined && { theme: change.theme }),
  ...(to !== undefined && { to }),
});

/**
 * The files as the changes leave them, and what each change does (ADR 0158). A change writes
 * nothing where the code's value is the change's already. An alias keeps its form: pointed at
 * another declared variable of its kind that holds the new value, or else given the value in
 * place, never written through when other declarations share the variable it names. A token the
 * code declares nowhere it can write is added with the others, one block per theme, in the
 * stylesheet that declares most of the project's tokens.
 */
export const writeTokens = (
  ctx: DesignSystemContext,
  changes: readonly TokenChange[]
): TokenWriting => {
  const reading = read(ctx);
  const edits = editor(ctx.root);
  const relative = (file: string) => toPosix(path.relative(ctx.root, file));
  const writable = (decl: Declaration | undefined): decl is Declaration =>
    decl !== undefined && reading.writable.includes(decl.file);
  const ownBlocks = reading.blocks.filter((b) =>
    reading.writable.includes(b.file)
  );
  const rank = (file: string) => reading.cascade.indexOf(file);
  const counts = tokensIn(reading);
  /** The stylesheet the project's tokens are declared in: the one that declares most of them. */
  const tokensFile = reading.writable.reduce<string | undefined>(
    (best, file) =>
      best === undefined || (counts.get(file) ?? 0) > (counts.get(best) ?? 0)
        ? file
        : best,
    undefined
  );
  const tokensFileFirst = (blocks: readonly Block[]) => [
    ...blocks.filter((b) => b.file === tokensFile),
    ...blocks.filter((b) => b.file !== tokensFile),
  ];
  const referrers = referrersOf(reading);
  /** The last `@theme` reset that would take `variable` out, as Tailwind reads them in order. */
  const lastResetOf = (variable: string) =>
    reading.resetsAt.findLast((r) => resetCovers(r.name, variable));

  /**
   * The `@theme` block a new token goes into: one written after the last reset that covers it
   * (`--color-*: initial` in a later block would take it out again), a plain one rather than an
   * `inline` one, in the project's tokens' stylesheet. A token added before the `}` of the
   * reset's own block comes after it.
   */
  const themeBlockFor = (variable: string) => {
    const reset = lastResetOf(variable);
    const after = (b: Block) =>
      reset === undefined ||
      rank(b.file) > rank(reset.file) ||
      (b.file === reset.file && b.close > reset.declStart);
    const candidates = ownBlocks.filter(
      (b) => b.file === tokensFile && isTheme(b.prelude) && after(b)
    );
    return (
      candidates.find((b) => !b.prelude.includes("inline")) ?? candidates[0]
    );
  };

  /** The stylesheet a block made for new tokens is added to the end of. */
  const fileFor = (theme: string, variable: string) => {
    const reset = theme === "" ? lastResetOf(variable) : undefined;
    if (reset === undefined || tokensFile === undefined) {
      return tokensFile;
    }
    return rank(tokensFile) >= rank(reset.file)
      ? tokensFile
      : (reading.writable.find((file) => rank(file) >= rank(reset.file)) ??
          tokensFile);
  };

  /** Declarations to add, gathered so that each block takes them at once. */
  const added = new Map<
    string,
    { block?: Block; file: string; lines: string[]; selector: string }
  >();
  /** Adds a declaration of `variable` to a theme's block, or a block made for it; its file. */
  const add = (theme: string, variable: string, line: string) => {
    const block =
      theme === ""
        ? themeBlockFor(variable)
        : tokensFileFirst(ownBlocks).find(
            (b) => !isTheme(b.prelude) && plainThemeKeyOf(b.prelude) === theme
          );
    const file = block?.file ?? fileFor(theme, variable);
    if (file === undefined) {
      return;
    }
    const selector = theme === "" ? "@theme" : selectorOf(theme);
    const key = block ? `${block.file}@${block.close}` : `${file}|${selector}`;
    const into = added.get(key) ?? { block, file, lines: [], selector };
    into.lines.push(line);
    added.set(key, into);
    return file;
  };

  /**
   * Whether a variable a token aliases is the token's own, written through as shadcn's
   * `--primary` of `--color-primary` is: no other declaration names it, and it is named after the
   * token or a theme sets it again. A palette step other tokens share is not.
   */
  const ownedBy = (name: string, own: string, variable: string) => {
    const shared = [...(referrers.get(variable) ?? [])].some((r) => r !== own);
    const named = name.endsWith(`-${variable.slice(2)}`);
    const perTheme = [...reading.plain].some(
      ([theme, vars]) => theme !== "" && vars.has(variable)
    );
    return !shared && (named || perTheme);
  };

  /**
   * The value written in place of an alias: another declared variable of the same kind that
   * comes to `value` in the theme, the nearest in name to the one it names now; else the value.
   */
  const aliasFor = (
    own: string,
    aliased: string,
    value: string,
    theme: string
  ) => {
    const kindOf = (variable: string) =>
      tokenKindOf(tokenNameOf(variable) ?? "");
    const kind = kindOf(aliased);
    const declared = new Set([
      ...[...reading.declared.values()].map((d) => d.name),
      ...(reading.plain.get("")?.keys() ?? []),
      ...reading.defaultVariables.keys(),
    ]);
    const holding = [...declared].filter(
      (variable) =>
        variable !== own &&
        !variable.slice(2).includes("--") &&
        kindOf(variable) === kind &&
        sameValue(reading.resolve(`var(${variable})`, theme), value)
    );
    const [nearest] = holding.sort(
      (a, b) => sharedStart(b, aliased) - sharedStart(a, aliased)
    );
    return nearest ? `var(${nearest})` : value;
  };

  /** Writes a value in place of a declaration's, keeping an alias an alias. */
  const replace = (
    change: TokenChange,
    at: Declaration,
    own: string,
    value: string
  ) => {
    const theme = change.theme ?? "";
    const aliased = aliasOf(at.value);
    const text = aliased ? aliasFor(own, aliased, value, theme) : value;
    edits.splice(at.file, () => ({
      end: at.valueEnd,
      start: at.valueStart,
      text,
    }));
    return text;
  };

  /** A change's token as `holderOf` finds it, and where its theme's value is now. */
  const placeOf = (change: TokenChange) => {
    const theme = change.theme ?? "";
    const holder = holderOf(reading, change.name);
    const now =
      theme === ""
        ? holder.target
        : reading.plain.get(theme)?.get(holder.variable);
    return { ...holder, now, theme };
  };

  /** A token taken out, from `@theme` and from a plain root block alike. */
  const removeChange = (change: TokenChange): TokenWrite => {
    const { decl, now, root, theme } = placeOf(change);
    const gone = (theme === "" ? [decl, root] : [now]).filter(writable);
    for (const each of gone) {
      edits.splice(each.file, (text) => removal(text, each));
    }
    const was = gone[0] ?? now;
    const does = gone.length > 0 ? "remove" : "none";
    return writeOf(change, does, was?.file, was, undefined);
  };

  /** A token's value written: nowhere when it is the code's already, else in place or added. */
  const setChange = (change: TokenChange, value: string): TokenWrite => {
    const { decl, now, own, theme, variable } = placeOf(change);
    if (now && sameValue(reading.resolve(now.value, theme), value)) {
      return writeOf(change, "none", now.file, now, undefined);
    }
    // Through the alias only into a variable that is the token's own; else at the token itself.
    const through = variable === own || ownedBy(change.name, own, variable);
    const itself = theme === "" ? decl : reading.plain.get(theme)?.get(own);
    const at = through ? now : itself;
    if (writable(at)) {
      const to = replace(change, at, own, value);
      return writeOf(change, "change", at.file, at, to);
    }
    const name = through ? variable : own;
    const file = add(theme, name, `${name}: ${value};`);
    return writeOf(
      change,
      file === undefined ? "none" : "add",
      file,
      at,
      value
    );
  };

  /** Writes one change, and says what it did. */
  const writeChange = (change: TokenChange): TokenWrite | null => {
    if (change.remove) {
      return removeChange(change);
    }
    return change.value === undefined ? null : setChange(change, change.value);
  };

  // A token changed twice in one theme takes its last change.
  const latest = new Map(changes.map((c) => [`${c.theme ?? ""}|${c.name}`, c]));
  const writes = [...latest.values()]
    .map(writeChange)
    .filter((w): w is TokenWrite => w !== null)
    .map((w) => (w.file === undefined ? w : { ...w, file: relative(w.file) }));
  for (const { block, file, lines, selector } of added.values()) {
    if (block) {
      edits.splice(block.file, (text) => insertion(text, block, lines));
    } else {
      edits.append(
        file,
        `\n${selector} {\n${lines.map((line) => `  ${line}\n`).join("")}}\n`
      );
    }
  }
  return { edits: edits.done(), writes };
};
