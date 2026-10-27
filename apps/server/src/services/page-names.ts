/**
 * Which page a name means, the one rule for an agent's tool (`mcp/lookup.ts`) and for a task
 * (`threads/page-tasks.ts`). Pure.
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
