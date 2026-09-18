/**
 * Routes of a space, derived from the page files inside it. The server, the editor and the
 * generated preview entry all need the same answers, so the derivation and the matching live
 * here: pure, synchronous, no dependency on a framework or on a file system.
 *
 * | file                  | route             |
 * |-----------------------|-------------------|
 * | `index.tsx`           | `/`               |
 * | `pricing.tsx`         | `/pricing`        |
 * | `settings/index.tsx`  | `/settings`       |
 * | `invoices/[id].tsx`   | `/invoices/:id`   |
 * | `docs/[...rest].tsx`  | `/docs/*`         |
 */
import { humanise, stripExtension, toPosix } from "./path.ts";

const TRAILING_SLASHES_RE = /\/+$/;

/** `[id]` and `[...rest]` are the parameter forms; anything else is a literal segment. */
const parameterOf = (segment: string): string | null =>
  segment.length > 2 && segment.startsWith("[") && segment.endsWith("]")
    ? segment.slice(1, -1)
    : null;

export const ROOT_ROUTE = "/";

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

export const routeSegments = (route: string): string[] => {
  const normalised = normaliseRoute(route);
  return normalised === ROOT_ROUTE ? [] : normalised.slice(1).split("/");
};

/** The route a page file serves, from its path inside the space. */
export const routeOf = (pagePath: string): string => {
  const segments = stripExtension(toPosix(pagePath))
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
 * The page path a route asks for, without an extension: the inverse of `routeOf` for the
 * static routes a person types when creating a page. `/` is `index`.
 */
export const pagePathOf = (route: string): string => {
  const segments = routeSegments(route).map((segment) =>
    segment.startsWith(":") ? `[${segment.slice(1)}]` : segment
  );
  return segments.length === 0 ? "index" : segments.join("/");
};

/** `Home` for the root, otherwise the last segment made readable. */
export const routeLabel = (route: string): string => {
  const last = routeSegments(route).at(-1);
  if (last === undefined) {
    return "Home";
  }
  if (last === "*") {
    return "Catch all";
  }
  return last.startsWith(":") ? humanise(last.slice(1)) : humanise(last);
};

export interface RouteMatch<T> {
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

/**
 * How well a pattern fits, or null when it does not. Compared segment by segment, so a static
 * segment beats a dynamic one at the same depth and any match beats a catch-all.
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
      params[segment.slice(1)] = decodeURIComponent(actual);
      score.push(2);
    } else if (segment === actual) {
      score.push(3);
    } else {
      return null;
    }
  }
  if (pattern.catchAll !== null) {
    params[pattern.catchAll] = path.slice(pattern.segments.length).join("/");
    score.push(1);
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

/** The entry that serves this route, with the parameters it binds. */
export const matchRoute = <T extends { readonly route: string }>(
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
    const hit = scoreOf(patternOf(entry.route), path);
    if (hit && (best === null || better(hit.score, best.score))) {
      best = { entry, params: hit.params, score: hit.score };
    }
  }
  return best ? { entry: best.entry, params: best.params } : null;
};

/**
 * What a `to` means: a route when it starts with a slash, otherwise the page file it names
 * inside the space (`settings/billing`, `settings/billing.tsx`).
 */
export const resolveTarget = (to: string): string => {
  const trimmed = toPosix(to).trim();
  return trimmed.startsWith("/") ? normaliseRoute(trimmed) : routeOf(trimmed);
};
