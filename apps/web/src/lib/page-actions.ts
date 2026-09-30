/**
 * What is done to a page as a whole, from the Pages panel, the layers, the inspector, the frame
 * on the canvas and the context menu alike.
 */
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import { slugOf } from "@ultrapaint/shared/path";
import { confirmDialog, promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";
import { viewportSize } from "./shortcuts.ts";
import { startCommand } from "./start-thread.ts";

/** What the warning on a page without a URL says, wherever it is shown. */
export const NO_URL_HINT =
  "No URL: no link and no step of the prototype can reach this page. Give it one to put it in the click-through.";

export const pageById = (id: string): Page | undefined =>
  useProject.getState().pages.find((p) => p.id === id);

/** Goes to the page, unless it is already on screen with the parameters it was reached with. */
export const goToPage = (page: Page) => useEditor.getState().openPage(page.id);

export const zoomToPage = (page: Page) => {
  const editor = useEditor.getState();
  editor.selectPage(page.id);
  editor.zoomToSelection(viewportSize());
};

export const setPagePreset = (page: Page, preset: ViewportPreset) =>
  useEditor.getState().setPreset(page.id, preset);

/** What a URL is typed as: a slash in front, and nothing at all for none. */
const typedUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

/**
 * Serves the page at another URL, or at none. The editor stays on the page: when it was showing
 * it, it follows it to its new URL.
 */
export const setPageUrl = async (page: Page, value: string) => {
  const route = typedUrl(value);
  if (route === (page.route ?? null) || !ensureEditable()) {
    return;
  }
  try {
    const changed = await api().request("pages.setRoute", {
      id: page.id,
      route,
    });
    const editor = useEditor.getState();
    if (editor.activePage === page.id) {
      await useProject.getState().load();
      editor.openPage(changed.id, { push: false });
    }
  } catch (error) {
    reportError(error);
  }
};

/** Asks for the URL the page serves in the prototype; left empty, it serves none. */
export const editPageUrl = async (page: Page) => {
  if (!ensureEditable()) {
    return;
  }
  const to = await promptDialog({
    confirmLabel: page.route === undefined ? "Set URL" : "Change",
    defaultValue: page.route ?? `/${slugOf(page.name)}`,
    description:
      page.route === undefined
        ? "Where the prototype serves the page, and where a link leads to reach it."
        : "Links name the URL: those to the old one lead nowhere afterwards. Leave it empty for no URL.",
    placeholder: "/settings/billing",
    title:
      page.route === undefined
        ? `Set a URL for ${page.name}`
        : `Change the URL of ${page.name}`,
  });
  if (to !== null) {
    await setPageUrl(page, to);
  }
};

/** Renames the page; its file follows the name, and its URL and every link to it stay. */
export const renamePageTo = async (page: Page, name: string) => {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === page.name || !ensureEditable()) {
    return;
  }
  try {
    const renamed = await api().request("pages.rename", {
      id: page.id,
      name: trimmed,
    });
    const editor = useEditor.getState();
    if (editor.activePage === page.id && renamed.route === undefined) {
      await useProject.getState().load();
      editor.openPage(renamed.id, { push: false });
    }
  } catch (error) {
    reportError(error);
  }
};

export const renamePage = async (page: Page) => {
  if (!ensureEditable()) {
    return;
  }
  const to = await promptDialog({
    confirmLabel: "Rename",
    defaultValue: page.name,
    description:
      "Its file takes the new name; its URL and the links to it stay.",
    title: `Rename ${page.name}`,
  });
  if (to !== null) {
    await renamePageTo(page, to);
  }
};

export const duplicatePage = (page: Page) => {
  if (ensureEditable()) {
    api().request("pages.duplicate", { id: page.id }).catch(reportError);
  }
};

export const deletePage = async (page: Page) => {
  if (!ensureEditable()) {
    return;
  }
  const ok = await confirmDialog({
    confirmLabel: "Delete",
    description: "The page file is removed from the designs directory.",
    destructive: true,
    title: `Delete ${page.name}?`,
  });
  if (ok) {
    api().request("pages.delete", { id: page.id }).catch(reportError);
  }
};

/** A page is named by its URL for the command when it has one, by its file otherwise. */
export const implementPage = (page: Page) =>
  startCommand(`/implement ${page.route ?? page.id}`);

/** The template a page starts from when none is picked, as the New page form has it. */
export const DEFAULT_TEMPLATE = "centered";

/**
 * Makes a page in the open canvas and goes to it. The URL is optional: a page is drawn first,
 * and given one when the prototype should reach it.
 */
export const createPage = async (input: {
  name: string;
  route?: string;
  template?: string;
}) => {
  if (!ensureEditable()) {
    return null;
  }
  const route = typedUrl(input.route ?? "");
  try {
    const page = await api().request("pages.create", {
      canvas: useEditor.getState().canvas ?? "",
      name: input.name.trim(),
      template: input.template ?? DEFAULT_TEMPLATE,
      ...(route !== null && { route }),
    });
    await useProject.getState().load();
    useEditor.getState().openPage(page.id);
    return page;
  } catch (error) {
    reportError(error);
    return null;
  }
};

/** Asks for a name and makes a page of it, in the open canvas. */
export const newPage = async () => {
  if (!ensureEditable()) {
    return;
  }
  const name = await promptDialog({
    confirmLabel: "Create",
    description:
      "Give it a URL in the Pages panel of the prototype when a link should lead to it.",
    placeholder: "Billing settings",
    title: "New page",
  });
  if (name !== null && name.trim() !== "") {
    await createPage({ name });
  }
};
