/**
 * Component catalogue: extracts exported components, their prop types, enum members,
 * defaults and `cva` variants from the configured design-system directories with the
 * TypeScript compiler API, and computes the key the server caches the result under.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  Catalogue,
  ComponentMeta,
  PropMeta,
  PropType,
} from "@ultrapaint/contracts/catalogue";
import type {
  CatalogueBuilder,
  CatalogueContext,
} from "@ultrapaint/framework-api/node";
// TypeScript 7 (native) has no JS compiler API; the catalogue uses the 5.x API under an alias.
import ts from "typescript-api";

const hashContent = (content: string): string =>
  createHash("sha1").update(content).digest("hex").slice(0, 16);

const toPosix = (p: string) => p.replaceAll("\\", "/");

/** Bump when the extraction logic changes so stale caches are rebuilt. */
const CATALOGUE_VERSION = 4;

const TSX_EXT_RE = /\.tsx$/;
const NON_COMPONENT_TSX_RE = /\.(stories|test|spec)\.tsx$/;
const TS_EXT_RE = /\.tsx?$/;
const LEADING_DOT_SLASH_RE = /^\.\//;
const INDEX_RE = /\/index$/;
const TRAILING_COMMA_RE = /,(\s*[}\]])/g;
const LEADING_DOT_RE = /^\./;
const STORY_TITLE_RE = /title:\s*["'`]([^"'`]+)["'`]/;
const COMPONENT_NAME_RE = /^[A-Z]/;
const RENDERABLE_RETURN_RE = /Element|ReactNode|JSX|null/;
const EVENT_HANDLER_RE = /^on[A-Z]/;
const NODE_TYPE_RE = /ReactNode|ReactElement|Element|children/i;

const HTML_PROP_ALLOWLIST = new Set([
  "disabled",
  "type",
  "placeholder",
  "value",
  "defaultValue",
  "checked",
  "open",
  "defaultOpen",
  "orientation",
  "size",
  "variant",
  "href",
  "src",
  "alt",
  "name",
  "label",
  "loading",
  "readOnly",
  "required",
  "multiple",
  "min",
  "max",
  "step",
  "rows",
  "target",
  "children",
  "render",
  "modal",
  "side",
  "align",
  "delay",
  "inset",
  "invalid",
  "indeterminate",
  "collapsible",
]);

const CATEGORIES: [RegExp, string][] = [
  [/^(button|button-group|toggle|toggle-group|link)$/, "Actions"],
  [
    /^(input|input-otp|input-group|textarea|select|native-select|checkbox|radio|radio-group|switch|slider|label|field|form|combobox|date-picker|calendar|number-field|autocomplete|search)/,
    "Form",
  ],
  [
    /^(dialog|alert-dialog|drawer|sheet|popover|tooltip|dropdown-menu|context-menu|hover-card|command|menubar|navigation-menu|menu|toast|sonner)/,
    "Overlay",
  ],
  [
    /^(card|separator|tabs|accordion|collapsible|scroll-area|resizable|aspect-ratio|sidebar|app-layout|app-page-layout|page|section|stack|grid|container|spacer|item|frame)/,
    "Layout",
  ],
  [
    /^(alert|badge|progress|skeleton|spinner|empty|banner|callout|status)/,
    "Feedback",
  ],
  [/^(breadcrumb|pagination|stepper|steps)/, "Navigation"],
  [
    /^(avatar|table|data-table|chart|carousel|kbd|typography|heading|text|code|image|icon|logo)/,
    "Data display",
  ],
];

const toStoryId = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

interface CvaInfo {
  defaults: Record<string, string>;
  variants: Record<string, string[]>;
}

/** A property's name as written: `size`, `"2xl"`, `1`; null for a computed one. */
const propertyName = (name: ts.PropertyName): string | null =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : null;

/** The `key: value` properties of an object literal. */
const assignments = (obj: ts.ObjectLiteralExpression) =>
  obj.properties.filter(ts.isPropertyAssignment).flatMap((p) => {
    const name = propertyName(p.name);
    return name === null ? [] : [[name, p.initializer] as const];
  });

const isCvaCall = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) &&
  ts.isIdentifier(n.expression) &&
  n.expression.text === "cva";

/** `variants` and `defaultVariants` of a `cva(base, { … })` call. */
const cvaOfCall = (call: ts.CallExpression): CvaInfo => {
  const info: CvaInfo = { defaults: {}, variants: {} };
  const [, cfg] = call.arguments;
  if (!(cfg && ts.isObjectLiteralExpression(cfg))) {
    return info;
  }
  for (const [name, value] of assignments(cfg)) {
    if (!ts.isObjectLiteralExpression(value)) {
      continue;
    }
    for (const [key, member] of assignments(value)) {
      if (name === "variants" && ts.isObjectLiteralExpression(member)) {
        info.variants[key] = assignments(member).map(([m]) => m);
      } else if (name === "defaultVariants" && ts.isStringLiteralLike(member)) {
        info.defaults[key] = member.text;
      }
    }
  }
  return info;
};

const mergeCva = (into: CvaInfo, from: CvaInfo) => {
  Object.assign(into.variants, from.variants);
  Object.assign(into.defaults, from.defaults);
};

/**
 * The `cva` variants a component uses: the `cva()` calls written inside it, and those of the
 * variables it calls or names in a `typeof` (`buttonVariants({ variant })`,
 * `VariantProps<typeof buttonVariants>`), wherever they are declared. A file's other `cva()`s
 * belong to its other components.
 */
const cvaOfComponent = (checker: ts.TypeChecker, decl: ts.Node): CvaInfo => {
  const info: CvaInfo = { defaults: {}, variants: {} };
  const named = (id: ts.Identifier) => {
    const symbol = checker.getSymbolAtLocation(id);
    const target =
      symbol && symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    const declared = target?.valueDeclaration;
    if (
      declared &&
      ts.isVariableDeclaration(declared) &&
      declared.initializer &&
      isCvaCall(declared.initializer)
    ) {
      mergeCva(info, cvaOfCall(declared.initializer));
    }
  };
  const visit = (n: ts.Node) => {
    if (isCvaCall(n)) {
      mergeCva(info, cvaOfCall(n));
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      named(n.expression);
    } else if (ts.isTypeQueryNode(n) && ts.isIdentifier(n.exprName)) {
      named(n.exprName);
    }
    ts.forEachChild(n, visit);
  };
  visit(decl);
  return info;
};

interface PackageJson {
  exports?: Record<string, unknown> | string;
  main?: string;
  module?: string;
  name?: string;
}

/** The subpath of an `exports` map whose wildcard target holds the file, as an import. */
const fromExportsMap = (
  name: string,
  exportsMap: Record<string, unknown>,
  relNoExt: string
): string | null => {
  for (const [sub, target] of Object.entries(exportsMap)) {
    const targets =
      typeof target === "string"
        ? [target]
        : Object.values((target ?? {}) as Record<string, unknown>).flat();
    for (const t of targets) {
      if (typeof t !== "string" || !t.includes("*")) {
        continue;
      }
      const prefix = t.replace(LEADING_DOT_SLASH_RE, "").split("*")[0] ?? "";
      if (relNoExt.startsWith(prefix)) {
        const rest = relNoExt.slice(prefix.length);
        return `${name}${sub.replace(LEADING_DOT_RE, "").replace("*", rest)}`;
      }
    }
  }
  return null;
};

/** Whether the package's name alone imports something: it has an entry. */
const hasEntry = (pkg: PackageJson) => {
  if (pkg.exports === undefined) {
    return (pkg.main ?? pkg.module) !== undefined;
  }
  return typeof pkg.exports === "string" || "." in pkg.exports;
};

/** The path aliases of one tsconfig. */
interface AliasOptions {
  readonly baseUrl?: string;
  readonly paths?: Record<string, string[]>;
}

/** What a package says about importing its files: its manifest and its tsconfigs' aliases. */
interface PackageInfo {
  readonly aliases: readonly AliasOptions[];
  readonly pkg: PackageJson;
}

/** Reads a package's manifest and aliases; null when the manifest cannot be read. */
const readPackage = (pj: string, pkgDir: string): PackageInfo | null => {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(pj, "utf8")) as PackageJson;
  } catch {
    // A manifest that cannot be read names no package to import from.
    return null;
  }
  const aliases = TSCONFIG_NAMES.flatMap((name) => {
    const options = aliasOptionsIn(path.join(pkgDir, name));
    return options ? [options] : [];
  });
  return { aliases, pkg };
};

/**
 * Import specifier for `file`: through the `exports` map of the package.json at `pj`, else the
 * package's own path aliases, else the package's name when it has an entry, else a path from
 * the package's root (`/src/components/header`), which the preview resolves against the anchor:
 * right for an application's own components, the anchor being that application. Null for a
 * package without a name. `info` is the package as already read, when it was.
 */
export const specifierFromPackage = (
  pj: string,
  pkgDir: string,
  file: string,
  info: PackageInfo | null = readPackage(pj, pkgDir)
): { pkg: string; specifier: string } | null => {
  const name = info?.pkg.name;
  if (!(info && name)) {
    return null;
  }
  const { aliases, pkg } = info;
  const relNoExt = path.relative(pkgDir, file).replace(TS_EXT_RE, "");
  const specifier =
    fromExportsMap(
      name,
      typeof pkg.exports === "object" ? pkg.exports : {},
      relNoExt
    ) ??
    specifierFromAlias(aliases, pkgDir, file) ??
    (hasEntry(pkg) ? name : null) ??
    // An application's own component that no export or alias reaches: a path from the
    // package's root, which the preview resolves against the anchor.
    `/${toPosix(relNoExt).replace(INDEX_RE, "")}`;
  return { pkg: name, specifier };
};

/** Where the token at `i` ends: a string, a comment, or one character. */
const tokenEnd = (text: string, i: number): number => {
  const c = text[i];
  const next = text[i + 1];
  if (c === '"') {
    let j = i + 1;
    while (j < text.length && text[j] !== '"') {
      j += text[j] === "\\" ? 2 : 1;
    }
    return j + 1;
  }
  if (c === "/" && next === "/") {
    const end = text.indexOf("\n", i);
    return end < 0 ? text.length : end;
  }
  if (c === "/" && next === "*") {
    const end = text.indexOf("*/", i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i + 1;
};

/** JSON with comments and trailing commas, as tsconfig files are written. */
export const parseJsonc = (text: string): unknown => {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const end = tokenEnd(text, i);
    const comment =
      text[i] === "/" && (text[i + 1] === "/" || text[i + 1] === "*");
    if (!comment) {
      out += text.slice(i, end);
    }
    i = end;
  }
  return JSON.parse(out.replace(TRAILING_COMMA_RE, "$1"));
};

/**
 * Import specifier for `file` through the package's own path aliases, the way its code imports
 * it (`@/components/ui/button`): the tsconfig's `paths`, which the package's Vite config usually
 * mirrors, and which the preview inherits with it.
 */
const specifierFromAlias = (
  aliases: readonly AliasOptions[],
  pkgDir: string,
  file: string
): string | null => {
  for (const options of aliases) {
    const found = aliasFrom(options, pkgDir, file);
    if (found) {
      return found;
    }
  }
  return null;
};

/**
 * Where a package declares its aliases: `tsconfig.json`, or, in Vite's own template, the
 * `tsconfig.app.json` it references.
 */
const TSCONFIG_NAMES = ["tsconfig.json", "tsconfig.app.json"];

/** The aliases a tsconfig declares; null when there is no tsconfig there to read. */
const aliasOptionsIn = (tsconfig: string): AliasOptions | null => {
  if (!existsSync(tsconfig)) {
    return null;
  }
  try {
    const parsed = parseJsonc(readFileSync(tsconfig, "utf8")) as {
      compilerOptions?: AliasOptions;
    };
    return parsed.compilerOptions ?? {};
  } catch {
    // An unreadable tsconfig only means no alias is known.
    return null;
  }
};

const aliasFrom = (
  options: AliasOptions,
  pkgDir: string,
  file: string
): string | null => {
  const base = path.resolve(pkgDir, options.baseUrl ?? ".");
  const relNoExt = toPosix(path.relative(base, file)).replace(TS_EXT_RE, "");
  for (const [alias, targets] of Object.entries(options.paths ?? {})) {
    if (!alias.endsWith("/*")) {
      continue;
    }
    for (const target of targets) {
      const prefix =
        target.replace(LEADING_DOT_SLASH_RE, "").split("*")[0] ?? "";
      if (target.endsWith("*") && relNoExt.startsWith(prefix)) {
        const rest = relNoExt.slice(prefix.length).replace(INDEX_RE, "");
        return `${alias.slice(0, -1)}${rest}`;
      }
    }
  }
  return null;
};

const classify = (
  checker: ts.TypeChecker,
  type: ts.Type,
  name: string
): PropType | null => {
  const raw = checker
    .typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
    .slice(0, 200);
  const nonNull = type.getNonNullableType();
  const flags = nonNull.getFlags();
  if (nonNull.isUnion()) {
    const members = nonNull.types.filter(
      (t) => !(t.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))
    );
    if (members.length > 0 && members.every((t) => t.isStringLiteral())) {
      return {
        kind: "enum",
        members: members.map((t) => (t as ts.StringLiteralType).value),
        raw,
      };
    }
    if (members.every((t) => t.getFlags() & ts.TypeFlags.BooleanLiteral)) {
      return { kind: "boolean", raw };
    }
    if (members.every((t) => t.getFlags() & ts.TypeFlags.NumberLike)) {
      return { kind: "number", raw };
    }
    if (
      members.some((t) => t.isStringLiteral()) &&
      members.every(
        (t) => t.isStringLiteral() || t.getFlags() & ts.TypeFlags.String
      )
    ) {
      return { kind: "string", raw };
    }
  }
  if (flags & ts.TypeFlags.BooleanLike) {
    return { kind: "boolean", raw };
  }
  if (flags & ts.TypeFlags.StringLike) {
    return { kind: "string", raw };
  }
  if (flags & ts.TypeFlags.NumberLike) {
    return { kind: "number", raw };
  }
  if (nonNull.getCallSignatures().length > 0) {
    return { kind: "function", raw };
  }
  if (NODE_TYPE_RE.test(raw) || name === "children" || name === "render") {
    return { kind: "node", raw };
  }
  if (flags & ts.TypeFlags.Object) {
    return { kind: "object", raw };
  }
  return { kind: "other", raw };
};

/** Resolves an export to its component symbol and call signature, or null when it is not one. */
const resolveComponent = (
  checker: ts.TypeChecker,
  exp: ts.Symbol
): { decl: ts.Declaration; sig: ts.Signature; symbol: ts.Symbol } | null => {
  if (!COMPONENT_NAME_RE.test(exp.getName())) {
    return null;
  }
  const symbol =
    exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!decl) {
    return null;
  }
  const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
  const [sig] = type.getCallSignatures();
  if (!sig) {
    return null;
  }
  const ret = checker.typeToString(sig.getReturnType());
  if (!RENDERABLE_RETURN_RE.test(ret)) {
    return null;
  }
  return { decl, sig, symbol };
};

/** Inherited DOM noise: non-allowlisted library props, event handlers, aria-/data- attributes. */
const isSkippedProp = (p: ts.Symbol, pname: string): boolean => {
  const pdecl = p.declarations?.[0];
  const fromNodeModules =
    !!pdecl && pdecl.getSourceFile().fileName.includes("/node_modules/");
  if (fromNodeModules && !HTML_PROP_ALLOWLIST.has(pname)) {
    return true;
  }
  if (pname.startsWith("on") && EVENT_HANDLER_RE.test(pname)) {
    return true;
  }
  return pname.startsWith("aria-") || pname.startsWith("data-");
};

const propMeta = (
  checker: ts.TypeChecker,
  p: ts.Symbol,
  type: PropType,
  cva: CvaInfo
): PropMeta => {
  const pname = p.getName();
  const required = !(p.flags & ts.SymbolFlags.Optional);
  const jsDoc = ts.displayPartsToString(p.getDocumentationComment(checker));
  return {
    name: pname,
    required,
    type,
    ...(jsDoc ? { description: jsDoc.slice(0, 200) } : {}),
    ...(cva.defaults[pname] === undefined
      ? {}
      : { defaultValue: cva.defaults[pname] as JsonValue }),
  };
};

/** Variants declared in `cva` that the prop types did not already describe as enums. */
const addCvaVariants = (
  variants: Record<string, string[]>,
  props: PropMeta[],
  cva: CvaInfo
) => {
  for (const [vn, members] of Object.entries(cva.variants)) {
    if (!variants[vn] && props.some((p) => p.name === vn)) {
      variants[vn] = members;
    }
  }
};

const collectProps = (
  checker: ts.TypeChecker,
  sig: ts.Signature,
  decl: ts.Declaration,
  cva: CvaInfo
): { props: PropMeta[]; variants: Record<string, string[]> } => {
  const [param] = sig.getParameters();
  const props: PropMeta[] = [];
  const variants: Record<string, string[]> = {};
  if (param) {
    const propsType = checker.getTypeOfSymbolAtLocation(param, decl);
    for (const p of propsType.getProperties()) {
      const pname = p.getName();
      if (isSkippedProp(p, pname)) {
        continue;
      }
      const ptype = checker.getTypeOfSymbolAtLocation(p, decl);
      const meta = classify(checker, ptype, pname);
      if (!meta) {
        continue;
      }
      if (meta.kind === "enum" && cva.variants[pname]) {
        variants[pname] = [...(meta.members ?? cva.variants[pname] ?? [])];
      }
      props.push(propMeta(checker, p, meta, cva));
      if (props.length >= 48) {
        break;
      }
    }
  }
  addCvaVariants(variants, props, cva);
  return { props, variants };
};

const placeholderAttr = (p: PropMeta): string | null => {
  if (p.type.kind === "enum") {
    return `${p.name}="${p.type.members?.[0] ?? ""}"`;
  }
  if (p.type.kind === "string") {
    return `${p.name}=""`;
  }
  if (p.type.kind === "number") {
    return `${p.name}={0}`;
  }
  if (p.type.kind === "boolean") {
    return p.name;
  }
  return null;
};

/** Minimal JSX for inserting the component: required props get placeholder values. */
const snippetFor = (name: string, props: PropMeta[]): string => {
  const requiredProps = props.filter(
    (p) => p.required && p.name !== "children"
  );
  const attrs = requiredProps.map(placeholderAttr).filter(Boolean).join(" ");
  const hasChildren = props.some((p) => p.name === "children");
  return hasChildren
    ? `<${name}${attrs ? ` ${attrs}` : ""}>${name}</${name}>`
    : `<${name}${attrs ? ` ${attrs}` : ""} />`;
};

const relativeTo = (root: string, abs: string) =>
  toPosix(path.relative(root, abs));

export type ExtractContext = CatalogueContext;

export const catalogueSourceFiles = (ctx: ExtractContext): string[] => {
  const files: string[] = [];
  for (const dir of ctx.libraryDirs) {
    if (!existsSync(dir)) {
      continue;
    }
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) {
            continue;
          }
          walk(p);
        } else if (
          TSX_EXT_RE.test(e.name) &&
          !NON_COMPONENT_TSX_RE.test(e.name)
        ) {
          files.push(p);
        }
      }
    };
    walk(dir);
  }
  return files.sort();
};

export const catalogueCacheKey = (
  ctx: ExtractContext,
  files: readonly string[]
): string =>
  hashContent(
    `v${CATALOGUE_VERSION}\n${files.map((f) => `${f}:${statSync(f).mtimeMs}`).join("\n")}${JSON.stringify(ctx.componentPackages)}`
  );

/** Whether `file` is inside `dir`: `src/ui` holds `src/ui/button.tsx`, not `src/ui-extra/…`. */
const isInside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Packages and manifests read once for a whole build, not once per component file. */
const makePackages = () => {
  const manifests = new Map<string, string | null>();
  const packages = new Map<string, PackageInfo | null>();
  /** The nearest package.json at or above a library directory. */
  const manifestOf = (dir: string): string | null => {
    const known = manifests.get(dir);
    if (known !== undefined) {
      return known;
    }
    let found: string | null = null;
    for (let probe = dir; probe !== path.dirname(probe); ) {
      const pj = path.join(probe, "package.json");
      if (existsSync(pj)) {
        found = pj;
        break;
      }
      probe = path.dirname(probe);
    }
    manifests.set(dir, found);
    return found;
  };
  const packageAt = (pj: string): PackageInfo | null => {
    if (!packages.has(pj)) {
      packages.set(pj, readPackage(pj, path.dirname(pj)));
    }
    return packages.get(pj) ?? null;
  };
  return { manifestOf, packageAt };
};

type Packages = ReturnType<typeof makePackages>;

/** Resolves the import specifier for a component file from its package. */
const importSpecifier = (
  ctx: ExtractContext,
  packages: Packages,
  file: string
): { pkg: string; specifier: string } | null => {
  for (const dir of ctx.libraryDirs) {
    if (!isInside(dir, file)) {
      continue;
    }
    const pj = packages.manifestOf(dir);
    if (pj) {
      const pkgDir = path.dirname(pj);
      return specifierFromPackage(pj, pkgDir, file, packages.packageAt(pj));
    }
  }
  return null;
};

const storiesOf = (ctx: ExtractContext): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const dir of ctx.libraryDirs) {
    const roots = [
      dir,
      path.dirname(dir),
      path.join(path.dirname(dir), "stories"),
    ];
    for (const r of roots) {
      if (!(existsSync(r) && statSync(r).isDirectory())) {
        continue;
      }
      for (const e of readdirSync(r)) {
        if (!e.endsWith(".stories.tsx")) {
          continue;
        }
        const code = readFileSync(path.join(r, e), "utf8");
        const title = code.match(STORY_TITLE_RE)?.[1];
        if (!title) {
          continue;
        }
        const exportsNames = Array.from(
          code.matchAll(/export const (\w+)\s*[:=]/g)
        ).map((m) => m[1] as string);
        const base = e.replace(".stories.tsx", "");
        map.set(
          base,
          exportsNames.map((n) => `${toStoryId(title)}--${toStoryId(n)}`)
        );
      }
    }
  }
  return map;
};

/** Runs the TypeScript 5 compiler over the library and returns every usable component. */
export const buildCatalogue = (
  ctx: ExtractContext,
  files: string[]
): Catalogue => {
  const program = ts.createProgram(files, {
    allowImportingTsExtensions: true,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const stories = storiesOf(ctx);
  const packages = makePackages();
  const components: ComponentMeta[] = [];
  let usable = 0;

  for (const file of files) {
    const found = fileComponents(
      { checker, ctx, packages, program, stories },
      file
    );
    for (const meta of found) {
      components.push(meta);
      if (meta.props.length > 0 || Object.keys(meta.variants).length > 0) {
        usable += 1;
      }
    }
  }
  components.sort((a, b) => a.name.localeCompare(b.name));
  return {
    builtAt: Date.now(),
    components,
    coverage: { total: components.length, usable },
  };
};

/** Metadata for every exported component of one source file. */
const fileComponents = (
  build: {
    readonly checker: ts.TypeChecker;
    readonly ctx: ExtractContext;
    readonly packages: Packages;
    readonly program: ts.Program;
    readonly stories: Map<string, string[]>;
  },
  file: string
): ComponentMeta[] => {
  const { checker, ctx, packages, program, stories } = build;
  const sf = program.getSourceFile(file);
  if (!sf) {
    return [];
  }
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) {
    return [];
  }
  const spec = importSpecifier(ctx, packages, file);
  const base = path.basename(file, ".tsx");
  const category = CATEGORIES.find(([re]) => re.test(base))?.[1] ?? "Other";
  const out: ComponentMeta[] = [];
  for (const exp of checker.getExportsOfModule(moduleSymbol)) {
    const component = resolveComponent(checker, exp);
    if (!component) {
      continue;
    }
    const name = exp.getName();
    const { props, variants } = collectProps(
      checker,
      component.sig,
      component.decl,
      cvaOfComponent(checker, component.decl)
    );
    const description =
      ts
        .displayPartsToString(component.symbol.getDocumentationComment(checker))
        .slice(0, 200) || undefined;
    out.push({
      category,
      file: relativeTo(ctx.root, file),
      group: spec?.pkg ?? path.dirname(relativeTo(ctx.root, file)),
      // No import that resolves: listed, but no page imports it until the package says how.
      importFrom: spec?.specifier ?? "",
      name,
      props,
      snippet: snippetFor(name, props),
      storyIds: stories.get(base) ?? [],
      variants,
      ...(description ? { description } : {}),
    });
  }
  return out;
};

// Source checkouts run the TypeScript file directly; a bundle ships the worker next to it.
const workerUrl = new URL(
  import.meta.url.endsWith(".ts")
    ? "./catalogue-worker.ts"
    : "./catalogue-worker.mjs",
  import.meta.url
);

export const catalogue: CatalogueBuilder = {
  cacheKey: catalogueCacheKey,
  sourceFiles: catalogueSourceFiles,
  workerUrl,
};
