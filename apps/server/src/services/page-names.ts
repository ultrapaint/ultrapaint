/**
 * Which page a name means, the one rule for an agent's tool (`mcp/lookup.ts`) and for a task
 * (`threads/page-tasks.ts`), and which design (`designTargetNamed`): a page or a component spec.
 * Pure.
 *
 * - A URL names the base page that serves it in its canvas's prototype: not a variant's page,
 *   which serves the same URL and is named by its file, and not a state's page, which serves
 *   none (`orders@empty.page.json`, ADR 0030).
 * - Anything else is a page's id, its file (repository-relative) or its path inside its canvas,
 *   whatever the page: a variant's and a state's included.
 * - Nothing names the only page there is.
 *
 * A canvas narrows the pages to its own. Without one, a name that pages of several canvases
 * answer to (`/` in each) is ambiguous, rather than whichever was listed first.
 */
import { SPEC_TARGET_PREFIX } from "@ultrapaint/contracts/implementation";
import { parseNodeRef } from "@ultrapaint/shared/node-ref";
import { normaliseRoute } from "@ultrapaint/shared/route";

/** What a page needs for its name to be read. */
export interface NamedPage {
  readonly canvas: string;
  readonly file: string;
  readonly id: string;
  readonly path: string;
  readonly route?: string | undefined;
  readonly state?: string | undefined;
  readonly variant?: string | undefined;
}

export type PageNamed<T> =
  | { readonly _tag: "Found"; readonly page: T }
  /** No page answers to it; `route` is the URL it was read as, null for a file or nothing. */
  | { readonly _tag: "Missing"; readonly route: string | null }
  /** Pages of several canvases answer to it, by canvas. */
  | { readonly _tag: "Ambiguous"; readonly canvases: readonly string[] };

export const pageNamed = <T extends NamedPage>(
  pages: readonly T[],
  name: string,
  canvas?: string
): PageNamed<T> => {
  const where = name.trim();
  const route = where.startsWith("/") ? normaliseRoute(where) : null;
  const inCanvas = pages.filter(
    (p) => canvas === undefined || p.canvas === canvas
  );
  const found = inCanvas.filter((p) => {
    if (where === "") {
      return inCanvas.length === 1;
    }
    return route === null
      ? p.id === where || p.file === where || p.path === where
      : p.route === route && p.variant === undefined && p.state === undefined;
  });
  const [only] = found;
  if (only && found.length === 1) {
    return { _tag: "Found", page: only };
  }
  if (found.length === 0) {
    return { _tag: "Missing", route };
  }
  return {
    _tag: "Ambiguous",
    canvases: [...new Set(found.map((p) => p.canvas))],
  };
};

/** What a design target names: a page, maybe one of its nodes, or a component's spec. */
export type DesignTargetNamed<P, S> =
  | { readonly _tag: "Page"; readonly nodeId?: string; readonly page: P }
  | { readonly _tag: "Spec"; readonly spec: S }
  /**
   * Nothing answers to it, of the kind the name is read as; `route` is the URL a page's name was
   * read as, null for a file, nothing or a spec.
   */
  | {
      readonly _tag: "Missing";
      readonly kind: "page" | "spec";
      readonly route: string | null;
    }
  /** Pages of several canvases answer to it, by canvas. */
  | { readonly _tag: "Ambiguous"; readonly canvases: readonly string[] };

/** A page's name inside a canvas named first: `marketing:/pricing`, `marketing:pricing.page.json`. */
const IN_CANVAS_RE = /^([\w.-]+):(\/\S*|[^\s#/:][^\s#:]*\.page\.json)$/;

/**
 * Which design a name means, for `/implement`, `handoff` and the link to the code (ADR 0030):
 *
 * - `spec:Button`, or a name no page could have (`Button`: no `/`, `#` or `.page.json`), names
 *   the component's spec;
 * - anything else is a page, by `pageNamed`'s rule, a canvas written first included
 *   (`marketing:/pricing`); a node reference (`/orders#c_8`) names its page and keeps its node.
 *
 * Pages are named by URL or file and specs by component, so the two never answer to one name.
 * The canvas given narrows the pages, over one the name says.
 */
export const designTargetNamed = <
  P extends NamedPage,
  S extends { readonly component: string },
>(
  pages: readonly P[],
  specs: readonly S[],
  name: string,
  canvas?: string
): DesignTargetNamed<P, S> => {
  const where = name.trim();
  const ref = parseNodeRef(where);
  const inCanvas = ref ? null : IN_CANVAS_RE.exec(where);
  const isPage =
    ref !== null ||
    where === "" ||
    where.includes("/") ||
    where.endsWith(".page.json");
  if (where.startsWith(SPEC_TARGET_PREFIX) || !isPage) {
    const component = where.startsWith(SPEC_TARGET_PREFIX)
      ? where.slice(SPEC_TARGET_PREFIX.length)
      : where;
    const spec = specs.find((s) => s.component === component);
    return spec
      ? { _tag: "Spec", spec }
      : { _tag: "Missing", kind: "spec", route: null };
  }
  if (ref?.page === null) {
    // A node on the canvas beside the pages is no design.
    return { _tag: "Missing", kind: "page", route: null };
  }
  const page = ref?.page ?? inCanvas?.[2] ?? where;
  const found = pageNamed(pages, page, canvas ?? ref?.canvas ?? inCanvas?.[1]);
  if (found._tag === "Found") {
    return ref
      ? { _tag: "Page", nodeId: ref.nodeId, page: found.page }
      : { _tag: "Page", page: found.page };
  }
  return found._tag === "Missing"
    ? { _tag: "Missing", kind: "page", route: found.route }
    : found;
};
