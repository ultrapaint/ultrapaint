/**
 * Where a node leads when it is pressed in the prototype. A link is one string, so a document
 * stays plain JSON and an agent writes it by hand:
 *
 * | link                        | leads to                                                 |
 * |-----------------------------|----------------------------------------------------------|
 * | `pricing.page.json`         | that page of the canvas, whatever URL it serves, or none |
 * | `/pricing`, `/invoices/42`  | the page serving that URL, with its parameters           |
 * | `back`                      | the previous step of the click-through                   |
 * | `https://example.com`       | another site, opened beside the prototype                |
 *
 * A page named by its file is the link the editor writes: it outlives a change of URL, and it
 * reaches a page that has none. A URL is still the way to pass parameters.
 */
import { matchRoute, normaliseRoute } from "./route.ts";

export const BACK_LINK = "back";

const EXTERNAL_RE = /^(?:https?:|mailto:|tel:)/i;
const PAGE_FILE_RE = /\.page\.json$/;

type LinkTarget =
  | { readonly kind: "back" }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "page"; readonly path: string }
  | { readonly kind: "url"; readonly route: string };

/** What a link names, or null for a string that is none of the forms. */
export const linkTargetOf = (link: string): LinkTarget | null => {
  const trimmed = link.trim();
  if (trimmed === BACK_LINK) {
    return { kind: "back" };
  }
  if (EXTERNAL_RE.test(trimmed)) {
    return { kind: "external", url: trimmed };
  }
  if (trimmed.startsWith("/")) {
    return { kind: "url", route: normaliseRoute(trimmed) };
  }
  if (PAGE_FILE_RE.test(trimmed)) {
    return { kind: "page", path: trimmed };
  }
  return null;
};

interface LinkablePage {
  readonly path: string;
  readonly route?: string | undefined;
  readonly variant?: string | undefined;
}

/**
 * The base page a link leads to among a canvas's pages, or null when it leads to no page: back,
 * another site, or a page that is not there (a broken link).
 */
export const pageOfLink = <T extends LinkablePage>(
  pages: readonly T[],
  link: string
): T | null => {
  const target = linkTargetOf(link);
  const bases = pages.filter((p) => p.variant === undefined);
  if (target?.kind === "page") {
    return bases.find((p) => p.path === target.path) ?? null;
  }
  if (target?.kind === "url") {
    return matchRoute(bases, target.route)?.entry ?? null;
  }
  return null;
};

/** A link that should lead to a page of the canvas and leads to none. */
export const isBrokenLink = (
  pages: readonly LinkablePage[],
  link: string
): boolean => {
  const target = linkTargetOf(link);
  if (target === null) {
    return true;
  }
  return (
    (target.kind === "page" || target.kind === "url") &&
    pageOfLink(pages, link) === null
  );
};

interface LinkedNode {
  readonly children?: readonly LinkedNode[] | undefined;
  readonly id: string;
  readonly link?: string | undefined;
}

/** Every node of a tree that has a link, in document order. */
export const linksIn = (
  root: LinkedNode | null | undefined
): { readonly link: string; readonly nodeId: string }[] => {
  const found: { link: string; nodeId: string }[] = [];
  const walk = (node: LinkedNode) => {
    if (node.link) {
      found.push({ link: node.link, nodeId: node.id });
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  if (root) {
    walk(root);
  }
  return found;
};
