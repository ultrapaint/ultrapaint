/**
 * What is done to a page as a whole, from the Pages panel, the layers, the inspector, the frame
 * on the canvas and the context menu alike.
 */
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import { confirmDialog, promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { reportError, useProject } from "../state/project.ts";
import { viewportSize } from "./shortcuts.ts";
import { startCommand } from "./start-thread.ts";

export const pageById = (id: string): Page | undefined =>
  useProject.getState().pages.find((p) => p.id === id);

/** Goes to the page, unless it is already on screen with the parameters it was reached with. */
export const goToPage = (page: Page) => {
  const editor = useEditor.getState();
  if (editor.activePage !== page.id) {
    editor.navigate(page.route);
  }
};

export const zoomToPage = (page: Page) => {
  const editor = useEditor.getState();
  editor.selectPage(page.id);
  editor.zoomToSelection(viewportSize());
};

export const setPagePreset = (page: Page, preset: ViewportPreset) =>
  useEditor.getState().setPreset(page.id, preset);

/** Serves the page at another route; the router follows it there. */
export const moveRoute = async (page: Page, to: string) => {
  if (to === page.route) {
    return;
  }
  try {
    const moved = await api().request("pages.rename", {
      id: page.id,
      route: to,
    });
    useEditor.getState().navigate(moved.route, { push: false });
  } catch (error) {
    reportError(error);
  }
};

export const renamePage = async (page: Page) => {
  const to = await promptDialog({
    confirmLabel: "Change",
    defaultValue: page.route,
    description: "The page file moves to match the route.",
    title: `Change the route of ${page.name}`,
  });
  if (to !== null) {
    await moveRoute(page, to.trim());
  }
};

export const duplicatePage = (page: Page) =>
  api().request("pages.duplicate", { id: page.id }).catch(reportError);

export const deletePage = async (page: Page) => {
  const ok = await confirmDialog({
    confirmLabel: "Delete",
    description: "The page file is removed from the designs directory.",
    destructive: true,
    title: `Delete ${page.route}?`,
  });
  if (ok) {
    api().request("pages.delete", { id: page.id }).catch(reportError);
  }
};

export const implementPage = (page: Page) =>
  startCommand(`/implement ${page.route}`);

/** The template a page starts from when none is picked, as the New page form has it. */
const DEFAULT_TEMPLATE = "centered";

const TRAILING_SLASH_RE = /\/$/;

/** Asks for a route and makes a page there, in the open space. */
export const newPage = async (under?: string) => {
  const route = await promptDialog({
    confirmLabel: "Create",
    defaultValue: under ? `${under.replace(TRAILING_SLASH_RE, "")}/` : "/",
    placeholder: "/settings/billing",
    title: "New page",
  });
  if (route === null) {
    return;
  }
  try {
    const page = await api().request("pages.create", {
      route: route.trim(),
      space: useEditor.getState().space ?? "",
      template: DEFAULT_TEMPLATE,
    });
    useEditor.getState().navigate(page.route);
  } catch (error) {
    reportError(error);
  }
};
