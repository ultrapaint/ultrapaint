import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import type { HostError, HostMessage } from "@ultrapaint/contracts/preview";
import { nodeLabel } from "@ultrapaint/design-document/tree";
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
import { OptionSelect } from "../components/option-select.tsx";
import { useComments } from "../state/comments.ts";
import { useDesignSystem } from "../state/design-system.ts";
import {
  applyOps,
  docOfFrame,
  isNodeFrame,
  nodeIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { stepInto } from "../state/tree.ts";
import { FramePresence } from "./agent-presence.tsx";
import { bridgeFor, removeBridge } from "./bridge.ts";
import { commentCursor, FrameComments } from "./comments.tsx";
import { beginDrag, type Dragged, endDrag, moveDrag, useDrag } from "./drag.ts";

const presets: { value: ViewportPreset; label: string }[] = [
  { label: "Mobile", value: "mobile" },
  { label: "Tablet", value: "tablet" },
  { label: "Desktop", value: "desktop" },
  { label: "Custom", value: "custom" },
];

const formatHostError = (error: HostError) => {
  if (!error.file) {
    return error.message;
  }
  const line = error.line ? `:${error.line}` : "";
  return `${error.message}\n${error.file}${line}`;
};

/** Writes an inline text edit from the preview back into the document. */
const commitText = (frame: string, nodeId: string, text: string) => {
  const { space } = useEditor.getState();
  applyOps(
    docOfFrame(frame, space),
    [{ id: nodeId, op: "update", set: { text } }],
    "Edit text"
  );
};

const isInteractive = (s: { mode: string; spacePan: boolean }) =>
  s.mode === "interact" && !s.spacePan;

/** How far the pointer travels before a press becomes a drag, in screen pixels. */
const DRAG_THRESHOLD = 4;

/** Tells a preview what its frame shows now: the document as it is, in the design system. */
const renderFrame = (frameId: string, kind: "page" | "node") => {
  const { space } = useEditor.getState();
  const state = isNodeFrame(frameId)
    ? null
    : useDocuments.getState().docs[frameId];
  const root = rootOfFrame(useDocuments.getState().docs, space, frameId);
  const { designSystem } = useDesignSystem.getState();
  bridgeFor(frameId).render({
    designSystem,
    mode: kind === "page" ? "page" : "fit",
    root,
    ...(state?.problem !== undefined && {
      message: `This page cannot be read: ${state.problem}`,
    }),
  });
};

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
    kind: "move" | "resize"
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
    const hover = useEditor((s) => s.hover);
    const isActive = useEditor((s) => s.activePage === frameId);
    const space = useEditor((s) => s.space);
    const root = useDocuments((s) => rootOfFrame(s.docs, space, frameId));
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
      ? `${hostUrl}/?space=${encodeURIComponent(space ?? "")}&frame=${encodeURIComponent(frameId)}`
      : null;
    const inv = 1 / zoom;
    const name = page?.name ?? (root ? nodeLabel(root) : "");

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
            // The frame keeps its page; the editor goes where the link pointed.
            store().navigate(msg.route, { push: !msg.replace });
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
        !nodeIn(useDocuments.getState().docs, space, frameId, selection.nodeId)
      ) {
        useEditor.getState().select(null);
      }
    }, [selection, root, frameId, space]);

    // Rect watching for hover and selection; sent again whenever the document changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: `root` is there to send it again.
    useEffect(() => {
      const ids: string[] = [];
      if (selection?.frame === frameId) {
        ids.push(selection.nodeId);
      }
      if (hover?.frame === frameId) {
        ids.push(hover.nodeId);
      }
      bridgeFor(frameId).watchRects(ids);
    }, [frameId, selection, hover, root]);

    // Pointer interaction in select mode.
    const lastHit = useRef(0);
    const toFrame = (e: ReactPointerEvent | ReactMouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
    };
    const currentRoot = () =>
      rootOfFrame(
        useDocuments.getState().docs,
        useEditor.getState().space,
        frameId
      );
    /** The node a pointer event at this position means, given what is selected. */
    const nodeAt = async (e: ReactPointerEvent | ReactMouseEvent) => {
      const { x, y } = toFrame(e);
      const chain = await bridgeFor(frameId).hitTest(x, y);
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
      } else if (root) {
        store.select({ frame: frameId, nodeId: root.id });
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
      if (id) {
        select(id);
      } else {
        selectFrame();
      }
    };
    const onDoubleClick = async (e: ReactMouseEvent) => {
      const { x, y } = toFrame(e);
      const bridge = bridgeFor(frameId);
      // Text is edited where it is written, whatever the two clicks before this selected.
      const id = (await bridge.hitTest(x, y)).at(-1);
      const node = id
        ? nodeIn(useDocuments.getState().docs, space, frameId, id)
        : null;
      if (id && node?.type === "text") {
        select(id);
        bridge.editText(id);
      }
    };

    /**
     * What a press here picks up if it turns into a drag: what is selected, when the press is
     * inside it, else what a click would select. On a node placed on the canvas, its root is the
     * node itself, and dragging it moves it around the canvas.
     */
    const dragTarget = async (
      x: number,
      y: number,
      alt: boolean
    ): Promise<Dragged | null> => {
      const bridge = bridgeFor(frameId);
      const chain = await bridge.hitTest(x, y);
      const store = useEditor.getState();
      const current = currentRoot();
      const selected =
        store.selection?.frame === frameId ? store.selection.nodeId : null;
      const id =
        selected !== null && chain.includes(selected)
          ? selected
          : stepInto(chain, current, selected, alt);
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
        store.space,
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
      last: { x: number; y: number; alt: boolean };
      target: Promise<Dragged | null>;
    } | null>(null);
    const dragging = useRef<boolean>(false);
    const onPointerDown = (e: ReactPointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      dragging.current = false;
      const { x, y } = toFrame(e);
      press.current = {
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
        if (!(target && press.current === p)) {
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
      if (useDrag.getState().dragged) {
        endDrag();
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
        ? nodeIn(useDocuments.getState().docs, space, frameId, id)
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

    const onPointerLeave = () => {
      const s = useEditor.getState();
      if (s.hover?.frame === frameId) {
        s.setHover(null);
      }
    };

    const isNode = kind === "node";

    return (
      <div
        className="absolute"
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
              style={{ cursor: commentCursor }}
              type="button"
            />
          )}
          <Highlights frameId={frameId} inv={inv} />
        </div>

        {page ? <FrameComments inv={inv} page={page} /> : null}

        <div
          className="absolute cursor-nwse-resize rounded-sm bg-brand"
          onPointerDown={(e) => onDragStart(e, frameId, "resize")}
          style={{
            bottom: -6 * inv,
            height: 10 * inv,
            right: -6 * inv,
            width: 10 * inv,
          }}
        />
      </div>
    );
  }
);
Frame.displayName = "Frame";

/** Name, viewport preset and size above the frame, plus the frame's selection outline. */
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
  const isSelected = useEditor(
    (s) =>
      s.selectedPage === frameId ||
      (kind === "node" &&
        s.selection?.frame === frameId &&
        s.selection.nodeId === root?.id)
  );
  const [titleHover, setTitleHover] = useState(false);
  const selectFrame = () => {
    const store = useEditor.getState();
    if (kind === "page") {
      store.selectPage(frameId);
    } else if (root) {
      store.select({ frame: frameId, nodeId: root.id });
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
          bottom: `calc(100% + ${6 * inv}px)`,
          height: 26,
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
          onPointerDown={(e) => onDragStart(e, frameId, "move")}
          onPointerEnter={() => setTitleHover(true)}
          onPointerLeave={() => setTitleHover(false)}
          type="button"
        >
          {name}
        </button>
        {kind === "page" && (
          <>
            <div className="w-24">
              <OptionSelect
                className="border-transparent bg-transparent text-[11px] text-muted-foreground hover:border-input dark:bg-transparent"
                onChange={(v) =>
                  useEditor.getState().setPreset(frameId, v as ViewportPreset)
                }
                options={presets}
                size="sm"
                value={frame.preset ?? "custom"}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">
              {Math.round(frame.width)} × {Math.round(frame.height)}
            </span>
          </>
        )}
      </div>
      {isSelected || titleHover ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            outline: `${(isSelected ? 2 : 1) * inv}px solid ${isSelected ? "#4f8cff" : "rgba(79,140,255,0.6)"}`,
          }}
        />
      ) : null}
      {kind === "page" && <FramePresence inv={inv} pageId={frameId} />}
    </>
  );
};

/** The outlines of the hovered and the selected node, and an error the preview reported. */
const Highlights = ({ frameId, inv }: { frameId: string; inv: number }) => {
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
  const rects = useEditor((s) => s.rects[frameId]);
  const hostError = useEditor((s) => s.hostErrors[frameId]);
  const selectedRect =
    selection?.frame === frameId ? rects?.[selection.nodeId] : undefined;
  const hoverRect =
    hover?.frame === frameId && hover.nodeId !== selection?.nodeId
      ? rects?.[hover.nodeId]
      : undefined;
  return (
    <>
      {hoverRect ? <Outline inv={inv} kind="hover" rect={hoverRect} /> : null}
      {selectedRect ? (
        <Outline inv={inv} kind="selection" rect={selectedRect} />
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

const Outline = ({
  rect,
  inv,
  kind,
}: {
  rect: { x: number; y: number; width: number; height: number };
  inv: number;
  kind: "hover" | "selection";
}) => (
  <div
    className="pointer-events-none absolute"
    style={{
      height: rect.height,
      left: rect.x,
      outline: `${(kind === "selection" ? 2 : 1) * inv}px solid ${kind === "selection" ? "#4f8cff" : "rgba(79,140,255,0.6)"}`,
      outlineOffset: -1 * inv,
      top: rect.y,
      width: rect.width,
    }}
  >
    {kind === "selection" && (
      <span
        className="absolute left-1/2 rounded-sm bg-brand px-1 py-0.5 font-medium text-[10px] text-brand-foreground"
        style={{
          top: "100%",
          transform: `translate(-50%, ${4 * inv}px) scale(${inv})`,
          transformOrigin: "top center",
          whiteSpace: "nowrap",
        }}
      >
        {Math.round(rect.width)} × {Math.round(rect.height)}
      </span>
    )}
  </div>
);

export const useHostUrl = () =>
  useProject((s) =>
    s.info.host.state === "running" ? (s.info.host.url ?? null) : null
  );
