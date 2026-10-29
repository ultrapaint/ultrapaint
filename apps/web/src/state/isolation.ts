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
 */
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import { componentDocOf, variantKey } from "@ultrapaint/contracts/components";
import type { InstanceNode } from "@ultrapaint/contracts/document";
import type { RenderRequest } from "@ultrapaint/framework-api/browser";
import { useMemo } from "react";
import { create } from "zustand";
import { appComponentOf, useComponents } from "./components.ts";
import { editFrameAs, useDocuments } from "./documents.ts";
import { useEditor } from "./editor.ts";

/** A choice's member edits land on. */
export interface VariantEdited {
  readonly member: string;
  readonly property: string;
}

export interface Isolation {
  readonly component: string;
  /** The frame the instance is drawn in. */
  readonly frame: string;
  /** The page's instance edited in place. */
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
 * Edits an app component's instance in place: its tree is selected, and what is done in the
 * frame is done to it. Whether it is one: false for any other node.
 */
export const isolate = (frame: string, node: InstanceNode): boolean => {
  const file = node.from === APP_FROM ? fileOf(node.component) : undefined;
  if (!file) {
    return false;
  }
  const isolated: Isolation = {
    component: node.component,
    frame,
    instance: node.id,
    variant: null,
  };
  useIsolation.setState({ isolated });
  editIn(isolated);
  showTree();
  useEditor.getState().select({ frame, nodeId: file.tree.id });
  return true;
};

/** Back to the page: the instance edited is selected again. */
export const leaveIsolation = () => {
  const { isolated } = useIsolation.getState();
  if (!isolated) {
    return;
  }
  useIsolation.setState({ isolated: null });
  editIn(null);
  useEditor
    .getState()
    .select({ frame: isolated.frame, nodeId: isolated.instance });
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

// Another canvas, or the prototype, leaves the component.
useEditor.subscribe((now, before) => {
  if (now.canvas !== before.canvas || now.workspace !== before.workspace) {
    leaveIsolation();
  }
});

// A file gone leaves the component; a canvas read again puts its tree back.
useComponents.subscribe(showTree);
useDocuments.subscribe((now, before) => {
  if (now.docs !== before.docs) {
    showTree();
  }
});

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
