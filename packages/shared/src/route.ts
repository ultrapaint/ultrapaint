/**
 * Routes of a canvas. A page is named by its file and serves the URL the canvas's `routes`
 * give it, or none. The server and the editor need the same answers, so the lookup and the
 * matching live here: pure, synchronous, no dependency on a framework or on a file system.
 *
 * A canvas written before pages had optional URLs has no `routes`, and each of its pages serves
 * the route its path names:
 *
 * | file                  | route             |
 * |-----------------------|-------------------|
 * | `index.page.json`            | `/`             |
 * | `pricing.page.json`          | `/pricing`      |
 * | `settings/index.page.json`   | `/settings`     |
 * | `invoices/[id].page.json`    | `/invoices/:id` |
 * | `docs/[...rest].page.json`   | `/docs/*`       |
 * | `pricing@bold.page.json`     | `/pricing`, in the variant `bold` |
 */
import { humanise, toPosix } from "./path.ts";

const TRAILING_SLASHES_RE = /\/+$/;
/** A page file's extension: `.page.json`, or the one extension of any other file. */
const PAGE_EXTENSION_RE = /\.page\.json$|\.[^./]+$/;
/** The variant a page file is written for: `pricing@bold.page.json`. */
const VARIANT_RE = /@([a-z0-9][a-z0-9-]*)(?=\.page\.json$|\.[^./]+$|$)/;
const VARIANT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const REST_RE = /^\.\.\./;

/** `[id]` and `[...rest]` are the parameter forms; anything else is a literal segment. */
const parameterOf = (segment: string): string | null =>
  segment.length > 2 && segment.startsWith("[") && segment.endsWith("]")
    ? segment.slice(1, -1)
    : null;

const ROOT_ROUTE = "/";

/** A leading slash, no trailing slash, no empty segment. `""` and `"//"` are the root. */
export const normaliseRoute = (route: string): string => {
  const trimmed = toPosix(route).trim();
  const joined = trimmed
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
  return joined === ""
    ? ROOT_ROUTE
    : `/${joined.replace(TRAILING_SLASHES_RE, "")}`;
};

const routeSegments = (route: string): string[] => {
  const normalised = normaliseRoute(route);
  return normalised === ROOT_ROUTE ? [] : normalised.slice(1).split("/");
};

/** The route a page file serves, from its path inside the canvas. */
export const routeOf = (pagePath: string): string => {
  const segments = basePathOf(pagePath)
    .replace(PAGE_EXTENSION_RE, "")
    .split("/")
    .filter((segment) => segment !== "");
  const last = segments.at(-1);
  if (last === "index") {
    segments.pop();
  }
  return normaliseRoute(
    segments
      .map((segment) => {
        const parameter = parameterOf(segment);
        if (parameter === null) {
          return segment;
        }
        return parameter.startsWith("...") ? "*" : `:${parameter}`;
      })
      .join("/")
  );
};

/**
 * What a page file is called: its name made readable, `billing-settings.page.json` is "Billing
 * settings". An `index` file is named after its directory, and the canvas's own is "Home"; a
 * parameter file (`invoices/[id]`) after its directory and the parameter.
 */
export const pageNameOf = (pagePath: string): string => {
  const segments = basePathOf(pagePath)
    .replace(PAGE_EXTENSION_RE, "")
    .split("/")
    .filter((segment) => segment !== "");
  const last = segments.at(-1) ?? "index";
  const parent = segments.at(-2);
  if (last === "index") {
    return parent === undefined ? "Home" : humanise(parent);
  }
  const parameter = parameterOf(last);
  if (parameter === null) {
    return humanise(last);
  }
  const name = humanise(parameter.replace(REST_RE, ""));
  return parent === undefined
    ? name
    : `${humanise(parent)} ${name.toLowerCase()}`;
};

/**
 * The URL a page serves, from the canvas's `routes`: its own entry, or its base page's for a
 * variant. A canvas without `routes` serves each page at the route its path names.
 */
export const pageRouteOf = (
  routes: Readonly<Record<string, string>> | undefined,
  pagePath: string
): string | undefined => {
  if (routes === undefined) {
    return routeOf(pagePath);
  }
  const route = routes[basePathOf(pagePath)];
  return route === undefined ? undefined : normaliseRoute(route);
};

/**
 * The canvas's `routes` written out: as they are, or, for a canvas that has none yet, the
 * route each of these base pages' paths names.
 */
export const routesOf = (
  routes: Readonly<Record<string, string>> | undefined,
  basePaths: readonly string[]
): Record<string, string> =>
  routes === undefined
    ? Object.fromEntries(basePaths.map((p) => [p, routeOf(p)]))
    : { ...routes };

interface RouteMatch<T> {
  readonly entry: T;
  readonly params: Record<string, string>;
}

interface Pattern {
  readonly catchAll: string | null;
  readonly segments: readonly string[];
}

const patternOf = (route: string): Pattern => {
  const segments = routeSegments(route);
  return segments.at(-1) === "*"
    ? { catchAll: "rest", segments: segments.slice(0, -1) }
    : { catchAll: null, segments };
};

/** A segment of a URL decoded; as it is written when its `%` escapes do not read. */
const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A URL someone typed or an agent wrote ("/invoices/100%") still names a page.
    return segment;
  }
};

/**
 * How well a pattern fits, or null when it does not. Compared segment by segment, so a static
 * segment beats a dynamic one at the same depth and any match beats a catch-all: it scores below
 * the nothing of a pattern that ends there, so a page at the URL itself wins over it.
 */
const scoreOf = (
  pattern: Pattern,
  path: readonly string[]
): { params: Record<string, string>; score: number[] } | null => {
  if (
    pattern.catchAll === null
      ? path.length !== pattern.segments.length
      : path.length < pattern.segments.length
  ) {
    return null;
  }
  const params: Record<string, string> = {};
  const score: number[] = [];
  for (const [index, segment] of pattern.segments.entries()) {
    const actual = path[index] as string;
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeSegment(actual);
      score.push(2);
    } else if (segment === actual) {
      score.push(3);
    } else {
      return null;
    }
  }
  if (pattern.catchAll !== null) {
    params[pattern.catchAll] = path.slice(pattern.segments.length).join("/");
    score.push(-1);
  }
  return { params, score };
};

const better = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) {
      return left > right;
    }
  }
  return a.length > b.length;
};

/** The entry that serves this route, with the parameters it binds. An entry without one never does. */
export const matchRoute = <T extends { readonly route?: string | undefined }>(
  entries: readonly T[],
  route: string
): RouteMatch<T> | null => {
  const path = routeSegments(route);
  let best: {
    entry: T;
    params: Record<string, string>;
    score: number[];
  } | null = null;
  for (const entry of entries) {
    if (entry.route === undefined) {
      continue;
    }
    const hit = scoreOf(patternOf(entry.route), path);
    if (hit && (best === null || better(hit.score, best.score))) {
      best = { entry, params: hit.params, score: hit.score };
    }
  }
  return best ? { entry: best.entry, params: best.params } : null;
};

/** Whether a name can be a variant's: lowercase letters, digits and dashes. */
export const isVariantName = (name: string): boolean =>
  VARIANT_NAME_RE.test(name);

/** The variant a page file is written for, or null for the base: `pricing@bold.page.json` is `bold`. */
export const variantOf = (pagePath: string): string | null => {
  const last = toPosix(pagePath).split("/").at(-1) ?? "";
  const match: RegExpExecArray | null = VARIANT_RE.exec(last);
  return match ? (match[1] ?? null) : null;
};

/** The file of the base page a variant's file stands in for: `pricing.page.json`. */
export const basePathOf = (pagePath: string): string => {
  const posix = toPosix(pagePath);
  const cut = posix.lastIndexOf("/") + 1;
  return posix.slice(0, cut) + posix.slice(cut).replace(VARIANT_RE, "");
};

/** The file a base page's variant is written in: `pricing.page.json` and `bold` give `pricing@bold.page.json`. */
export const variantPathOf = (basePath: string, variant: string): string => {
  const base = basePathOf(basePath);
  const cut = base.lastIndexOf("/") + 1;
  const name = base.slice(cut);
  const match: RegExpExecArray | null = PAGE_EXTENSION_RE.exec(name);
  const extension = match ? match[0] : "";
  return `${base.slice(0, cut)}${name.slice(0, name.length - extension.length)}@${variant}${extension}`;
};

/**
 * The pages a router serves in a variant: each base page, or the variant's own file for its route
 * when the variant has one. `null` is the base alone. A variant's page without a base still
 * serves its route in that variant.
 */
export const pagesInVariant = <
  T extends { readonly path: string; readonly variant?: string | undefined },
>(
  pages: readonly T[],
  variant: string | null
): T[] => {
  const base = pages.filter((p) => p.variant === undefined);
  if (variant === null) {
    return base;
  }
  const own = new Map(
    pages
      .filter((p) => p.variant === variant)
      .map((p) => [basePathOf(p.path), p] as const)
  );
  const served = base.map((p) => own.get(p.path) ?? p);
  for (const [path, page] of own) {
    if (!base.some((b) => b.path === path)) {
      served.push(page);
    }
  }
  return served;
};
