import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import type { HostError, HostMessage } from "@ultrapaint/contracts/preview";
import {
  childrenOf,
  isContainer,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { PREVIEW_PROTOCOL } from "@ultrapaint/framework-api/protocol";
import { cn } from "cn";
import { AlertTriangle } from "lucide-react";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { focusLink } from "../lib/links.ts";
import {
  kindColor,
  kindHoverColor,
  selectionKindOf,
} from "../lib/selection-kind.ts";
import { useComments } from "../state/comments.ts";
import { holdMenu, openMenuAt, showMenu } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import {
  applyOps,
  docOfFrame,
  isNodeFrame,
  nodeIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import {
  type Selection,
  selectForMenu,
  useEditor,
  type Workspace,
} from "../state/editor.ts";
import { useInstances } from "../state/instances.ts";
import { previewUrl, useProject } from "../state/project.ts";
import { stepInto } from "../state/tree.ts";
import { FramePresence } from "./agent-presence.tsx";
import { AgentWorkOverlay, useFrameWork, useSkeletons } from "./agent-work.tsx";
import { bridgeFor, removeBridge } from "./bridge.ts";
import { commentCursor, FrameComments } from "./comments.tsx";
import { beginDrag, type Dragged, endDrag, moveDrag, useDrag } from "./drag.ts";
import {
  ElementToolbar,
  GroupToolbar,
  TAG_HEIGHT,
} from "./element-toolbar.tsx";
import { hitUnlocked } from "./hit-test.ts";
import { PageToolbar } from "./page-toolbar.tsx";
import { SelectionTag } from "./selection-tag.tsx";

const formatHostError = (error: HostError) => {
  if (!error.file) {
    return error.message;
  }
  const line = error.line ? `:${error.line}` : "";
  return `${error.message}\n${error.file}${line}`;
};

/** Writes an inline text edit from the preview back into the document. */
const commitText = (frame: string, nodeId: string, text: string) => {
  const { canvas } = useEditor.getState();
  applyOps(
    docOfFrame(frame, canvas),
    [{ id: nodeId, op: "update", set: { text } }],
    "Edit text"
  );
};

const isInteractive = (s: { mode: string; spacePan: boolean }) =>
  s.mode === "interact" && !s.spacePan;

/** How far the pointer travels before a press becomes a drag, in screen pixels. */
const DRAG_THRESHOLD = 4;

/** Tells a preview what its frame shows now: the document as it is, in the design system. */
/** What a frame is called over its top edge: the page, in its variant, or the node on the canvas. */
const frameName = (page: Page | undefined, root: DesignNode | null) => {
  if (page) {
    return page.variant === undefined
      ? page.name
      : `${page.name} · ${page.variant}`;
  }
  return root ? nodeLabel(root) : "";
};

const renderFrame = (
  frameId: string,
  kind: "page" | "node",
  size?: { height: number; width: number }
) => {
  const { canvas } = useEditor.getState();
  const state = isNodeFrame(frameId)
    ? null
    : useDocuments.getState().docs[frameId];
  const root = rootOfFrame(useDocuments.getState().docs, canvas, frameId);
  const { designSystem } = useDesignSystem.getState();
  bridgeFor(frameId).render({
    designSystem,
    mode: kind === "page" ? "page" : "fit",
    root: root && size ? ({ ...root, ...size } as DesignNode) : root,
    ...(state?.problem !== undefined && {
      message: `This page cannot be read: ${state.problem}`,
    }),
  });
};

/**
 * Draws a node on the canvas at the size it is being resized to, which the document has only once
 * the pointer lets go; without a size, at the document's.
 */
export const drawResized = (
  frameId: string,
  size?: { height: number; width: number }
) => {
  if (bridgeFor(frameId).ready) {
    renderFrame(frameId, "node", size);
  }
};

/** A frame's corner, which resizing it drags while the opposite one stays put. */
export type Corner = "nw" | "ne" | "sw" | "se";

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

export interface FrameBox {
  height: number;
  preset?: ViewportPreset;
  width: number;
  x: number;
  y: number;
}

interface Props {
  frame: FrameBox;
  frameId: string;
  hostUrl: string | null;
  kind: "page" | "node";
  onDragStart: (
    e: ReactPointerEvent,
    frameId: string,
    kind: "move" | "resize",
    corner?: Corner
  ) => void;
  /** The page a page frame shows. */
  page?: Page;
  visible: boolean;
  zoom: number;
}

/** The node a drag carries, when it carries one that is already in a document. */
const draggedId = (target: Dragged): string | null => {
  if (target.kind === "node") {
    return target.node.id;
  }
  return target.kind === "loose" ? target.nodeId : null;
};

export const Frame = memo(
  ({
    frameId,
    kind,
    page,
    frame,
    hostUrl,
    zoom,
    visible,
    onDragStart,
  }: Props) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const mode = useEditor((s) => s.mode);
    const spacePan = useEditor((s) => s.spacePan);
    const selection = useEditor((s) => s.selection);
    const also = useEditor((s) => s.also);
    const hover = useEditor((s) => s.hover);
    const isActive = useEditor((s) => s.activePage === frameId);
    const canvas = useEditor((s) => s.canvas);
    const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
    const problem = useDocuments((s) =>
      isNodeFrame(frameId) ? undefined : s.docs[frameId]?.problem
    );
    const designSystem = useDesignSystem((s) => s.designSystem);
    const holdsCard = useComments(
      (s) =>
        s.draft?.pageId === frameId ||
        (s.open !== null &&
          page !== undefined &&
          s.comments.some((c) => c.id === s.open && c.page === page.path))
    );
    const url = hostUrl
      ? `${hostUrl}/?canvas=${encodeURIComponent(canvas ?? "")}&frame=${encodeURIComponent(frameId)}`
      : null;
    const inv = 1 / zoom;
    const name = frameName(page, root);

    // Bridge lifecycle. The bridge is looked up here and in handlers, never during render: the
    // registry is mutable (cleanup removes the entry), so a render-time lookup would be cached by
    // React Compiler and go stale.
    useEffect(() => {
      const iframe = iframeRef.current;
      if (!(iframe && visible && url)) {
        return;
      }
      const bridge = bridgeFor(frameId);
      bridge.attach(iframe);
      const store = useEditor.getState;
      const off = bridge.on((msg: HostMessage) => {
        switch (msg.type) {
          case "ed:ready":
            // A repository may pin its own framework package one day; an older preview
            // would then misread what the editor sends.
            if ((msg.protocol ?? PREVIEW_PROTOCOL) !== PREVIEW_PROTOCOL) {
              store().setHostError(
                frameId,
                `The preview speaks protocol ${msg.protocol}, the editor ${PREVIEW_PROTOCOL}. Update the framework package installed in the repository.`
              );
              break;
            }
            renderFrame(frameId, kind);
            // A page that reloads (or arrives late) has to be told the current mode: it starts
            // out interactive so that a preview opened on its own still works.
            bridge.setInteractive(isInteractive(store()));
            store().setHostError(frameId, null);
            break;
          case "ed:rects":
            store().setRects(frameId, msg.rects);
            break;
          case "ed:size":
            store().setSize(frameId, { height: msg.height, width: msg.width });
            break;
          case "ed:instances":
            useInstances.getState().report(msg.instances);
            break;
          case "ed:hmr":
            store().setHostError(frameId, null);
            break;
          case "ed:error":
            store().setHostError(frameId, formatHostError(msg.error));
            break;
          case "ed:textCommit":
            commitText(frameId, msg.nodeId, msg.text);
            break;
          case "ed:navigateTo":
            // The frame keeps its page; the canvas brings the page the link leads to into view.
            focusLink(msg.route);
            break;
          default:
            break;
        }
      });
      return () => {
        off();
        removeBridge(frameId);
      };
    }, [frameId, kind, visible, url]);

    // Whatever changed the document or the design system, the preview draws it again.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the document is the dependency.
    useEffect(() => {
      const bridge = bridgeFor(frameId);
      if (visible && url && bridge.ready) {
        renderFrame(frameId, kind);
      }
    }, [frameId, kind, visible, url, root, problem, designSystem]);

    // Outside interact mode the page is a picture: pointer events are off on the iframe, and
    // the runtime swallows whatever else could reach a component.
    useEffect(() => {
      if (!(visible && url)) {
        return;
      }
      bridgeFor(frameId).setInteractive(mode === "interact" && !spacePan);
    }, [frameId, visible, url, mode, spacePan]);

    // A selection whose node is gone (an undo, an agent) is let go of.
    useEffect(() => {
      if (
        selection?.frame === frameId &&
        root &&
        !nodeIn(useDocuments.getState().docs, canvas, frameId, selection.nodeId)
      ) {
        useEditor.getState().select(null);
      }
    }, [selection, root, frameId, canvas]);

    // What agents are changing here: outlined on the canvas, skeletons in the preview.
    const work = useFrameWork(frameId);
    useSkeletons(frameId, work.skeletons);
    const workIds = work.pieces.flatMap((p) => p.nodeIds).join(" ");

    // Rect watching for hover, selection and agents' work; sent again whenever the document
    // changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: `root` is there to send it again.
    useEffect(() => {
      const ids: string[] = [];
      if (selection?.frame === frameId) {
        ids.push(selection.nodeId);
        ids.push(...also.map((a) => a.nodeId));
      }
      if (hover?.frame === frameId) {
        ids.push(hover.nodeId);
      }
      if (workIds) {
        ids.push(...workIds.split(" "));
      }
      bridgeFor(frameId).watchRects(ids);
    }, [frameId, selection, also, hover, root, workIds]);

    // Pointer interaction in select mode.
    const lastHit = useRef(0);
    const toFrame = (e: ReactPointerEvent | ReactMouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
    };
    const currentRoot = () =>
      rootOfFrame(
        useDocuments.getState().docs,
        useEditor.getState().canvas,
        frameId
      );
    /** The node a pointer event at this position means, given what is selected. */
    const nodeAt = async (e: ReactPointerEvent | ReactMouseEvent) => {
      const { x, y } = toFrame(e);
      const chain = await hitUnlocked(frameId, x, y);
      const store = useEditor.getState();
      const selected =
        store.selection?.frame === frameId ? store.selection.nodeId : null;
      return stepInto(chain, currentRoot(), selected, e.altKey);
    };
    const onMove = async (e: ReactPointerEvent) => {
      const now = performance.now();
      if (now - lastHit.current < 40) {
        return;
      }
      lastHit.current = now;
      const id = await nodeAt(e);
      const store = useEditor.getState();
      if (id) {
        store.setHover({ frame: frameId, nodeId: id });
      } else if (store.hover?.frame === frameId) {
        store.setHover(null);
      }
    };
    const select = (id: string) =>
      useEditor.getState().select({ frame: frameId, nodeId: id });
    const selectFrame = () => {
      const store = useEditor.getState();
      if (kind === "page") {
        store.selectPage(frameId);
      } else if (root && !root.locked) {
        store.select({ frame: frameId, nodeId: root.id });
      } else {
        store.select(null);
      }
    };
    const onClick = async (e: ReactMouseEvent) => {
      // Keyboard activation (Enter/Space) has no pointer position to hit-test: it only picks
      // the frame, which is also what a click on nothing inside it means.
      if (e.detail === 0) {
        selectFrame();
        return;
      }
      const id = await nodeAt(e);
      if (id && e.shiftKey) {
        useEditor.getState().toggleSelected({ frame: frameId, nodeId: id });
      } else if (id) {
        select(id);
      } else {
        selectFrame();
      }
    };
    const onDoubleClick = async (e: ReactMouseEvent) => {
      const { x, y } = toFrame(e);
      const bridge = bridgeFor(frameId);
      // Text is edited where it is written, whatever the two clicks before this selected.
      const id = (await hitUnlocked(frameId, x, y)).at(-1);
      const node = id
        ? nodeIn(useDocuments.getState().docs, canvas, frameId, id)
        : null;
      if (id && node?.type === "text") {
        select(id);
        bridge.editText(id);
      }
    };

    /**
     * What a press or a right-click here is about: what is selected, when the point is inside
     * it, else what a click would select.
     */
    const pickAt = async (x: number, y: number, alt: boolean) => {
      const chain = await hitUnlocked(frameId, x, y);
      const store = useEditor.getState();
      const selected =
        store.selection?.frame === frameId ? store.selection.nodeId : null;
      return selected !== null && chain.includes(selected)
        ? selected
        : stepInto(chain, currentRoot(), selected, alt);
    };

    /**
     * What a press here picks up if it turns into a drag: what `pickAt` says. On a node placed on
     * the canvas, its root is the node itself, and dragging it moves it around the canvas.
     */
    const dragTarget = async (
      x: number,
      y: number,
      alt: boolean
    ): Promise<Dragged | null> => {
      const bridge = bridgeFor(frameId);
      const id = await pickAt(x, y, alt);
      const store = useEditor.getState();
      const current = currentRoot();
      if (!(id && current)) {
        return null;
      }
      if (kind === "node" && id === current.id) {
        return {
          frame: frameId,
          kind: "loose",
          nodeId: id,
          origin: { x: frame.x, y: frame.y },
        };
      }
      if (id === current.id) {
        return null;
      }
      const rect = (await bridge.measure([id]))[id];
      const node = nodeIn(
        useDocuments.getState().docs,
        store.canvas,
        frameId,
        id
      );
      if (!(rect && node)) {
        return null;
      }
      return { frame: frameId, kind: "node", node, rect };
    };

    // A press that travels becomes a drag; one that does not stays a click.
    const press = useRef<{
      x: number;
      y: number;
      /** Where it began in the frame, for a marquee. */
      at: { x: number; y: number };
      last: { x: number; y: number; alt: boolean };
      target: Promise<Dragged | null>;
    } | null>(null);
    /**
     * A drag from the page itself, or from a container that is not selected, draws a marquee in
     * it, as in Figma: a selected node, or a text, a picture or a component, is dragged instead.
     */
    const [marquee, setMarquee] = useState<Rect | null>(null);
    const marqueeFrom = useRef<{ x: number; y: number } | null>(null);
    const marqueeIn = useRef<DesignNode | null>(null);
    const isSelected = (id: string) => {
      const { also: others, selection: primary } = useEditor.getState();
      return (
        (primary?.frame === frameId && primary.nodeId === id) ||
        others.some((a) => a.frame === frameId && a.nodeId === id)
      );
    };
    const dragging = useRef<boolean>(false);
    const onPointerDown = (e: ReactPointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      dragging.current = false;
      const { x, y } = toFrame(e);
      press.current = {
        at: { x, y },
        last: { alt: e.altKey, x: e.clientX, y: e.clientY },
        target: dragTarget(x, y, e.altKey),
        x: e.clientX,
        y: e.clientY,
      };
      // The drag goes on over other frames and the empty canvas; the moves must still come here.
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: ReactPointerEvent) => {
      const p = press.current;
      if (!p) {
        onMove(e);
        return;
      }
      p.last = { alt: e.altKey, x: e.clientX, y: e.clientY };
      const from = marqueeFrom.current;
      if (from) {
        const to = toFrame(e);
        setMarquee({
          height: Math.abs(to.y - from.y),
          width: Math.abs(to.x - from.x),
          x: Math.min(from.x, to.x),
          y: Math.min(from.y, to.y),
        });
        return;
      }
      if (dragging.current) {
        moveDrag(e.clientX, e.clientY, e.altKey);
        return;
      }
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) {
        return;
      }
      dragging.current = true;
      p.target.then((target) => {
        // Released before the preview answered: it was a click after all.
        if (press.current !== p) {
          return;
        }
        if (!target) {
          if (kind === "page") {
            marqueeIn.current = currentRoot();
            marqueeFrom.current = p.at;
          }
          return;
        }
        if (
          target.kind === "node" &&
          isContainer(target.node) &&
          !isSelected(target.node.id)
        ) {
          marqueeIn.current = target.node;
          marqueeFrom.current = p.at;
          return;
        }
        // What is dragged is what is selected, as it would be after a click on it.
        const id = draggedId(target);
        if (id && useEditor.getState().selection?.nodeId !== id) {
          select(id);
        }
        beginDrag(target, p.x, p.y, p.last.alt);
        moveDrag(p.last.x, p.last.y, p.last.alt);
      });
    };
    const onPointerUp = () => {
      press.current = null;
      if (marqueeFrom.current) {
        marqueeFrom.current = null;
        const drawn = marquee;
        setMarquee(null);
        if (drawn) {
          selectInMarquee(drawn).catch(() => undefined);
        }
        return;
      }
      if (useDrag.getState().dragged) {
        endDrag();
      }
    };

    /**
     * What a marquee selects: the children of the container it was drawn in that it touches. When
     * it touches only one and does not cover it whole, that one's children instead: the way a
     * designer means the nodes the rectangle is drawn across.
     */
    const selectInMarquee = async (area: Rect) => {
      const within = marqueeIn.current ?? currentRoot();
      marqueeIn.current = null;
      if (!within) {
        return;
      }
      let level = childrenOf(within);
      for (;;) {
        // biome-ignore lint/performance/noAwaitInLoops: each level is measured once the one above is known.
        const measured = await bridgeFor(frameId).measure(
          level.map((n) => n.id)
        );
        const hits = level.filter((n) => {
          const r = measured[n.id];
          return r !== undefined && !n.locked && intersects(r, area);
        });
        const [only] = hits;
        const box = only ? measured[only.id] : undefined;
        // One child touched and not covered whole: what the rectangle is about is inside it.
        if (
          hits.length === 1 &&
          only &&
          box &&
          !contains(area, box) &&
          childrenOf(only).length > 0
        ) {
          level = childrenOf(only);
          continue;
        }
        useEditor
          .getState()
          .selectMany(hits.map((n) => ({ frame: frameId, nodeId: n.id })));
        return;
      }
    };
    const onSelectClick = (e: ReactMouseEvent) => {
      // The click that ends a drag is not a click.
      if (dragging.current) {
        dragging.current = false;
        return;
      }
      onClick(e);
    };

    /** Places a comment where the page was clicked, on the innermost node there. */
    const onPlaceComment = async (e: ReactMouseEvent) => {
      if (kind !== "page") {
        return;
      }
      const { x, y } = toFrame(e);
      const comments = useComments.getState();
      if (!comments.visible) {
        comments.toggleVisible();
      }
      const draft = { element: null, nodeId: null, pageId: frameId, x, y };
      comments.setDraft(draft);
      const chain = await bridgeFor(frameId).hitTest(x, y);
      const id = chain.at(-1);
      const node = id
        ? nodeIn(useDocuments.getState().docs, canvas, frameId, id)
        : null;
      // Only if the draft is still this one: another click may have moved it meanwhile.
      if (
        node &&
        node.type !== "page" &&
        useComments.getState().draft === draft
      ) {
        comments.setDraft({
          ...draft,
          element: nodeLabel(node),
          nodeId: node.id,
        });
      }
    };

    /**
     * A right-click selects what it is on, as a click would, and opens that node's menu; on
     * nothing but the page, the page's. What is selected stays selected when it is clicked in.
     */
    const onContextMenu = async (e: ReactMouseEvent) => {
      const anchor = holdMenu(e);
      const at = toFrame(e);
      const id = await pickAt(at.x, at.y, e.altKey);
      const current = currentRoot();
      const store = useEditor.getState();
      if (id && current && (kind === "node" || id !== current.id)) {
        selectForMenu({ frame: frameId, nodeId: id });
        showMenu({ at, frame: frameId, kind: "node", nodeId: id }, anchor);
      } else if (kind === "page") {
        store.selectPage(frameId);
        showMenu({ at, kind: "page", pageId: frameId }, anchor);
      } else if (current) {
        selectForMenu({ frame: frameId, nodeId: current.id });
        showMenu(
          { at, frame: frameId, kind: "node", nodeId: current.id },
          anchor
        );
      }
    };
    const onCommentContextMenu = (e: ReactMouseEvent) => {
      useEditor.getState().selectPage(frameId);
      openMenuAt(e, { at: toFrame(e), kind: "page", pageId: frameId });
    };

    const onPointerLeave = () => {
      const s = useEditor.getState();
      if (s.hover?.frame === frameId) {
        s.setHover(null);
      }
    };

    const isNode = kind === "node";

    return (
      <div
        className="group/frame absolute"
        data-frame={frameId}
        style={{
          height: frame.height,
          left: frame.x,
          top: frame.y,
          width: frame.width,
          // An open card reaches past the frame; the neighbours must not cover it.
          zIndex: holdsCard || isNode ? 1 : undefined,
        }}
      >
        <FrameChrome
          frame={frame}
          frameId={frameId}
          inv={inv}
          isActive={isActive}
          kind={kind}
          name={name}
          onDragStart={onDragStart}
          root={root}
        />

        <div
          className={cn(
            "absolute inset-0",
            isNode ? "overflow-visible" : "overflow-hidden bg-white shadow-2xl"
          )}
        >
          {visible && url ? (
            <iframe
              className={cn(
                "block h-full w-full border-0",
                isNode ? "bg-transparent" : "bg-white"
              )}
              ref={iframeRef}
              src={url}
              style={{
                pointerEvents:
                  mode === "interact" && !spacePan ? "auto" : "none",
              }}
              title={name}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-500">
              {url ? "" : "Preview host not running"}
            </div>
          )}
          {mode === "select" && !spacePan && (
            <button
              aria-label={`Select in ${name}`}
              className="absolute inset-0 h-full w-full cursor-default"
              onClick={onSelectClick}
              onContextMenu={onContextMenu}
              onDoubleClick={onDoubleClick}
              onPointerCancel={onPointerUp}
              onPointerDown={onPointerDown}
              onPointerLeave={onPointerLeave}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              type="button"
            />
          )}
          {mode === "comment" && !spacePan && !isNode && (
            <button
              aria-label={`Comment on ${name}`}
              className="absolute inset-0 h-full w-full"
              onClick={onPlaceComment}
              onContextMenu={onCommentContextMenu}
              style={{ cursor: commentCursor }}
              type="button"
            />
          )}
          <AgentWorkOverlay frameId={frameId} inv={inv} pieces={work.pieces} />
          {marquee ? (
            <div
              className="pointer-events-none absolute border border-selection bg-selection/10"
              style={{
                borderWidth: inv,
                height: marquee.height,
                left: marquee.x,
                top: marquee.y,
                width: marquee.width,
              }}
            />
          ) : null}
          <Highlights frameId={frameId} inv={inv} />
        </div>

        {page ? <FrameComments inv={inv} page={page} /> : null}

        <ResizeHandles
          frameId={frameId}
          inv={inv}
          kind={kind}
          onDragStart={onDragStart}
          root={root}
        />
      </div>
    );
  }
);
Frame.displayName = "Frame";

/** Whether the frame itself is selected: the page, or the node on the canvas it shows. */
const useFrameSelected = (
  frameId: string,
  kind: "page" | "node",
  root: DesignNode | null
) =>
  useEditor(
    (s) =>
      s.selectedPage === frameId ||
      (kind === "node" &&
        s.selection?.frame === frameId &&
        s.selection.nodeId === root?.id)
  );

/** A handle on each corner, shown while the frame is selected or the pointer is over it. */
const ResizeHandles = ({
  frameId,
  inv,
  kind,
  onDragStart,
  root,
}: Pick<Props, "frameId" | "kind" | "onDragStart"> & {
  inv: number;
  root: DesignNode | null;
}) => {
  const isSelected = useFrameSelected(frameId, kind, root);
  return CORNERS.map((corner) => (
    <div
      className={cn(
        "absolute rounded-sm bg-brand",
        corner === "nw" || corner === "se"
          ? "cursor-nwse-resize"
          : "cursor-nesw-resize",
        !isSelected && "opacity-0 group-hover/frame:opacity-100"
      )}
      key={corner}
      onPointerDown={(e) => onDragStart(e, frameId, "resize", corner)}
      style={{
        [corner[0] === "n" ? "top" : "bottom"]: -6 * inv,
        [corner[1] === "w" ? "left" : "right"]: -6 * inv,
        height: 10 * inv,
        width: 10 * inv,
      }}
    />
  ));
};

/** The header's height and its distance from the frame, on screen. */
const HEADER_HEIGHT = 26;
const HEADER_GAP = 6;

/**
 * Name and size above the frame, the frame's selection outline and, in Vibe, the toolbar of the
 * selected page.
 */
const FrameChrome = ({
  frameId,
  frame,
  inv,
  isActive,
  kind,
  name,
  onDragStart,
  root,
}: Pick<Props, "frame" | "frameId" | "kind" | "onDragStart"> & {
  inv: number;
  isActive: boolean;
  name: string;
  root: DesignNode | null;
}) => {
  const isSelected = useFrameSelected(frameId, kind, root);
  const workspace = useEditor((s) => s.workspace);
  const [titleHover, setTitleHover] = useState(false);
  const selectFrame = () => {
    const store = useEditor.getState();
    if (kind === "page") {
      store.selectPage(frameId);
    } else if (root) {
      store.select({ frame: frameId, nodeId: root.id });
    }
  };
  const onContextMenu = (e: ReactMouseEvent) => {
    selectFrame();
    if (kind === "page") {
      openMenuAt(e, { kind: "page", pageId: frameId });
    } else if (root) {
      openMenuAt(e, { frame: frameId, kind: "node", nodeId: root.id });
    }
  };
  return (
    <>
      {/* Chrome: constant size and distance from the frame regardless of zoom. */}
      <div
        className={cn(
          "absolute left-0 flex items-center gap-2 whitespace-nowrap",
          isSelected || isActive ? "text-foreground" : "text-muted-foreground"
        )}
        style={{
          bottom: `calc(100% + ${HEADER_GAP * inv}px)`,
          height: HEADER_HEIGHT,
          transform: `scale(${inv})`,
          transformOrigin: "bottom left",
        }}
      >
        <button
          className={cn(
            "cursor-pointer select-none font-medium text-[12px] hover:text-foreground",
            isSelected && "text-brand hover:text-brand"
          )}
          onClick={selectFrame}
          onContextMenu={onContextMenu}
          onPointerDown={(e) => onDragStart(e, frameId, "move")}
          onPointerEnter={() => setTitleHover(true)}
          onPointerLeave={() => setTitleHover(false)}
          type="button"
        >
          {name}
        </button>
        {kind === "page" && (
          <span className="text-[11px] text-muted-foreground">
            {Math.round(frame.width)} × {Math.round(frame.height)}
          </span>
        )}
      </div>
      {kind === "page" && isSelected && workspace === "vibe" ? (
        <PageToolbar
          headerHeight={HEADER_GAP + HEADER_HEIGHT}
          inv={inv}
          pageId={frameId}
        />
      ) : null}
      {isSelected || titleHover ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            outline: `${(isSelected ? 2 : 1) * inv}px solid ${isSelected ? kindColor("element") : kindHoverColor("element")}`,
          }}
        />
      ) : null}
      {kind === "page" && <FramePresence inv={inv} pageId={frameId} />}
    </>
  );
};

interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

/** The box around several rects. */
const unionOf = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) {
    return null;
  }
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { height: bottom - top, width: right - left, x: left, y: top };
};

/** The outlines of the hovered and the selected nodes, and an error the preview reported. */
const Highlights = ({ frameId, inv }: { frameId: string; inv: number }) => {
  const selection = useEditor((s) => s.selection);
  const also = useEditor((s) => s.also);
  const hover = useEditor((s) => s.hover);
  const rects = useEditor((s) => s.rects[frameId]);
  const hostError = useEditor((s) => s.hostErrors[frameId]);
  const canvas = useEditor((s) => s.canvas);
  const workspace = useEditor((s) => s.workspace);
  const frameWidth = useEditor(
    (s) =>
      s.frames[frameId]?.width ??
      s.sizes[frameId]?.width ??
      Number.POSITIVE_INFINITY
  );
  const docs = useDocuments((s) => s.docs);
  const here = selection?.frame === frameId;
  const selectedNode = here
    ? nodeIn(docs, canvas, frameId, selection.nodeId)
    : null;
  const hoverNode =
    hover?.frame === frameId
      ? nodeIn(docs, canvas, frameId, hover.nodeId)
      : null;
  const selectedRect = here ? rects?.[selection.nodeId] : undefined;
  const hoverRect =
    hover?.frame === frameId && hover.nodeId !== selection?.nodeId
      ? rects?.[hover.nodeId]
      : undefined;
  // Several selected: each is outlined, and what they share hangs over the box around them.
  const others = here
    ? also.flatMap((a) => {
        const node = nodeIn(docs, canvas, frameId, a.nodeId);
        const rect = rects?.[a.nodeId];
        return node && rect ? [{ node, rect, target: a }] : [];
      })
    : [];
  const many = others.length > 0;
  const group =
    many && selectedRect && selectedNode && selection
      ? {
          nodes: [selectedNode, ...others.map((o) => o.node)],
          rect: unionOf([selectedRect, ...others.map((o) => o.rect)]),
          targets: [selection, ...others.map((o) => o.target)],
        }
      : null;
  return (
    <>
      {hoverRect ? (
        <Outline
          inv={inv}
          kind="hover"
          node={hoverNode}
          rect={hoverRect}
          workspace={workspace}
        />
      ) : null}
      {selectedRect ? (
        <Outline
          bare={many}
          frameWidth={frameWidth}
          inv={inv}
          kind="selection"
          node={selectedNode}
          rect={selectedRect}
          workspace={workspace}
        />
      ) : null}
      {others.map((o) => (
        <Outline
          bare
          inv={inv}
          key={o.target.nodeId}
          kind="selection"
          node={o.node}
          rect={o.rect}
          workspace={workspace}
        />
      ))}
      {group?.rect ? (
        <GroupOutline
          frameWidth={frameWidth}
          inv={inv}
          nodes={group.nodes}
          rect={group.rect}
          targets={group.targets}
          workspace={workspace}
        />
      ) : null}
      {hostError ? (
        <div
          className="absolute inset-x-0 bottom-0 flex items-start gap-2 bg-destructive/90 p-3 font-mono text-[11px] text-white"
          style={{ fontSize: 11 * inv, padding: 12 * inv }}
        >
          <AlertTriangle className="size-4 shrink-0" />
          <pre className="whitespace-pre-wrap">{hostError}</pre>
        </div>
      ) : null}
    </>
  );
};

/**
 * The box around several selected nodes: their count on its edge and, in Vibe, the toolbar of
 * what they share; in Design, the box's size under it.
 */
const GroupOutline = ({
  frameWidth,
  inv,
  nodes,
  rect,
  targets,
  workspace,
}: {
  frameWidth: number;
  inv: number;
  nodes: readonly DesignNode[];
  rect: Rect;
  targets: readonly Selection[];
  workspace: Workspace;
}) => {
  const color = kindColor("element");
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        height: rect.height,
        left: rect.x,
        outline: `${1 * inv}px dashed ${color}`,
        outlineOffset: 3 * inv,
        top: rect.y,
        width: rect.width,
      }}
    >
      {workspace === "vibe" ? (
        <>
          <span
            className="absolute left-0 flex h-5 items-center rounded-t-[5px] px-1.5 font-semibold text-[11px] text-white"
            style={{
              background: color,
              bottom: "100%",
              transform: `translate(${-1 * inv}px, ${-4 * inv}px) scale(${inv})`,
              transformOrigin: "bottom left",
            }}
          >
            {nodes.length} selected
          </span>
          <GroupToolbar
            frameWidth={frameWidth}
            inv={inv}
            nodes={nodes}
            rect={rect}
            targets={targets}
          />
        </>
      ) : (
        <span
          className="absolute left-1/2 rounded-sm px-1 py-0.5 font-medium text-[10px] text-white"
          style={{
            background: color,
            top: "100%",
            transform: `translate(-50%, ${6 * inv}px) scale(${inv})`,
            transformOrigin: "top center",
            whiteSpace: "nowrap",
          }}
        >
          {nodes.length} · {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      )}
    </div>
  );
};

/**
 * A node's outline, in the colour of what it is: blue for an element, purple for a component. In
 * Design the selection's size sits under it; in Vibe its name sits on its top-left edge, where the
 * element toolbar hangs its controls from.
 */
const Outline = ({
  bare = false,
  frameWidth = Number.POSITIVE_INFINITY,
  rect,
  inv,
  kind,
  node,
  workspace,
}: {
  /** One of several selected: outlined only, the group carries the name and the toolbar. */
  bare?: boolean;
  /** How wide the frame is, which the toolbar stays inside. */
  frameWidth?: number;
  rect: { x: number; y: number; width: number; height: number };
  inv: number;
  kind: "hover" | "selection";
  node: DesignNode | null;
  workspace: Workspace;
}) => {
  const tone = selectionKindOf(node);
  const color = kind === "selection" ? kindColor(tone) : kindHoverColor(tone);
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        height: rect.height,
        left: rect.x,
        outline: `${(kind === "selection" ? 2 : 1) * inv}px solid ${color}`,
        outlineOffset: -1 * inv,
        top: rect.y,
        width: rect.width,
      }}
    >
      {kind === "selection" && !bare && workspace !== "vibe" && (
        <span
          className="absolute left-1/2 rounded-sm px-1 py-0.5 font-medium text-[10px] text-white"
          style={{
            background: color,
            top: "100%",
            transform: `translate(-50%, ${4 * inv}px) scale(${inv})`,
            transformOrigin: "top center",
            whiteSpace: "nowrap",
          }}
        >
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      )}
      {kind === "selection" && !bare && workspace === "vibe" && node ? (
        <>
          <SelectionTag
            color={color}
            inside={rect.y < TAG_HEIGHT * inv}
            inv={inv}
            node={node}
          />
          <ElementToolbar
            frameWidth={frameWidth}
            inv={inv}
            node={node}
            rect={rect}
          />
        </>
      ) : null}
    </div>
  );
};

export const useHostUrl = () => useProject((s) => previewUrl(s.info.host));
