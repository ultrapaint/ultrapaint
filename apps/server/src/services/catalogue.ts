/**
 * Component catalogue: extracts exported components, their prop types, enum members,
 * defaults and `cva` variants from the configured design-system directories with the
 * TypeScript compiler API, and caches the result under the tool home.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import type {
  Catalogue,
  ComponentMeta,
  JsonValue,
  PropMeta,
  PropType,
  Settings,
} from "@ultrapaint/contracts";
// TypeScript 7 (native) has no JS compiler API; the catalogue uses the 5.x API under an alias.
import ts from "typescript-api";
import { hashContent } from "../util.ts";
import type { RepoPaths } from "./repo.ts";

/** Bump when the extraction logic changes so stale caches are rebuilt. */
const CATALOGUE_VERSION = 2;

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
  [/^(alert|badge|progress|skeleton|spinner|empty|banner|callout|status)/, "Feedback"],
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
  variants: Record<string, string[]>;
  defaults: Record<string, string>;
}

/** Finds `cva(base, { variants, defaultVariants })` calls in a file with Babel. */
export const cvaFromSource = (code: string): CvaInfo => {
  const info: CvaInfo = { variants: {}, defaults: {} };
  let ast: unknown;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: true,
    });
  } catch {
    return info;
  }
  type N = { type: string; [k: string]: unknown };
  const isNode = (v: unknown): v is N =>
    typeof v === "object" && v !== null && typeof (v as N).type === "string";
  const keyName = (p: N) => {
    const k = p.key as N;
    return k.type === "Identifier"
      ? (k.name as string)
      : k.type === "StringLiteral"
        ? (k.value as string)
        : null;
  };
  const visit = (n: N) => {
    if (
      n.type === "CallExpression" &&
      (n.callee as N).type === "Identifier" &&
      (n.callee as N).name === "cva"
    ) {
      const cfg = (n.arguments as N[])[1];
      if (cfg?.type === "ObjectExpression") {
        for (const p of cfg.properties as N[]) {
          if (p.type !== "ObjectProperty") continue;
          const name = keyName(p);
          const v = p.value as N;
          if (name === "variants" && v.type === "ObjectExpression") {
            for (const vp of v.properties as N[]) {
              if (vp.type !== "ObjectProperty") continue;
              const vn = keyName(vp);
              const vv = vp.value as N;
              if (vn && vv.type === "ObjectExpression") {
                info.variants[vn] = (vv.properties as N[])
                  .map((m) => (m.type === "ObjectProperty" ? keyName(m) : null))
                  .filter((x): x is string => !!x);
              }
            }
          }
          if (name === "defaultVariants" && v.type === "ObjectExpression") {
            for (const dp of v.properties as N[]) {
              if (dp.type !== "ObjectProperty") continue;
              const dn = keyName(dp);
              const dv = dp.value as N;
              if (dn && dv.type === "StringLiteral") info.defaults[dn] = dv.value as string;
            }
          }
        }
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "loc") continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (const x of v) if (isNode(x)) visit(x);
      } else if (isNode(v)) {
        visit(v);
      }
    }
  };
  visit(ast as N);
  return info;
};

export class CatalogueService {
  private cached: Catalogue | null = null;

  constructor(
    readonly paths: RepoPaths,
    readonly settings: Settings,
    readonly home: string,
    readonly log: (level: "info" | "warn" | "error", text: string) => void,
  ) {}

  private sourceFiles(): string[] {
    const files: string[] = [];
    for (const dir of this.settings.libraryDirs) {
      const abs = this.paths.resolve(dir);
      if (!existsSync(abs)) continue;
      const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name.startsWith(".")) continue;
            walk(p);
          } else if (/\.tsx$/.test(e.name) && !/\.(stories|test|spec)\.tsx$/.test(e.name))
            files.push(p);
        }
      };
      walk(abs);
    }
    return files.sort();
  }

  private cacheKey(files: string[]): string {
    return hashContent(
      `v${CATALOGUE_VERSION}\n${files.map((f) => `${f}:${statSync(f).mtimeMs}`).join("\n")}${JSON.stringify(this.settings.componentPackages)}`,
    );
  }

  private cacheFile(key: string) {
    const dir = path.join(this.home, "catalogue");
    mkdirSync(dir, { recursive: true });
    return path.join(dir, `${key}.json`);
  }

  async get(refresh: boolean): Promise<Catalogue> {
    const files = this.sourceFiles();
    const key = this.cacheKey(files);
    const cache = this.cacheFile(key);
    if (!refresh && this.cached) return this.cached;
    if (!refresh && existsSync(cache)) {
      this.cached = JSON.parse(readFileSync(cache, "utf8")) as Catalogue;
      return this.cached;
    }
    const started = Date.now();
    const catalogue = this.build(files);
    writeFileSync(cache, JSON.stringify(catalogue));
    this.cached = catalogue;
    this.log(
      "info",
      `catalogue built: ${catalogue.components.length} components (${catalogue.coverage.usable} with metadata) in ${Date.now() - started} ms`,
    );
    return catalogue;
  }

  /** Resolves the import specifier for a component file from the package's `exports` map. */
  private importSpecifier(file: string): { pkg: string; specifier: string } | null {
    for (const dir of this.settings.libraryDirs) {
      const abs = this.paths.resolve(dir);
      if (!file.startsWith(abs)) continue;
      // Find the nearest package.json above the library dir.
      let probe = abs;
      while (probe !== path.dirname(probe)) {
        const pj = path.join(probe, "package.json");
        if (existsSync(pj)) {
          const pkg = JSON.parse(readFileSync(pj, "utf8")) as {
            name?: string;
            exports?: Record<string, unknown>;
          };
          if (!pkg.name) return null;
          const relNoExt = path.relative(probe, file).replace(/\.tsx?$/, "");
          const exportsMap = pkg.exports ?? {};
          for (const [sub, target] of Object.entries(exportsMap)) {
            const targets =
              typeof target === "string"
                ? [target]
                : Object.values((target ?? {}) as Record<string, unknown>).flat();
            for (const t of targets) {
              if (typeof t !== "string" || !t.includes("*")) continue;
              const prefix = t.replace(/^\.\//, "").split("*")[0] ?? "";
              if (relNoExt.startsWith(prefix)) {
                const rest = relNoExt.slice(prefix.length);
                return {
                  pkg: pkg.name,
                  specifier: `${pkg.name}${sub.replace(/^\./, "").replace("*", rest)}`,
                };
              }
            }
          }
          return { pkg: pkg.name, specifier: pkg.name };
        }
        probe = path.dirname(probe);
      }
    }
    return null;
  }

  private stories(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const dir of this.settings.libraryDirs) {
      const abs = this.paths.resolve(dir);
      const roots = [abs, path.dirname(abs), path.join(path.dirname(abs), "stories")];
      for (const r of roots) {
        if (!existsSync(r) || !statSync(r).isDirectory()) continue;
        for (const e of readdirSync(r)) {
          if (!e.endsWith(".stories.tsx")) continue;
          const code = readFileSync(path.join(r, e), "utf8");
          const title = /title:\s*["'`]([^"'`]+)["'`]/.exec(code)?.[1];
          if (!title) continue;
          const exportsNames = Array.from(code.matchAll(/export const (\w+)\s*[:=]/g)).map(
            (m) => m[1] as string,
          );
          const base = e.replace(".stories.tsx", "");
          map.set(
            base,
            exportsNames.map((n) => `${toStoryId(title)}--${toStoryId(n)}`),
          );
        }
      }
    }
    return map;
  }

  private build(files: string[]): Catalogue {
    const program = ts.createProgram(files, {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowJs: true,
      allowImportingTsExtensions: true,
    });
    const checker = program.getTypeChecker();
    const stories = this.stories();
    const components: ComponentMeta[] = [];
    let usable = 0;

    for (const file of files) {
      const sf = program.getSourceFile(file);
      if (!sf) continue;
      const moduleSymbol = checker.getSymbolAtLocation(sf);
      if (!moduleSymbol) continue;
      const code = sf.getFullText();
      const cva = cvaFromSource(code);
      const spec = this.importSpecifier(file);
      const base = path.basename(file, ".tsx");
      const category = CATEGORIES.find(([re]) => re.test(base))?.[1] ?? "Other";
      for (const exp of checker.getExportsOfModule(moduleSymbol)) {
        const name = exp.getName();
        if (!/^[A-Z]/.test(name)) continue;
        const symbol = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
        const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
        if (!decl) continue;
        const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
        const sig = type.getCallSignatures()[0];
        if (!sig) continue;
        const ret = checker.typeToString(sig.getReturnType());
        if (!/Element|ReactNode|JSX|null/.test(ret)) continue;
        const param = sig.getParameters()[0];
        const props: PropMeta[] = [];
        const variants: Record<string, string[]> = {};
        if (param) {
          const propsType = checker.getTypeOfSymbolAtLocation(param, decl);
          for (const p of propsType.getProperties()) {
            const pname = p.getName();
            const pdecl = p.declarations?.[0];
            const fromNodeModules =
              !!pdecl && pdecl.getSourceFile().fileName.includes("/node_modules/");
            if (fromNodeModules && !HTML_PROP_ALLOWLIST.has(pname)) continue;
            if (pname.startsWith("on") && /^on[A-Z]/.test(pname)) continue;
            if (pname.startsWith("aria-") || pname.startsWith("data-")) continue;
            const ptype = checker.getTypeOfSymbolAtLocation(p, decl);
            const meta = classify(checker, ptype, pname);
            if (!meta) continue;
            const required = !(p.flags & ts.SymbolFlags.Optional);
            const jsDoc = ts.displayPartsToString(p.getDocumentationComment(checker));
            const prop: PropMeta = {
              name: pname,
              type: meta,
              required,
              ...(jsDoc ? { description: jsDoc.slice(0, 200) } : {}),
              ...(cva.defaults[pname] !== undefined
                ? { defaultValue: cva.defaults[pname] as JsonValue }
                : {}),
            };
            if (meta.kind === "enum" && cva.variants[pname])
              variants[pname] = [...(meta.members ?? cva.variants[pname] ?? [])];
            props.push(prop);
            if (props.length >= 48) break;
          }
        }
        for (const [vn, members] of Object.entries(cva.variants)) {
          if (!variants[vn] && props.some((p) => p.name === vn)) variants[vn] = members;
        }
        const requiredProps = props.filter((p) => p.required && p.name !== "children");
        const attrs = requiredProps
          .map((p) => {
            if (p.type.kind === "enum") return `${p.name}="${p.type.members?.[0] ?? ""}"`;
            if (p.type.kind === "string") return `${p.name}=""`;
            if (p.type.kind === "number") return `${p.name}={0}`;
            if (p.type.kind === "boolean") return p.name;
            return null;
          })
          .filter(Boolean)
          .join(" ");
        const hasChildren = props.some((p) => p.name === "children");
        const snippet = hasChildren
          ? `<${name}${attrs ? ` ${attrs}` : ""}>${name}</${name}>`
          : `<${name}${attrs ? ` ${attrs}` : ""} />`;
        const description =
          ts.displayPartsToString(symbol.getDocumentationComment(checker)).slice(0, 200) ||
          undefined;
        const meta: ComponentMeta = {
          name,
          importFrom: spec?.specifier ?? base,
          file: this.paths.relative(file),
          group: spec?.pkg ?? path.dirname(this.paths.relative(file)),
          category,
          props,
          variants,
          snippet,
          storyIds: stories.get(base) ?? [],
          ...(description ? { description } : {}),
        };
        components.push(meta);
        if (props.length > 0 || Object.keys(variants).length > 0) usable += 1;
      }
    }
    components.sort((a, b) => a.name.localeCompare(b.name));
    return { builtAt: Date.now(), components, coverage: { total: components.length, usable } };
  }

  async storyUrl(storyId: string): Promise<string | null> {
    const base = this.settings.storybookUrl;
    if (!base) return null;
    return `${base.replace(/\/$/, "")}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
  }
}

const classify = (checker: ts.TypeChecker, type: ts.Type, name: string): PropType | null => {
  const raw = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation).slice(0, 200);
  const nonNull = type.getNonNullableType();
  const flags = nonNull.getFlags();
  if (nonNull.isUnion()) {
    const members = nonNull.types.filter(
      (t) => !(t.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    );
    if (members.length > 0 && members.every((t) => t.isStringLiteral())) {
      return { kind: "enum", members: members.map((t) => (t as ts.StringLiteralType).value), raw };
    }
    if (members.every((t) => t.getFlags() & ts.TypeFlags.BooleanLiteral))
      return { kind: "boolean", raw };
    if (members.every((t) => t.getFlags() & ts.TypeFlags.NumberLike))
      return { kind: "number", raw };
    if (
      members.some((t) => t.isStringLiteral()) &&
      members.every((t) => t.isStringLiteral() || t.getFlags() & ts.TypeFlags.String)
    ) {
      return { kind: "string", raw };
    }
  }
  if (flags & ts.TypeFlags.BooleanLike) return { kind: "boolean", raw };
  if (flags & ts.TypeFlags.StringLike) return { kind: "string", raw };
  if (flags & ts.TypeFlags.NumberLike) return { kind: "number", raw };
  if (nonNull.getCallSignatures().length > 0) return { kind: "function", raw };
  if (
    /ReactNode|ReactElement|Element|children/i.test(raw) ||
    name === "children" ||
    name === "render"
  )
    return { kind: "node", raw };
  if (flags & ts.TypeFlags.Object) return { kind: "object", raw };
  if (flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown) return { kind: "other", raw };
  return { kind: "other", raw };
};
