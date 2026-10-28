/**
 * Links as the editor uses them: followed when pressed in the prototype, named in the fields that
 * set them, and counted before a page they lead to goes away. The forms a link takes are in
 * `@ultrapaint/shared/link`.
 */
import type { Page } from "@ultrapaint/contracts/pages";
import {
  isBrokenLink,
  linksIn,
  linkTargetOf,
  pageOfLink,
} from "@ultrapaint/shared/link";
import { basePathOf } from "@ultrapaint/shared/route";
import { toast } from "sonner";
import { zoomToSelection } from "../state/camera.ts";
import { useDocuments } from "../state/documents.ts";
import { pagesOfCanvas, useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { viewportSize } from "./shortcuts.ts";

/**
 * Goes where a link pressed in the prototype leads: a page of the canvas, at its URL or as it is
 * when it has none, in the variant the prototype is in; a URL; back; or another site, beside it.
 */
export const followLink = (link: string, options?: { push?: boolean }) => {
  const target = linkTargetOf(link);
  const editor = useEditor.getState();
  if (target?.kind === "back") {
    window.history.back();
    return;
  }
  if (target?.kind === "external") {
    window.open(target.url, "_blank", "noopener,noreferrer");
    return;
  }
  if (target?.kind === "url") {
    goTo({ route: target.route }, options);
    return;
  }
  const pages = pagesOfCanvas(editor.canvas);
  const page = pageOfLink(pages, link);
  if (!page) {
    toast.error("This link leads nowhere", {
      description: `${link} is not a page of this canvas. Choose where it goes in the Design inspector.`,
    });
    return;
  }
  // A page without a URL is shown as it is; in a variant, the variant's own drawing of it.
  const drawn =
    page.route === undefined && editor.variant !== null
      ? pages.find(
          (p) =>
            p.variant === editor.variant && basePathOf(p.path) === page.path
        )
      : undefined;
  goTo({ page: (drawn ?? page).id }, options);
};

/**
 * A link pressed on the canvas, where every page is a frame: the frame of the page it leads to
 * is selected and brought into view, rather than changing what the pressed frame shows.
 */
export const focusLink = (link: string) => {
  const target = linkTargetOf(link);
  if (target?.kind === "external") {
    window.open(target.url, "_blank", "noopener,noreferrer");
    return;
  }
  const editor = useEditor.getState();
  const page = pageOfLink(pagesOfCanvas(editor.canvas), link);
  if (page) {
    editor.selectPage(page.id);
    zoomToSelection(viewportSize());
  } else if (target?.kind !== "back") {
    toast.error("This link leads nowhere", {
      description: `${link} is not a page of this canvas.`,
    });
  }
};

/** How the editor names where a link goes, and whether it goes anywhere. */
export const describeLink = (
  pages: readonly Page[],
  link: string
): { broken: boolean; label: string } => {
  const target = linkTargetOf(link);
  const broken = isBrokenLink(pages, link);
  if (target?.kind === "back") {
    return { broken, label: "Back" };
  }
  if (target?.kind === "external") {
    return { broken, label: target.url };
  }
  const page = pageOfLink(pages, link);
  if (page) {
    return {
      broken,
      label: target?.kind === "url" ? `${page.name} · ${link}` : page.name,
    };
  }
  return { broken, label: `${link} (no page)` };
};

/** The link a field writes for a page: its file, which no change of URL breaks. */
export const linkToPage = (page: Page) => page.path;

/** How many nodes of the open canvas lead to the page, by its file or by a URL it serves. */
export const linksToPage = (page: Page): number => {
  const { canvas, docs } = useDocuments.getState();
  if (canvas !== page.canvas) {
    return 0;
  }
  const pages = pagesOfCanvas(canvas);
  const base = basePathOf(page.path);
  let count = 0;
  for (const state of Object.values(docs)) {
    for (const { link } of linksIn(state.root)) {
      if (pageOfLink(pages, link)?.path === base) {
        count += 1;
      }
    }
  }
  return count;
};

/** Every linked node of a document, for the prototype's hotspots. */
export const linkedNodesOf = (doc: string | null): string[] => {
  if (doc === null) {
    return [];
  }
  return linksIn(useDocuments.getState().docs[doc]?.root).map((l) => l.nodeId);
};
