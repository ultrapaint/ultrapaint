/**
 * What is done to a canvas as a whole, and to pages across canvases: from the canvases list of
 * the Pages panel and the context menu alike.
 */
import type { Canvas, Page } from "@ultrapaint/contracts/pages";
import { plural } from "@ultrapaint/shared/text";
import { toast } from "sonner";
import { promptDialog } from "../components/dialogs.tsx";

import { useBoard } from "../state/board.ts";
import { setView, zoomToFit } from "../state/camera.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { type GoTo, goTo, toPageCanvas } from "../state/location.ts";
import { usePagePicks } from "../state/page-picks.ts";
import { reportError, useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";
import { startTask } from "./start-thread.ts";

export const canvasById = (id: string): Canvas | undefined =>
  useProject.getState().canvases.find((c) => c.id === id);

/** Where each canvas was looked at, so going back to one finds it as it was left. */
const views = new Map<string, { x: number; y: number; zoom: number }>();

/**
 * Opens a canvas the way the list does: at the view it was left at, or fitted to what is on it
 * the first time, as Figma keeps a view per page.
 */
const showCanvas = async (id: string, at?: Omit<GoTo, "canvas">) => {
  // The canvas asked for is shown: a board view open gives way to it, its camera put back first.
  toPageCanvas();
  const editor = useEditor.getState();
  if (editor.canvas !== null) {
    views.set(editor.canvas, editor.view);
  }
  usePagePicks.getState().clear();
  await goTo({ ...at, canvas: id });
  const kept = views.get(id);
  if (kept) {
    setView(kept);
  } else {
    zoomToFit();
  }
};

/** Shows canvas `id`; the one shown already, in Design System mode too, goes back to Canvas mode. */
export const openCanvas = (id: string) => {
  if (useEditor.getState().canvas !== id || useBoard.getState().open) {
    showCanvas(id);
  }
};

export const newCanvas = async () => {
  if (!ensureEditable()) {
    return;
  }
  const name = await promptDialog({
    confirmLabel: "Create",
    description:
      "A canvas of its own: its pages, its routes and what is placed on it. The design system and the shared assets are the same in every canvas.",
    placeholder: "Wireframes",
    title: "New canvas",
  });
  if (name === null) {
    return;
  }
  try {
    const canvas = await api().request("canvases.create", {
      name: name.trim(),
    });
    await showCanvas(canvas.id);
  } catch (error) {
    reportError(error);
  }
};

export const renameCanvas = async (canvas: Canvas, to?: string) => {
  if (!ensureEditable()) {
    return;
  }
  const name =
    to ??
    (await promptDialog({
      confirmLabel: "Rename",
      defaultValue: canvas.name,
      description:
        "Only its name changes: its directory, and links into it, stay.",
      title: `Rename ${canvas.name}`,
    }));
  if (name === null || name.trim() === "" || name.trim() === canvas.name) {
    return;
  }
  await api()
    .request("canvases.rename", { id: canvas.id, name: name.trim() })
    .catch(reportError);
};

const copyName = (canvas: Canvas) => `${canvas.name} copy`;

/** A copy of the whole canvas, opened: every page, its layout and its own assets. */
export const duplicateCanvas = async (canvas: Canvas) => {
  if (!ensureEditable()) {
    return null;
  }
  const name = await promptDialog({
    confirmLabel: "Duplicate",
    defaultValue: copyName(canvas),
    description: `A copy of every page of ${canvas.name}, where it sits, to take another way. The two go on apart from then on.`,
    title: `Duplicate ${canvas.name}`,
  });
  if (name === null) {
    return null;
  }
  try {
    const copy = await api().request("canvases.duplicate", {
      id: canvas.id,
      name: name.trim(),
    });
    await showCanvas(copy.id);
    return copy;
  } catch (error) {
    reportError(error);
    return null;
  }
};

/** What an agent is asked to make of a copy, as the dialog offers it. */
const REDRAW_PRESETS = [
  {
    id: "fidelity",
    instruction:
      "Turn these wireframes into finished screens: the design system's components, tokens and text styles, and real copy in place of placeholders.",
    label: "To high fidelity",
  },
  {
    id: "wireframe",
    instruction:
      "Turn these screens into wireframes: greys only, boxes in place of images, no brand colours, placeholder copy where it is not the point. Keep the structure and the routes.",
    label: "To wireframes",
  },
] as const;

/**
 * A copy of the canvas for an agent to change: the canvas is duplicated, then a thread opens
 * with `/redraw` and what to change in its composer, unsent, for the user to add to.
 */
export const duplicateCanvasWithAgent = async (canvas: Canvas) => {
  if (!ensureEditable()) {
    return;
  }
  const name = await promptDialog({
    confirmLabel: "Next",
    defaultValue: copyName(canvas),
    description: `A copy of ${canvas.name} an agent then changes. Name the copy.`,
    title: `Duplicate ${canvas.name} with an agent`,
  });
  if (name === null) {
    return;
  }
  const instruction = await promptDialog({
    confirmLabel: "Duplicate",
    defaultValue: REDRAW_PRESETS[0].instruction,
    description:
      "What the agent changes in every page of the copy. The thread opens with it written, for you to add to before you send it.",
    multiline: true,
    presets: REDRAW_PRESETS.map((p) => ({
      label: p.label,
      value: p.instruction,
    })),
    title: "What should the agent do?",
  });
  if (instruction === null) {
    return;
  }
  try {
    const copy = await api().request("canvases.duplicate", {
      id: canvas.id,
      name: name.trim(),
    });
    await showCanvas(copy.id);
    await startTask({
      _tag: "Redraw",
      canvas: copy.id,
      ...(instruction.trim() && { change: instruction.trim() }),
    });
  } catch (error) {
    reportError(error);
  }
};

export const deleteCanvas = async (canvas: Canvas) => {
  if (!ensureEditable()) {
    return;
  }
  const { canvases } = useProject.getState();
  if (canvases.length <= 1) {
    toast.error("The last canvas cannot be deleted");
    return;
  }
  // Undo brings it back with its pages, its layout and its comments: nothing asks first.
  await api().request("canvases.delete", { id: canvas.id }).catch(reportError);
};

/** Moves a canvas up or down the list by `by` places. */
export const moveCanvas = (canvas: Canvas, by: number) => {
  const order = useProject.getState().canvases.map((c) => c.id);
  const from = order.indexOf(canvas.id);
  const to = Math.min(order.length - 1, Math.max(0, from + by));
  if (from === -1 || from === to) {
    return;
  }
  order.splice(from, 1);
  order.splice(to, 0, canvas.id);
  reorderCanvases(order);
};

/** The list in this order, shown at once and saved. */
export const reorderCanvases = (order: readonly string[]) => {
  if (!ensureEditable()) {
    return;
  }
  const { canvases } = useProject.getState();
  const rank = new Map(order.map((id, i) => [id, i]));
  useProject.setState({
    canvases: [...canvases].sort(
      (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
    ),
  });
  api().request("canvases.reorder", { order }).catch(reportError);
};

/**
 * Pages copied, or moved, into another canvas at the same routes: `canvas` names one, `null`
 * asks for the name of a new one. The editor follows them there.
 */
export const copyPagesTo = async (
  pages: readonly Page[],
  canvas: string | null,
  move: boolean
) => {
  if (!ensureEditable() || pages.length === 0) {
    return;
  }
  let target: { canvas: string } | { name: string };
  if (canvas === null) {
    const name = await promptDialog({
      confirmLabel: move ? "Move" : "Copy",
      description: `A new canvas for ${plural(pages.length, "page")}, at the same routes.`,
      placeholder: "Checkout experiment",
      title: move ? "Move to a new canvas" : "Copy to a new canvas",
    });
    if (name === null) {
      return;
    }
    target = { name: name.trim() };
  } else {
    target = { canvas };
  }
  try {
    const copied = await api().request("pages.copyTo", {
      ids: pages.map((p) => p.id),
      move,
      target,
    });
    usePagePicks.getState().clear();
    const [first] = copied;
    if (first) {
      await showCanvas(first.canvas, {
        page: first.id,
        route: first.route ?? null,
      });
    }
  } catch (error) {
    reportError(error);
  }
};

/**
 * The page drawn again for a variant: the whole click-through can then be seen in it, with the
 * pages it does not redraw taken from the base.
 */
export const newVariant = async (page: Page, variant?: string) => {
  if (!ensureEditable()) {
    return;
  }
  const known = canvasById(page.canvas)?.variants ?? [];
  const name =
    variant ??
    (await promptDialog({
      confirmLabel: "Create",
      description:
        known.length > 0
          ? `The page again, to draw another way; the canvas's other pages stay as they are in it. Variants so far: ${known.join(", ")}.`
          : "The page again, to draw another way; the canvas's other pages stay as they are in it, so the prototype clicks through the whole variant.",
      placeholder: "bold",
      title: `New variant of ${page.name}`,
    }));
  if (name === null) {
    return;
  }
  try {
    const created = await api().request("pages.createVariant", {
      id: page.id,
      variant: name.trim(),
    });
    goTo({ variant: created.variant ?? null });
    goTo({ page: created.id }, { push: false });
  } catch (error) {
    reportError(error);
  }
};
