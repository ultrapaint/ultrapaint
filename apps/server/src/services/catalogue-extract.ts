/**
 * Component catalogue: extracts exported components, their prop types, enum members,
 * defaults and `cva` variants from the configured design-system directories with the
 * TypeScript compiler API, and caches the result under the tool home.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  Catalogue,
  ComponentMeta,
  PropMeta,
  PropType,
} from "@ultrapaint/contracts/catalogue";
// TypeScript 7 (native) has no JS compiler API; the catalogue uses the 5.x API under an alias.
import ts from "typescript-api";
import { hashContent } from "../hash.ts";

/** Bump when the extraction logic changes so stale caches are rebuilt. */
const CATALOGUE_VERSION = 2;

const TSX_EXT_RE = /\.tsx$/;
const NON_COMPONENT_TSX_RE = /\.(stories|test|spec)\.tsx$/;
const TS_EXT_RE = /\.tsx?$/;
const LEADING_DOT_SLASH_RE = /^\.\//;
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

interface AstNode {
  type: string;
  [k: string]: unknown;
}

const isAstNode = (v: unknown): v is AstNode =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as AstNode).type === "string";

const keyName = (p: AstNode) => {
  const k = p.key as AstNode;
  if (k.type === "Identifier") {
    return k.name as string;
  }
  return k.type === "StringLiteral" ? (k.value as string) : null;
};

const objectProperties = (obj: AstNode): AstNode[] =>
  (obj.properties as AstNode[]).filter((p) => p.type === "ObjectProperty");

const astChildren = (n: AstNode): AstNode[] => {
  const out: AstNode[] = [];
  for (const key of Object.keys(n)) {
    if (key === "loc") {
      continue;
    }
    const v = n[key];
    if (Array.isArray(v)) {
      for (const x of v) {
        if (isAstNode(x)) {
          out.push(x);
        }
      }
    } else if (isAstNode(v)) {
      out.push(v);
    }
  }
  return out;
};

const isCvaCall = (n: AstNode): boolean =>
  n.type === "CallExpression" &&
  (n.callee as AstNode).type === "Identifier" &&
  (n.callee as AstNode).name === "cva";

const readVariants = (info: CvaInfo, variants: AstNode) => {
  for (const vp of objectProperties(variants)) {
    const vn = keyName(vp);
    const vv = vp.value as AstNode;
    if (vn && vv.type === "ObjectExpression") {
      info.variants[vn] = (vv.properties as AstNode[])
        .map((m) => (m.type === "ObjectProperty" ? keyName(m) : null))
        .filter((x): x is string => !!x);
    }
  }
};

const readDefaultVariants = (info: CvaInfo, defaults: AstNode) => {
  for (const dp of objectProperties(defaults)) {
    const dn = keyName(dp);
    const dv = dp.value as AstNode;
    if (dn && dv.type === "StringLiteral") {
      info.defaults[dn] = dv.value as string;
    }
  }
};

/** Reads `variants` and `defaultVariants` from the config argument of a `cva` call. */
const readCvaConfig = (info: CvaInfo, call: AstNode) => {
  const [, cfg] = call.arguments as AstNode[];
  if (cfg?.type !== "ObjectExpression") {
    return;
  }
  for (const p of objectProperties(cfg)) {
    const name = keyName(p);
    const v = p.value as AstNode;
    if (v.type !== "ObjectExpression") {
      continue;
    }
    if (name === "variants") {
      readVariants(info, v);
    }
    if (name === "defaultVariants") {
      readDefaultVariants(info, v);
    }
  }
};

/** Import specifier for `file` from the `exports` map of the package.json at `pj`. */
const specifierFromPackage = (
  pj: string,
  pkgDir: string,
  file: string
): { pkg: string; specifier: string } | null => {
  const pkg = JSON.parse(readFileSync(pj, "utf8")) as {
    name?: string;
    exports?: Record<string, unknown>;
  };
  if (!pkg.name) {
    return null;
  }
  const relNoExt = path.relative(pkgDir, file).replace(TS_EXT_RE, "");
  const exportsMap = pkg.exports ?? {};
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
        return {
          pkg: pkg.name,
          specifier: `${pkg.name}${sub.replace(LEADING_DOT_RE, "").replace("*", rest)}`,
        };
      }
    }
  }
  return { pkg: pkg.name, specifier: pkg.name };
};

/** Finds `cva(base, { variants, defaultVariants })` calls in a file with Babel. */
export const cvaFromSource = (code: string): CvaInfo => {
  const info: CvaInfo = { defaults: {}, variants: {} };
  let ast: unknown;
  try {
    ast = parse(code, {
      errorRecovery: true,
      plugins: ["jsx", "typescript"],
      sourceType: "module",
    });
  } catch {
    return info;
  }
  const visit = (n: AstNode) => {
    if (isCvaCall(n)) {
      readCvaConfig(info, n);
    }
    for (const child of astChildren(n)) {
      visit(child);
    }
  };
  visit(ast as AstNode);
  return info;
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
  if (flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown) {
    return { kind: "other", raw };
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

/** What the extraction needs from the project: resolved library directories and path mapping. */
export interface ExtractContext {
  readonly componentPackages: readonly string[];
  /** Absolute paths, already checked to be inside the repository. */
  readonly libraryDirs: readonly string[];
  readonly relative: (abs: string) => string;
}

export const catalogueSourceFiles = (ctx: ExtractContext): string[] => {
  const files: string[] = [];
  for (const dir of ctx.libraryDirs) {
    const abs = dir;
    if (!existsSync(abs)) {
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
    walk(abs);
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

/** Resolves the import specifier for a component file from the package's `exports` map. */
const importSpecifier = (
  ctx: ExtractContext,
  file: string
): { pkg: string; specifier: string } | null => {
  for (const dir of ctx.libraryDirs) {
    const abs = dir;
    if (!file.startsWith(abs)) {
      continue;
    }
    // Find the nearest package.json above the library dir.
    let probe = abs;
    while (probe !== path.dirname(probe)) {
      const pj = path.join(probe, "package.json");
      if (existsSync(pj)) {
        return specifierFromPackage(pj, probe, file);
      }
      probe = path.dirname(probe);
    }
  }
  return null;
};

const storiesOf = (ctx: ExtractContext): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const dir of ctx.libraryDirs) {
    const abs = dir;
    const roots = [
      abs,
      path.dirname(abs),
      path.join(path.dirname(abs), "stories"),
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
  const components: ComponentMeta[] = [];
  let usable = 0;

  for (const file of files) {
    for (const meta of fileComponents(ctx, program, checker, stories, file)) {
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
  ctx: ExtractContext,
  program: ts.Program,
  checker: ts.TypeChecker,
  stories: Map<string, string[]>,
  file: string
): ComponentMeta[] => {
  const sf = program.getSourceFile(file);
  if (!sf) {
    return [];
  }
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) {
    return [];
  }
  const code = sf.getFullText();
  const cva = cvaFromSource(code);
  const spec = importSpecifier(ctx, file);
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
      cva
    );
    const description =
      ts
        .displayPartsToString(component.symbol.getDocumentationComment(checker))
        .slice(0, 200) || undefined;
    out.push({
      category,
      file: ctx.relative(file),
      group: spec?.pkg ?? path.dirname(ctx.relative(file)),
      importFrom: spec?.specifier ?? base,
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
