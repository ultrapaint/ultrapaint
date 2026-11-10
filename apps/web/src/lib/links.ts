/**
 * Links as the editor uses them: followed when pressed in the prototype, and named in the fields
 * that set them. The forms a link takes are in `@ultrapaint/shared/link`.
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
import { useDocuments } from "../state/documents.ts";
import { pagesOfCanvas, useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import {
  basePageOf,
  DRAFT_HINT,
  editPageUrl,
  isDraft,
} from "./page-actions.ts";
import { reveal } from "./reveal.ts";

/**
 * Goes where a link pressed in the prototype leads: a page of the canvas, at its URL or as its
 * state, in the variant the prototype is in; a URL; back; or another site, beside it. A draft has
 * no route, and the prototype never shows it (ADR 0075): the link says so, and offers to give it
 * one.
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
  if (isDraft(page, pages)) {
    const draft = basePageOf(page, pages);
    toast(`${draft.name} is a draft`, {
      action: {
        label: "Give it a route",
        onClick: () => {
          editPageUrl(draft);
        },
      },
      description: DRAFT_HINT,
    });
    return;
  }
  // A state serves no URL of its own; in a variant, the variant's own drawing of it.
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
    reveal({ page: page.id });
  } else if (target?.kind !== "back") {
    toast.error("This link leads nowhere", {
      description: `${link} is not a page of this canvas.`,
    });
  }
};

/**
 * How the editor names where a link goes, whether it goes anywhere, and the draft it leads to,
 * which the prototype does not show until it has a route (ADR 0075).
 */
export const describeLink = (
  pages: readonly Page[],
  link: string
): { broken: boolean; draft: Page | null; label: string } => {
  const target = linkTargetOf(link);
  const broken = isBrokenLink(pages, link);
  const led = pageOfLink(pages, link);
  const draft = led && isDraft(led, pages) ? basePageOf(led, pages) : null;
  if (target?.kind === "back") {
    return { broken, draft, label: "Back" };
  }
  if (target?.kind === "external") {
    return { broken, draft, label: target.url };
  }
  if (led) {
    return {
      broken,
      draft,
      label: target?.kind === "url" ? `${led.name} · ${link}` : led.name,
    };
  }
  return { broken, draft, label: `${link} (no page)` };
};

/** The link a field writes for a page: its file, which no change of URL breaks. */
export const linkToPage = (page: Page) => page.path;

/** Every linked node of a document, for the prototype's hotspots. */
export const linkedNodesOf = (doc: string | null): string[] => {
  if (doc === null) {
    return [];
  }
  return linksIn(useDocuments.getState().docs[doc]?.root).map((l) => l.nodeId);
};
