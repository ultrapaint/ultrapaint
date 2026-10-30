/**
 * An app component edited in place (ADR 0041): one of its instances on a page is isolated, the
 * rest of the page dimmed and not selectable, and the selection and every edit in that frame go
 * to the component's tree, a document of its own (`component:<Name>`), so every instance follows
 * as it changes. Edits land on the component's own fields, or on one member of one of its choices
 * (`size=lg`), which records an override as a view records a breakpoint's. Escape, or Done, leaves.
 *
 * The tree edited is the document's, which the server publishes whenever the component's file
 * changes, whoever changes it (ADR 0042): its file only starts it, so an edit is never shown
 * undone while the components' news is on its way.
 *
 * On an app component's board (ADR 0045) its tree is edited in the same way on the board of one
 * of its variants, the edits landing on that variant's member; leaving selects nothing, as a
 * board's instance is no page's.
 */
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import { componentDocOf, variantKey } from "@ultrapaint/contracts/components";
import type { InstanceNode } from "@ultrapaint/contracts/document";
import type { RenderRequest } from "@ultrapaint/preview-core/preview";
import { useMemo } from "react";
import { create } from "zustand";
import { appComponentOf, useComponents } from "./components.ts";
import { editFrameAs, useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";
import { frameRefOf } from "./frame-ref.ts";
import { select } from "./selection.ts";

/** A choice's member edits land on. */
export interface VariantEdited {
  readonly member: string;
  readonly property: string;
}

export interface Isolation {
  readonly component: string;
  /**
   * The page's instance it was entered from: the instance edited, or, for an app component edited
   * inside another's tree, the outermost one's, which leaving selects.
   */
  readonly entered: string;
  /** The frame the instance is drawn in. */
  readonly frame: string;
  /** The instance edited in place: the page's, or one of the tree of the component edited around it. */
  readonly instance: string;
  /** The member edits land on; null for the component's own fields. */
  readonly variant: VariantEdited | null;
}

export const useIsolation = create<{ isolated: Isolation | null }>(() => ({
  isolated: null,
}));

/** The component's file, while it is an app component's. */
const fileOf = (name: string) => {
  const file = appComponentOf(useComponents.getState().components, name);
  return file?.origin === "app" ? file : undefined;
};

/** The component's tree in the documents, started from its file when they do not have it yet. */
const showTree = () => {
  const { isolated } = useIsolation.getState();
  if (!isolated) {
    return;
  }
  const file = fileOf(isolated.component);
  if (!file) {
    // Its file went (an undo, an agent): nothing is left to edit.
    leaveIsolation();
    return;
  }
  const doc = componentDocOf(isolated.component);
  if (!useDocuments.getState().docs[doc]) {
    useDocuments.getState().put({ doc, hash: "", root: file.tree });
  }
};

/** Where a frame's edits go while a component is edited in it. */
const editIn = (isolated: Isolation | null) =>
  editFrameAs(
    isolated && {
      at: isolated.variant
        ? variantKey(isolated.variant.property, isolated.variant.member)
        : null,
      doc: componentDocOf(isolated.component),
      frame: isolated.frame,
    }
  );

/**
 * Edits an app component's instance in place: its tree is selected (unless `select` is false,
 * what is selected being the caller's), what is done in the frame is done to it, and lands on
 * `variant` (the component's own fields when none). Whether it is one: false for any other node.
 */
export const isolate = (
  frame: string,
  node: InstanceNode,
  {
    select: selects = true,
    variant = null,
  }: { readonly select?: boolean; readonly variant?: VariantEdited | null } = {}
): boolean => {
  const file = node.from === APP_FROM ? fileOf(node.component) : undefined;
  if (!file) {
    return false;
  }
  const around = useIsolation.getState().isolated;
  const isolated: Isolation = {
    component: node.component,
    entered: around?.frame === frame ? around.entered : node.id,
    frame,
    instance: node.id,
    variant,
  };
  useIsolation.setState({ isolated });
  editIn(isolated);
  showTree();
  if (selects) {
    select({ frame, nodeId: file.tree.id });
  }
  return true;
};

/** Back to the page: the page's instance it was entered from is selected again. */
export const leaveIsolation = () => {
  const { isolated } = useIsolation.getState();
  if (!isolated) {
    return;
  }
  useIsolation.setState({ isolated: null });
  editIn(null);
  select(
    frameRefOf(isolated.frame).kind === "board"
      ? null
      : { frame: isolated.frame, nodeId: isolated.entered }
  );
};

/** The member edits land on from now on; null for the component's own fields. */
export const editVariant = (variant: VariantEdited | null) => {
  const { isolated } = useIsolation.getState();
  if (!isolated) {
    return;
  }
  const next = { ...isolated, variant };
  useIsolation.setState({ isolated: next });
  editIn(next);
};

/**
 * Starts following what an edit in place depends on: another canvas, or the prototype, leaves the
 * component; its file gone leaves it too; a canvas read again puts its tree back. The app starts
 * it, as a test that needs it does; the answer stops it.
 */
export const startIsolation = (): (() => void) => {
  const offs = [
    useEditor.subscribe((now, before) => {
      if (now.canvas !== before.canvas || now.workspace !== before.workspace) {
        leaveIsolation();
      }
    }),
    useComponents.subscribe(showTree),
    useDocuments.subscribe((now, before) => {
      if (now.docs !== before.docs) {
        showTree();
      }
    }),
  ];
  return () => {
    for (const off of offs) {
      off();
    }
  };
};

/** What a frame is told of the instance edited in it: the one, drawn at the variant edited. */
export const useIsolatedRequest = (frame: string): RenderRequest["isolate"] => {
  const isolated = useIsolation((s) =>
    s.isolated?.frame === frame ? s.isolated : null
  );
  return useMemo(
    () =>
      isolated
        ? {
            instance: isolated.instance,
            ...(isolated.variant && {
              props: { [isolated.variant.property]: isolated.variant.member },
            }),
          }
        : undefined,
    [isolated]
  );
};
