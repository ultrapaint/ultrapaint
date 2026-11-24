/**
 * An app component edited in place (ADR 0041): one of its instances on a page is isolated, the
 * rest of the page dimmed and not selectable, and the selection and every edit in that frame go
 * to the component's tree, a document of its own (`component:<Name>`), so every instance follows
 * as it changes. Edits land on the component's own fields, or on one member of one of its choices
 * (`size=lg`), which records an override as a view records a breakpoint's. It is entered only when
 * asked (ADR 0114), one level in from a component already edited there; Escape, Done or a click
 * outside goes up one level, the breadcrumb to any; a click past a slot's node on what the slot
 * holds goes up to the level that holds it (ADR 0123). Its nodes are outlined in the component
 * colour, and the inspector says what is edited, at the top of its Design tab (ADR 0120).
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
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import {
  LAYER_SEPARATOR,
  layerIdOf,
  layerPath,
} from "@ultrapaint/design-document/instance-layers";
import type { RenderRequest } from "@ultrapaint/preview-core/preview";
import { useMemo } from "react";
import { create } from "zustand";
import { appComponentOf, useComponents } from "./components.ts";
import {
  drawnRootOf,
  editFrameAs,
  rootOfFrame,
  useDocuments,
} from "./documents.ts";
import { useEditor } from "./editor.ts";
import { frameRefOf } from "./frame-ref.ts";
import { usePanels } from "./panels.ts";
import { select } from "./selection.ts";
import { unlockedChain } from "./tree.ts";

/** A choice's member edits land on. */
interface VariantEdited {
  readonly member: string;
  readonly property: string;
}

interface Isolation {
  /** The level it was entered from: the component edited around it, null for the page or board. */
  readonly around: Isolation | null;
  readonly component: string;
  /**
   * The instance edited, as the frame draws it: the page's own, or the way to one inside it
   * (`shell/nav`, ADR 0114), which the frame is told to draw edited in place.
   */
  readonly drawn: string;
  /** The frame the instance is drawn in. */
  readonly frame: string;
  /** The instance as the level it was entered from has it, which leaving selects again. */
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
 * `variant` (the component's own fields when none). An instance of the component already edited
 * in the frame is edited one level in, which leaving goes back to (ADR 0114). Whether it is one:
 * false for any other node.
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
  const was = useIsolation.getState().isolated;
  const around = was?.frame === frame ? was : null;
  const isolated: Isolation = {
    around,
    component: node.component,
    drawn: around ? layerIdOf(around.drawn, node.id) : node.id,
    frame,
    instance: node.id,
    variant,
  };
  useIsolation.setState({ isolated });
  editIn(isolated);
  showTree();
  // The inspector's Design tab says what is edited and is the way out (ADR 0120): put away, or
  // on the Code tab, it comes back on it.
  useEditor.getState().setRightTab("design");
  usePanels.getState().setHidden({ right: false });
  if (selects) {
    select({ frame, nodeId: file.tree.id });
  }
  return true;
};

/**
 * The names of the levels edited in place, outermost first: the component of each, what the
 * breadcrumb shows after the page or the board.
 */
export const levelsOf = (isolated: Isolation | null): string[] =>
  isolated ? [...levelsOf(isolated.around), isolated.component] : [];

/**
 * Up one level: to the component it was entered from, its instance selected there, or back to the
 * page with the page's instance selected (a board's selects nothing). Whether there was a
 * component edited in place to leave.
 */
export const leaveIsolation = (): boolean => {
  const { isolated } = useIsolation.getState();
  if (!isolated) {
    return false;
  }
  const { around } = isolated;
  useIsolation.setState({ isolated: around });
  editIn(around);
  showTree();
  select(
    !around && frameRefOf(isolated.frame).kind === "board"
      ? null
      : { frame: isolated.frame, nodeId: isolated.instance }
  );
  return true;
};

/**
 * Up to the level what a slot of the component edited holds belongs to, and selects it there
 * (ADR 0123). `held` is what the slot holds under a point, outermost first, as the frame draws it:
 * the page's own nodes, or a level around's layers (`shell/x`, which is `x` at that level). The
 * outermost of them is selected, the innermost when `innermost`, a locked one never; with all
 * locked, the instance the level was left through is. Whether a component was edited to leave.
 */
export const leaveForHeld = (
  held: readonly string[],
  innermost: boolean
): boolean => {
  const [first] = held;
  const start = useIsolation.getState().isolated;
  if (!start || first === undefined) {
    return false;
  }
  while (leaveIsolation()) {
    const level = useIsolation.getState().isolated;
    const prefix = level ? `${level.drawn}${LAYER_SEPARATOR}` : "";
    if (first.startsWith(prefix)) {
      const root = rootOfFrame(
        useDocuments.getState().docs,
        useEditor.getState().canvas,
        start.frame
      );
      const ids = unlockedChain(
        held.map((drawn) => drawn.slice(prefix.length)),
        root
      );
      const id = innermost ? ids.at(-1) : ids[0];
      if (id !== undefined) {
        select({ frame: start.frame, nodeId: id });
      }
      return true;
    }
  }
  return true;
};

/** Back to the level the breadcrumb names: 0 the page (or board), 1 the outermost component. */
export const leaveTo = (level: number) => {
  while (levelsOf(useIsolation.getState().isolated).length > level) {
    if (!leaveIsolation()) {
      return;
    }
  }
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
      // Every level: what was edited in place is the page's no more.
      if (now.canvas !== before.canvas || now.workspace !== before.workspace) {
        leaveTo(0);
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

/**
 * What a board's frame draws, as far as the levels edited on it need: the instance of the
 * component its outermost level edits, at that level's variant. Null on a page's frame.
 */
const boardRootOf = (isolated: Isolation): DesignNode | null => {
  let outermost = isolated;
  while (outermost.around) {
    outermost = outermost.around;
  }
  if (frameRefOf(outermost.frame).kind !== "board") {
    return null;
  }
  const { variant } = outermost;
  return {
    children: [
      {
        component: outermost.component,
        from: APP_FROM,
        id: outermost.drawn,
        ...(variant && { props: { [variant.property]: variant.member } }),
        type: "instance",
      },
    ],
    id: "board",
    type: "column",
  };
};

/**
 * The variant each level around the one edited is edited at, by its instance as the frame draws
 * it: none when no level around is edited at one.
 */
const aroundProps = (around: Isolation | null) => {
  const props: Record<string, Record<string, string>> = {};
  for (let level = around; level; level = level.around) {
    if (level.variant) {
      props[level.drawn] = { [level.variant.property]: level.variant.member };
    }
  }
  return Object.keys(props).length > 0 ? { around: props } : {};
};

/** Whether a main component is edited in place in `frame`: its nodes are a component's (ADR 0120). */
export const useEditsMain = (frame: string): boolean =>
  useIsolation((s) => s.isolated?.frame === frame);

/** What a frame is told of the instance edited in it: the one, drawn at the variant edited. */
export const useIsolatedRequest = (frame: string): RenderRequest["isolate"] => {
  const isolated = useIsolation((s) =>
    s.isolated?.frame === frame ? s.isolated : null
  );
  const canvas = useEditor((s) => s.canvas);
  const components = useComponents((s) => s.components);
  // The instances the edited one is drawn inside, as the document resolves the way to it: said
  // as one text, so the request is made again only when they change.
  const enclosing = useDocuments((s) => {
    if (!isolated) {
      return "";
    }
    const path = layerPath(
      drawnRootOf(s.docs, canvas, frame) ?? boardRootOf(isolated),
      isolated.drawn,
      (name) => appComponentOf(components, name)
    );
    return (path ?? [])
      .slice(0, -1)
      .filter((n) => n.type === "instance")
      .map((n) => n.id)
      .join("\n");
  });
  return useMemo(
    () =>
      isolated
        ? {
            ...aroundProps(isolated.around),
            ...(enclosing !== "" && { enclosing: enclosing.split("\n") }),
            instance: isolated.drawn,
            ...(isolated.variant && {
              props: { [isolated.variant.property]: isolated.variant.member },
            }),
          }
        : undefined,
    [enclosing, isolated]
  );
};
