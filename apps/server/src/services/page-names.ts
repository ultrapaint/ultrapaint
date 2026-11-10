/**
 * Which page a name means, the one rule for an agent's tool (`mcp/lookup.ts`, by
 * `pageTargetNamed`) and for a task (`threads/page-tasks.ts`), and which design
 * (`designTargetNamed`): a page or a component; and what a miss of a page says
 * (`pageMissed`). Pure.
 *
 * - A URL names the base page that serves it in its canvas's prototype: not a variant's page,
 *   which serves the same URL and is named by its file, and not a state's page, which serves
 *   none (`orders@empty.page.json`, ADR 0030). Only a link the editor copies says a variant
 *   beside the URL (`variant=bold`): it names the page the router serves there, the variant's
 *   own or, when it has none, the base page.
 * - Anything else is a page's id, its file (repository-relative) or its path inside its canvas,
 *   whatever the page: a variant's and a state's included.
 * - Nothing names the only page there is.
 *
 * A canvas narrows the pages to its own. Without one, a name that pages of several canvases
 * answer to (`/` in each) is ambiguous, rather than whichever was listed first.
 */
import { COMPONENT_TARGET_PREFIX } from "@ultrapaint/contracts/implementation";
import {
  CANVAS_ID_PATTERN,
  parseEditorLink,
  parseNodeRef,
} from "@ultrapaint/shared/node-ref";
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

type PageNamed<T> =
  | { readonly _tag: "Found"; readonly page: T }
  /** No page answers to it; `route` is the URL it was read as, null for a file or nothing. */
  | { readonly _tag: "Missing"; readonly route: string | null }
  /** Pages of several canvases answer to it, by canvas. */
  | { readonly _tag: "Ambiguous"; readonly canvases: readonly string[] };

export const pageNamed = <T extends NamedPage>(
  pages: readonly T[],
  name: string,
  canvas?: string,
  variant?: string
): PageNamed<T> => {
  const where = name.trim();
  const route = where.startsWith("/") ? normaliseRoute(where) : null;
  const inCanvas = pages.filter(
    (p) => canvas === undefined || p.canvas === canvas
  );
  /** Whether a page serves the URL drawn for `drawn`: a variant, or the base. */
  const serves = (p: T, drawn: string | undefined) =>
    p.route === route && p.variant === drawn && p.state === undefined;
  const found = inCanvas.filter((p) => {
    if (where === "") {
      return inCanvas.length === 1;
    }
    if (route === null) {
      return p.id === where || p.file === where || p.path === where;
    }
    // In a variant, the base page serves the URL only where the variant has no page for it.
    return (
      serves(p, variant) ||
      (variant !== undefined &&
        serves(p, undefined) &&
        !inCanvas.some((q) => q.canvas === p.canvas && serves(q, variant)))
    );
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

/** A page's name inside a canvas named first: `marketing:/pricing`, `marketing:pricing.page.json`. */
const IN_CANVAS_RE = new RegExp(
  String.raw`^(${CANVAS_ID_PATTERN}):(\/\S*|[^\s#/:][^\s#:]*\.page\.json)$`
);

/** What a page's name names: the page, maybe one of its nodes. */
type PageTargetNamed<P> =
  | { readonly _tag: "Page"; readonly nodeId?: string; readonly page: P }
  /**
   * A node on the canvas beside the pages (`canvas#c_1`), which is no page; `canvas` is the one
   * the reference writes first (`marketing:canvas#c_1`).
   */
  | {
      readonly _tag: "Loose";
      readonly canvas?: string;
      readonly nodeId: string;
    }
  /** No page answers to it; `route` is the URL it was read as, null for a file or nothing. */
  | { readonly _tag: "Missing"; readonly route: string | null }
  /** Pages of several canvases answer to it, by canvas. */
  | { readonly _tag: "Ambiguous"; readonly canvases: readonly string[] };

/**
 * Which page a name means, as an agent writes it: by `pageNamed`'s rule, a canvas written first
 * included (`marketing:/pricing`), and a node reference (`/orders#c_8`) names its page and keeps
 * its node; a link the editor copies, to a page or to a node, is read as either, in the variant
 * it says. The canvas given narrows the pages, over one the name says.
 */
export const pageTargetNamed = <P extends NamedPage>(
  pages: readonly P[],
  name: string,
  canvas?: string
): PageTargetNamed<P> => {
  const where = name.trim();
  const ref = parseNodeRef(where);
  if (ref?.page === null) {
    return ref.canvas === undefined
      ? { _tag: "Loose", nodeId: ref.nodeId }
      : { _tag: "Loose", canvas: ref.canvas, nodeId: ref.nodeId };
  }
  // A link the editor copies names a page by its URL or id, in its canvas and its variant.
  const link = parseEditorLink(where);
  const inCanvas = ref || link ? null : IN_CANVAS_RE.exec(where);
  const page = ref?.page ?? link?.page ?? inCanvas?.[2] ?? where;
  const found = pageNamed(
    pages,
    page,
    canvas ?? ref?.canvas ?? link?.canvas ?? inCanvas?.[1],
    link?.variant
  );
  if (found._tag !== "Found") {
    return found;
  }
  return ref
    ? { _tag: "Page", nodeId: ref.nodeId, page: found.page }
    : { _tag: "Page", page: found.page };
};

/** What a design target names: a page, maybe one of its nodes, or a component. */
type DesignTargetNamed<P, C> =
  | { readonly _tag: "Page"; readonly nodeId?: string; readonly page: P }
  | { readonly _tag: "Component"; readonly component: C }
  /**
   * Nothing answers to it, of the kind the name is read as; `route` is the URL a page's name was
   * read as, null for a file, nothing or a component.
   */
  | {
      readonly _tag: "Missing";
      readonly kind: "page" | "component";
      readonly route: string | null;
    }
  /** Pages of several canvases answer to it, by canvas. */
  | { readonly _tag: "Ambiguous"; readonly canvases: readonly string[] };

/**
 * Which design a name means, for `/implement`, `handoff` and the link to the code (ADR 0030):
 *
 * - `component:Button`, or a name no page could have (`Button`: no `/`, `#` or `.page.json`),
 *   names the component, by its file (a system component without one has nothing to implement);
 * - anything else is a page, by `pageTargetNamed`'s rule: a canvas written first included
 *   (`marketing:/pricing`), a node reference (`/orders#c_8`) naming its page and keeping its
 *   node.
 *
 * Pages are named by URL or file and components by name, so the two never answer to one name.
 * The canvas given narrows the pages, over one the name says.
 */
export const designTargetNamed = <
  P extends NamedPage,
  C extends { readonly name: string },
>(
  pages: readonly P[],
  components: readonly C[],
  name: string,
  canvas?: string
): DesignTargetNamed<P, C> => {
  const where = name.trim();
  const isPage =
    parseNodeRef(where) !== null ||
    where === "" ||
    where.includes("/") ||
    where.endsWith(".page.json");
  if (where.startsWith(COMPONENT_TARGET_PREFIX) || !isPage) {
    const named = where.startsWith(COMPONENT_TARGET_PREFIX)
      ? where.slice(COMPONENT_TARGET_PREFIX.length)
      : where;
    const component = components.find((c) => c.name === named);
    return component
      ? { _tag: "Component", component }
      : { _tag: "Missing", kind: "component", route: null };
  }
  const found = pageTargetNamed(pages, where, canvas);
  if (found._tag === "Loose") {
    // A node on the canvas beside the pages is no design.
    return { _tag: "Missing", kind: "page", route: null };
  }
  return found._tag === "Missing"
    ? { _tag: "Missing", kind: "page", route: found.route }
    : found;
};

/** A page as a list shows it: its name, its URL or that it has none, its file. */
export const pageEntry = (page: {
  readonly file: string;
  readonly name: string;
  readonly route?: string | undefined;
  readonly variant?: string | undefined;
}) =>
  `${page.name}${page.variant ? ` (variant ${page.variant})` : ""}, ${page.route ?? "no URL"}: ${page.file}`;

const quoted = (id: string) => JSON.stringify(id);

/** Items of a kind, one a line, or that there are none. */
export const listedAs = (lines: readonly string[], kind: string) =>
  lines.length > 0
    ? `the ${kind} are:\n${lines.map((line) => `- ${line}`).join("\n")}`
    : `there are no ${kind}`;

/**
 * What a miss of a page's name says, for a tool and a design target alike: the name, in the
 * canvas given, or the canvases it is a page in; then every page.
 */
export const pageMissed = (
  pages: readonly (NamedPage & { readonly name: string })[],
  missed:
    | { readonly _tag: "Missing" }
    | { readonly _tag: "Ambiguous"; readonly canvases: readonly string[] },
  name: string,
  canvas?: string
) => {
  const all = listedAs(pages.map(pageEntry), "pages");
  if (missed._tag === "Ambiguous") {
    return `${name} is a page in several canvases (${missed.canvases.map(quoted).join(", ")}); ${all}`;
  }
  const where = name.trim();
  const inCanvas = canvas === undefined ? "" : ` in canvas ${quoted(canvas)}`;
  return `${where === "" ? "it did not say which page" : `no page is ${where}${inCanvas}`}; ${all}`;
};
