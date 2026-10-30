/**
 * What is done to a page as a whole, from the Pages panel, the layers, the inspector, the frame
 * on the canvas and the context menu alike.
 */
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import { slugOf } from "@ultrapaint/shared/path";
import { toast } from "sonner";
import { confirmDialog, promptDialog } from "../components/dialogs.tsx";
import { leaveBoard } from "../state/board.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { setPreset } from "../state/page-layout.ts";
import { reportError, useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";
import { linksToPage } from "./links.ts";
import { reveal } from "./reveal.ts";
import { startTask } from "./start-thread.ts";

/** What the warning on a page without a URL says, wherever it is shown. */
export const NO_URL_HINT =
  "No URL: no link and no step of the prototype can reach this page. Give it one to put it in the click-through.";

export const pageById = (id: string): Page | undefined =>
  useProject.getState().pages.find((p) => p.id === id);

/** Goes to the page, unless it is already on screen with the parameters it was reached with. */
export const goToPage = (page: Page) => {
  // The page is on the page canvas: a board view open gives way to it.
  leaveBoard();
  return goTo({ page: page.id });
};

/** Brings the page's frame into view on the canvas, selected. */
export const zoomToPage = (page: Page) => reveal({ page: page.id });

export const setPagePreset = (page: Page, preset: ViewportPreset) =>
  setPreset(page.id, preset);

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
      goTo({ page: changed.id }, { push: false });
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
        : "Links to the page keep leading to it: those that named the old URL name the page itself afterwards. Leave it empty for no URL.",
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
      goTo({ page: renamed.id }, { push: false });
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

/** What deleting a page takes with it: its file, and where the links to it lead. */
const deleteDescription = (page: Page) => {
  const links = linksToPage(page);
  const file = "The page file is removed from the designs directory.";
  if (links === 0) {
    return file;
  }
  return `${file} ${links === 1 ? "One link leads" : `${links} links lead`} to it, and will lead nowhere.`;
};

export const deletePage = async (page: Page) => {
  if (!ensureEditable()) {
    return;
  }
  const ok = await confirmDialog({
    confirmLabel: "Delete",
    description: deleteDescription(page),
    destructive: true,
    title: `Delete ${page.name}?`,
  });
  if (ok) {
    api().request("pages.delete", { id: page.id }).catch(reportError);
  }
};

/**
 * A page is named by its URL, in its canvas, when it has one, by its id otherwise: the task's
 * command reads `/implement /settings`, or `marketing:/pricing` in another canvas than the root.
 */
export const implementPage = (page: Page) =>
  startTask(
    page.route === undefined
      ? { _tag: "Implement", target: page.id }
      : { _tag: "Implement", canvas: page.canvas, target: page.route }
  );

/** The template a page starts from when none is picked, as the New page form has it. */
const DEFAULT_TEMPLATE = "centered";

/**
 * Makes a page in the open canvas and goes to it. The URL is optional: a page is drawn first,
 * and given one when the prototype should reach it.
 */
const createPage = async (input: {
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
    goTo({ page: page.id });
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

/**
 * The page drawn again in a state (ADR 0030): empty, loading, an error, a dialog open. A link
 * opens it; implementing the page implements it as a state of the same screen.
 */
export const newState = async (page: Page, state?: string) => {
  if (!ensureEditable()) {
    return;
  }
  const name =
    state ??
    (await promptDialog({
      confirmLabel: "Create",
      description:
        "The page again in another state of the same screen: empty, loading, an error, a dialog open. A link can open it, and implementing the page implements it as that state.",
      placeholder: "empty",
      title: `New state of ${page.name}`,
    }));
  if (name === null || name.trim() === "") {
    return;
  }
  try {
    const created = await api().request("pages.createState", {
      id: page.id,
      state: name.trim(),
    });
    goTo({ page: created.id }, { push: false });
  } catch (error) {
    reportError(error);
  }
};

/** Marks a page ready to implement, or not (ADR 0030). */
export const setPageReady = async (page: Page, ready: boolean) => {
  try {
    await api().request("implementation.setReady", { ready, target: page.id });
    toast.success(
      ready
        ? `${page.name} is ready to implement.`
        : `${page.name} is a draft again.`
    );
  } catch (error) {
    reportError(error);
  }
};

/** Marks several pages ready to implement at once; one implemented already is left as it is. */
export const setPagesReady = async (ids: readonly string[]) => {
  try {
    const { changed } = await api().request("implementation.setReadyAll", {
      ready: true,
      targets: [...ids],
    });
    toast.success(
      changed === 0
        ? "They are implemented already."
        : `${changed} page${changed === 1 ? " is" : "s are"} ready to implement.`
    );
  } catch (error) {
    reportError(error);
  }
};

/**
 * Has an agent find the code that already implements pages and link them (ADR 0030), without
 * changing the code: how a project built before it came into the editor brings its pages in.
 * The targets are canvases (`""` for the designs directory's own) or pages, by id.
 */
export const adoptPages = (targets: readonly string[]) =>
  startTask({ _tag: "Adopt", targets });

/**
 * Marks a design implemented by the files the user names, as it is now (ADR 0030): the next
 * implementation is told what changed since.
 */
export const markImplemented = async (
  target: string,
  name: string,
  files: readonly string[] = []
) => {
  const given = await promptDialog({
    confirmLabel: "Mark implemented",
    defaultValue: files.join(", "),
    description:
      "The files of the repository that implement it, separated by commas: src/routes/orders.tsx. The editor then tells you when either side changes.",
    placeholder: "src/routes/orders.tsx",
    title: `${name} is implemented by`,
  });
  if (given === null) {
    return;
  }
  const named = given
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (named.length === 0) {
    return;
  }
  try {
    await api().request("implementation.mark", { files: named, target });
    toast.success(`${name} is marked implemented.`);
  } catch (error) {
    reportError(error);
  }
};

/** Takes a design's link to its code off: it is a draft again. */
export const unlinkImplementation = async (target: string, name: string) => {
  const ok = await confirmDialog({
    confirmLabel: "Unlink",
    description: `What implements ${name} is forgotten, and how it was then: the next implementation starts from the design as a whole.`,
    title: `Unlink ${name} from its code?`,
  });
  if (!ok) {
    return;
  }
  try {
    await api().request("implementation.unbind", { target });
  } catch (error) {
    reportError(error);
  }
};
