/**
 * Tailwind v4's tokens as the code declares them, and written back where they are declared
 * (ADR 0024). A token is a variable of an `@theme` block: `--color-primary: #2563eb`. The common
 * shadcn arrangement declares it as an alias, `--color-primary: var(--primary)` in `@theme
 * inline`, with the value in `:root` and `.dark`; the value is then read from, and written to,
 * the variable the alias names, once per theme.
 *
 * Reading follows the stylesheets the preview imports, and their imports, as Tailwind does;
 * Tailwind's own `theme.css` gives the defaults, which are listed but never written. Which theme
 * a block's values belong to is read here once, for every reader: the tokens Sync compares and
 * the first design system `/init` starts from (`design-system-scan.ts`) alike.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { tokenKindOf } from "@ultrapaint/contracts/token-table";
import { resolveVars } from "@ultrapaint/contracts/token-value";
import type {
  FileEdit,
  SourceToken,
  TokenChange,
  TokenOrigin,
  TokenSource,
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
const OTHER_THEME_RE = /\[data-theme=["']?([\w-]+)["']?\]/;
const TAILWIND_IMPORT_RE = /^tailwindcss(\/.*)?$/;
/** A scope whose variables hold for the whole document: the default theme's. */
const ROOT_SCOPE_RE = /(^|[\s,])(:root|html|:host)\b/;

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
export const hostCssBase = (
  ctx: Pick<DesignSystemContext, "root" | "settings">
): string =>
  path.join(ctx.root, ctx.settings.designsDir, ".ultrapaint", "host.css");

/** The stylesheets the settings name, as files. */
export const hostEntries = (ctx: DesignSystemContext): string[] =>
  ctx.settings.hostCss
    .map((spec) => resolveImport(spec, hostCssBase(ctx), ctx.anchorDir))
    .filter((file): file is string => file !== null);

/** The variable a value is an alias of, `var(--primary)`; undefined for anything else. */
export const aliasOf = (value: string): string | undefined => {
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

export const isTheme = (prelude: string) => prelude.includes("@theme");

/** The theme a block of plain variables gives values for: `""` for the default, or none. */
export const themeKeyOf = (prelude: string): string | null => {
  const named = themeOf(prelude);
  if (named) {
    return named;
  }
  return isRootScope(prelude) ? "" : null;
};

/** A token's name from its variable; null for what is not a token of its own. */
const tokenNameOf = (variable: string): string | null => {
  const name = variable.slice(2);
  // `--text-xs--line-height` belongs to `text-xs`; `--color-*: initial` resets a namespace.
  if (name.includes("--") || name.includes("*") || name === "") {
    return null;
  }
  return name;
};

/** The declarations of the stylesheets, sorted into what reading and writing need. */
interface Declared {
  readonly blocks: Block[];
  /** The `@theme` declarations of what belongs to a token, `--text-sm--line-height`, by variable. */
  readonly companions: Map<string, Declaration>;
  /** The `@theme` declaration of each token, by name; the last one wins, as in CSS. */
  readonly declared: Map<string, Declaration>;
  /** The `@theme` resets, `--color-*` of `--color-*: initial`, which take Tailwind's defaults out. */
  readonly resets: string[];
  /** The same resets where they are written: a token added before one would be taken out. */
  readonly resetsAt: Declaration[];
  /** Plain variables by theme (`""` the default), then by variable. */
  readonly scoped: Map<string, Map<string, Declaration>>;
}

const readFile = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // Listed by the imports and gone since: there is nothing to read.
    return null;
  }
};

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
    if (resetCovers(decl.name, `--${declared}`)) {
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
    blocks: [],
    companions: new Map(),
    declared: new Map(),
    resets: [],
    resetsAt: [],
    scoped: new Map(),
  };
  for (const file of files) {
    const text = readFile(file);
    if (text === null) {
      continue;
    }
    const parsed = customPropertiesOf(file, text);
    out.blocks.push(...parsed.blocks);
    for (const decl of parsed.declarations) {
      const key = themeKeyOf(decl.prelude);
      if (isTheme(decl.prelude)) {
        takeTheme(out, decl);
      } else if (key !== null) {
        const vars = out.scoped.get(key) ?? new Map<string, Declaration>();
        vars.set(decl.name, decl);
        out.scoped.set(key, vars);
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

/** What the reading keeps beyond the tokens: what a write needs to find its place. */
export interface Reading extends Declared {
  /** Every stylesheet read, absolute, in the order Tailwind reads them. */
  readonly files: readonly string[];
  /** A font size's line height (`--text-sm--line-height`), the value it ends at; none without. */
  readonly lineHeightOf: (name: string) => string | undefined;
  readonly source: TokenSource;
  /** Whether the stylesheets import `tailwindcss`, which brings its default theme. */
  readonly tailwind: boolean;
  /** The stylesheets the repository writes, absolute, in the order they are read. */
  readonly writable: string[];
}

/** Follows the `var()`s of a value through one theme's variables, then the default's. */
const resolverOf =
  (found: Declared, defaults: ReadonlyMap<string, string>) =>
  (value: string, theme: string): string =>
    resolveVars(value, (variable) => {
      const name = tokenNameOf(variable) ?? "";
      return (
        found.scoped.get(theme)?.get(variable)?.value ??
        found.scoped.get("")?.get(variable)?.value ??
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
  const declared = declarationsOf(found.files);
  const { tokens: defaults, variables: defaultVariables } = defaultsOf(
    found.tailwindTheme,
    declared.resets
  );
  const resolve = resolverOf(declared, defaults);
  const themes = [...declared.scoped.keys()].filter((k) => k !== "");
  const relative = (file: string) => toPosix(path.relative(ctx.root, file));

  /** The value and where it is written, in each theme, of the variable that holds it. */
  const valuesOf = (variable: string, fallback: Declaration | undefined) => {
    const origins: Record<string, TokenOrigin> = {};
    const values: Record<string, string> = {};
    const at = (theme: string, decl: Declaration) => {
      if (writable.includes(decl.file)) {
        origins[theme] = {
          end: decl.valueEnd,
          file: relative(decl.file),
          start: decl.valueStart,
        };
      }
    };
    const base = declared.scoped.get("")?.get(variable) ?? fallback;
    if (base) {
      at("", base);
    }
    for (const theme of themes) {
      const own = declared.scoped.get(theme)?.get(variable);
      if (own) {
        values[theme] = resolve(own.value, theme);
        at(theme, own);
      }
    }
    return { base, origins, values };
  };

  const tokenOf = (name: string, decl: Declaration): SourceToken => {
    const alias = aliasOf(decl.value);
    // `--color-primary: var(--primary)`: the value is the variable's, theme by theme. Else a
    // theme may declare the token's variable again, `.dark { --color-primary: … }`.
    const variable =
      alias && declared.scoped.get("")?.has(alias) ? alias : decl.name;
    const { base, origins, values } = valuesOf(
      variable,
      variable === decl.name ? decl : undefined
    );
    return {
      kind: tokenKindOf(name),
      name,
      ...(Object.keys(origins).length > 0 && { origins }),
      own: true,
      value: resolve((base ?? decl).value, ""),
      ...(Object.keys(values).length > 0 && { values }),
    };
  };

  const tokens: SourceToken[] = [...declared.declared].map(([name, decl]) =>
    tokenOf(name, decl)
  );
  for (const [name, raw] of defaults) {
    if (!declared.declared.has(name)) {
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
    files: found.files,
    lineHeightOf: (name) => {
      const variable = `--${name}--line-height`;
      const raw =
        declared.companions.get(variable)?.value ??
        defaultVariables.get(variable);
      return raw === undefined ? undefined : resolve(raw, "");
    },
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
export const selectorOf = (theme: string) =>
  theme === "dark" ? ".dark" : `[data-theme="${theme}"]`;

/** Where a declaration goes in a block: on a line of its own before the `}`, indented. */
const insertion = (text: string, block: Block, line: string): Splice => {
  const lineStart = text.lastIndexOf("\n", block.close - 1) + 1;
  if (text.slice(lineStart, block.close).trim() === "") {
    // The `}` is on a line of its own.
    return { end: lineStart, start: lineStart, text: `  ${line}\n` };
  }
  return { end: block.close, start: block.close, text: ` ${line} ` };
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

export const writeTokens = (
  ctx: DesignSystemContext,
  changes: readonly TokenChange[]
): FileEdit[] => {
  const reading = read(ctx);
  const edits = editor(ctx.root);
  const writable = (decl: Declaration | undefined): decl is Declaration =>
    decl !== undefined && reading.writable.includes(decl.file);
  const ownBlocks = reading.blocks.filter((b) =>
    reading.writable.includes(b.file)
  );
  const [firstFile] = reading.writable;
  const rank = (file: string) => reading.files.indexOf(file);
  /** The last `@theme` reset that would take `variable` out, as Tailwind reads them in order. */
  const lastResetOf = (variable: string) =>
    reading.resetsAt.findLast((r) => resetCovers(r.name, variable));

  /**
   * The `@theme` block a new token goes into: one written after the last reset that covers it
   * (`--color-*: initial` in a later block would take it out again), a plain one rather than an
   * `inline` one. A token added before the `}` of the reset's own block comes after it.
   */
  const themeBlockFor = (variable: string) => {
    const reset = lastResetOf(variable);
    const after = (b: Block) =>
      reset === undefined ||
      rank(b.file) > rank(reset.file) ||
      (b.file === reset.file && b.close > reset.declStart);
    const candidates = ownBlocks.filter((b) => isTheme(b.prelude) && after(b));
    return (
      candidates.find((b) => !b.prelude.includes("inline")) ?? candidates[0]
    );
  };

  /** The stylesheet a block made for a new token is added to the end of. */
  const fileFor = (theme: string, variable: string) => {
    const reset = theme === "" ? lastResetOf(variable) : undefined;
    if (reset === undefined) {
      return firstFile;
    }
    return (
      reading.writable.find((file) => rank(file) >= rank(reset.file)) ??
      firstFile
    );
  };

  /** Adds a declaration of `variable` to a theme's block, or a block made for it. */
  const add = (theme: string, variable: string, line: string) => {
    const block =
      theme === ""
        ? themeBlockFor(variable)
        : ownBlocks.find(
            (b) => !isTheme(b.prelude) && themeKeyOf(b.prelude) === theme
          );
    const file = fileFor(theme, variable);
    if (block) {
      edits.splice(block.file, (text) => insertion(text, block, line));
    } else if (file) {
      const selector = theme === "" ? "@theme" : selectorOf(theme);
      edits.append(file, `\n${selector} {\n  ${line}\n}\n`);
    }
  };

  /** The variable a change writes, and where this theme's value of it is written now. */
  const targetOf = (change: TokenChange) => {
    const theme = change.theme ?? "";
    const decl = reading.declared.get(change.name);
    const alias = decl ? aliasOf(decl.value) : undefined;
    const variable =
      alias && reading.scoped.get("")?.has(alias) ? alias : `--${change.name}`;
    const target =
      theme === "" && variable === `--${change.name}`
        ? decl
        : reading.scoped.get(theme)?.get(variable);
    return { decl, target, theme, variable };
  };

  // A token changed twice in one theme takes its last change.
  const latest = new Map(changes.map((c) => [`${c.theme ?? ""}|${c.name}`, c]));
  for (const change of latest.values()) {
    const { decl, target, theme, variable } = targetOf(change);
    const { remove, value } = change;
    const gone = theme === "" ? decl : target;
    if (remove && writable(gone)) {
      edits.splice(gone.file, (text) => removal(text, gone));
    } else if (!remove && value !== undefined && writable(target)) {
      edits.splice(target.file, () => ({
        end: target.valueEnd,
        start: target.valueStart,
        text: value,
      }));
    } else if (!remove && value !== undefined) {
      add(theme, variable, `${variable}: ${value};`);
    }
  }
  return edits.done();
};
