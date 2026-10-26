import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import type { HostError } from "@ultrapaint/contracts/preview";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import { PREVIEW_PROTOCOL } from "@ultrapaint/framework-api/protocol";
import { cn } from "cn";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { focusLink } from "../lib/links.ts";
import { kindColor, kindHoverColor } from "../lib/selection-kind.ts";
import { useComments } from "../state/comments.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import {
  applyOps,
  docOfFrame,
  isNodeFrame,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor, useInv } from "../state/editor.ts";
import { useInstances } from "../state/instances.ts";
import { useDesignLookVersion } from "../state/look.ts";
import { previewUrl, useProject } from "../state/project.ts";
import { FramePresence } from "./agent-presence.tsx";
import { AgentWorkOverlay, useFrameWork, useSkeletons } from "./agent-work.tsx";
import { bridgeFor } from "./bridge.ts";
import { commentCursor, FrameComments } from "./comments.tsx";
import { ToolbarLayer } from "./element-toolbar-placement.ts";
import {
  Highlights,
  idsOf,
  useAlsoIn,
  useHoverIn,
  useSelectedIn,
} from "./frame-highlights.tsx";
import { PageToolbar } from "./page-toolbar.tsx";
import { useFramePointer } from "./use-frame-pointer.ts";
import { usePreviewBridge } from "./use-preview-bridge.ts";

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

/** The frame's select layer is up. */
const isSelecting = (s: { mode: string; spacePan: boolean }) =>
  s.mode === "select" && !s.spacePan;

/** What a frame is called over its top edge: the page, in its variant, or the node on the canvas. */
const frameName = (page: Page | undefined, root: DesignNode | null) => {
  if (page) {
    return page.variant === undefined
      ? page.name
      : `${page.name} · ${page.variant}`;
  }
  return root ? nodeLabel(root) : "";
};

/** Tells a preview what its frame shows now: the document as it is, in the design system. */
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

/**
 * How high a frame stacks over its neighbours. An open card and the selection's toolbar reach past
 * the frame, and a node's frame shows what it draws past its edges: the neighbours must not cover
 * them, and the toolbar is over everything else.
 */
const liftOf = (holdsSelection: boolean, reachesPast: boolean) => {
  if (holdsSelection) {
    return 2;
  }
  return reachesPast ? 1 : undefined;
};

/** A frame's corner, which resizing it drags while the opposite one stays put. */
export type Corner = "nw" | "ne" | "sw" | "se";

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

interface FrameBox {
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
}

export const Frame = memo(
  ({ frameId, kind, page, frame, hostUrl, visible, onDragStart }: Props) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const mode = useEditor((s) => s.mode);
    const spacePan = useEditor((s) => s.spacePan);
    // Only what is selected or hovered in this frame: elsewhere it is no business of this one.
    const selectedHere = useSelectedIn(frameId);
    const alsoHere = useAlsoIn(frameId);
    const hoverHere = useHoverIn(frameId);
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
    const name = frameName(page, root);
    // A callback ref: the selection's toolbar is drawn in it once it is there.
    const [toolbarLayer, setToolbarLayer] = useState<HTMLDivElement | null>(
      null
    );

    // The bridge speaks for this frame while it is on screen and has a preview to load.
    usePreviewBridge(
      iframeRef,
      visible && url ? frameId : null,
      url,
      (msg, bridge) => {
        const store = useEditor.getState;
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
      }
    );

    // Whatever changed the document, the design system or the design's look, the preview draws
    // it again.
    const look = useDesignLookVersion();
    // biome-ignore lint/correctness/useExhaustiveDependencies: the document is the dependency.
    useEffect(() => {
      const bridge = bridgeFor(frameId);
      if (visible && url && bridge.ready) {
        renderFrame(frameId, kind);
      }
    }, [frameId, kind, visible, url, root, problem, designSystem, ...look]);

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
      if (selectedHere !== null && root && !findNode(root, selectedHere)) {
        useEditor.getState().select(null);
      }
    }, [selectedHere, root]);

    // What agents are changing here: outlined on the canvas, skeletons in the preview.
    const work = useFrameWork(frameId);
    useSkeletons(frameId, work.skeletons);
    const workIds = work.pieces.flatMap((p) => p.nodeIds).join(" ");

    // Rect watching for hover, selection and agents' work; sent again whenever the document
    // changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: `root` is there to send it again.
    useEffect(() => {
      const ids: string[] = [];
      if (selectedHere !== null) {
        ids.push(selectedHere, ...idsOf(alsoHere));
      }
      if (hoverHere !== null) {
        ids.push(hoverHere);
      }
      ids.push(...idsOf(workIds));
      bridgeFor(frameId).watchRects(ids);
    }, [frameId, selectedHere, alsoHere, hoverHere, root, workIds]);

    const selecting = useEditor(isSelecting);
    const {
      marquee,
      onCommentContextMenu,
      onContextMenu,
      onDoubleClick,
      onPlaceComment,
      onPointerDown,
      onPointerLeave,
      onPointerMove,
      onPointerUp,
      onSelectClick,
    } = useFramePointer({
      canvas,
      frame,
      frameId,
      kind,
      root,
      selecting,
    });

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
          zIndex: liftOf(selectedHere !== null, holdsCard || isNode),
        }}
      >
        <FrameChrome
          frame={frame}
          frameId={frameId}
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
          {selecting ? (
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
          ) : null}
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
          <AgentWorkOverlay frameId={frameId} pieces={work.pieces} />
          {marquee ? <Marquee box={marquee} /> : null}
          <ToolbarLayer.Provider value={toolbarLayer}>
            <Highlights frameId={frameId} />
          </ToolbarLayer.Provider>
        </div>

        {page ? <FrameComments page={page} /> : null}

        <ResizeHandles
          frameId={frameId}
          kind={kind}
          onDragStart={onDragStart}
          root={root}
        />

        <div
          className="pointer-events-none absolute inset-0"
          ref={setToolbarLayer}
        />
      </div>
    );
  }
);
Frame.displayName = "Frame";

/** The box being drawn over a frame to select what it touches. */
const Marquee = ({
  box,
}: {
  box: { height: number; width: number; x: number; y: number };
}) => {
  const inv = useInv();
  return (
    <div
      className="pointer-events-none absolute border border-selection bg-selection/10"
      style={{
        borderWidth: inv,
        height: box.height,
        left: box.x,
        top: box.y,
        width: box.width,
      }}
    />
  );
};

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
  kind,
  onDragStart,
  root,
}: Pick<Props, "frameId" | "kind" | "onDragStart"> & {
  root: DesignNode | null;
}) => {
  const isSelected = useFrameSelected(frameId, kind, root);
  const inv = useInv();
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
  isActive,
  kind,
  name,
  onDragStart,
  root,
}: Pick<Props, "frame" | "frameId" | "kind" | "onDragStart"> & {
  isActive: boolean;
  name: string;
  root: DesignNode | null;
}) => {
  const isSelected = useFrameSelected(frameId, kind, root);
  const inv = useInv();
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
            "cursor-pointer select-none font-body font-medium hover:text-foreground",
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
          <span className="font-body text-muted-foreground">
            {Math.round(frame.width)} × {Math.round(frame.height)}
          </span>
        )}
      </div>
      {kind === "page" && isSelected ? (
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

export const useHostUrl = () => useProject((s) => previewUrl(s.info.host));
