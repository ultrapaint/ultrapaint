import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import type { Preview } from "@ultrapaint/preview-core/preview";
import { cn } from "cn";
import { X } from "lucide-react";
import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { focusLink } from "../lib/links.ts";
import { updateNodes } from "../lib/node-actions.ts";
import { kindColor, kindHoverColor } from "../lib/selection-kind.ts";
import { useComments } from "../state/comments.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import {
  drawnRootOf,
  isNodeFrame,
  pageOfFrame,
  rootOfFrame,
  useDocuments,
  viewOfFrame,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useIsolatedRequest } from "../state/isolation.ts";
import { useFrameBreakpoint, useSelectedIn } from "../state/selection.ts";
import { FramePresence } from "./agent-presence.tsx";
import { AgentWorkOverlay, useFrameWork, useSkeletons } from "./agent-work.tsx";
import { screenPx, UNZOOM } from "./camera.ts";
import { commentCursor, FrameComments } from "./comments.tsx";
import { frameOf, useFrameDrawing, useFrameEvents } from "./editor-frame.ts";
import { ToolbarLayer } from "./element-toolbar-placement.ts";
import { Highlights, useHoverIn } from "./frame-highlights.tsx";
import { pageRequest } from "./page-request.ts";
import { PageToolbar } from "./page-toolbar.tsx";
import { usePreview } from "./preview-module.ts";
import { useFramePointer } from "./use-frame-pointer.ts";

/**
 * Writes an inline text edit from the preview back into the document, at the breakpoint of the
 * view it was typed in (ADR 0036).
 */
const commitText = (frame: string, nodeId: string, text: string) =>
  updateNodes([{ frame, nodeId }], { text }, "Edit text");

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

/**
 * The nodes whose rects a frame reports (hover, selection, agents' work; null for none), told
 * when they change: the frame measures them again whenever it draws.
 */
const useWatchedRects = (
  frameId: string,
  nodeIds: readonly (string | null)[]
) => {
  const watched = nodeIds.filter((id) => id !== null).join(" ");
  useEffect(() => {
    frameOf(frameId).watchRects(watched === "" ? [] : watched.split(" "));
  }, [frameId, watched]);
};

export const Frame = memo(
  ({ frameId, kind, page, frame, visible, onDragStart }: Props) => {
    const preview = usePreview();
    // Only what is selected or hovered in this frame: elsewhere it is no business of this one.
    const selectedHere = useSelectedIn(frameId);
    const hoverHere = useHoverIn(frameId);
    const canvas = useEditor((s) => s.canvas);
    // What its selection is in, and what it draws: the same but while a component is edited in place.
    const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
    const drawnRoot = useDocuments((s) => drawnRootOf(s.docs, canvas, frameId));
    const isolate = useIsolatedRequest(frameId);
    const problem = useDocuments((s) =>
      isNodeFrame(frameId) ? undefined : s.docs[pageOfFrame(frameId)]?.problem
    );
    const designSystem = useDesignSystem((s) => s.designSystem);
    const defaults = useEditor((s) => s.layout.defaults);
    const held = useEditor((s) => s.held[frameId]);
    const holdsCard = useComments(
      (s) =>
        s.draft?.pageId === frameId ||
        (s.open !== null &&
          page !== undefined &&
          s.comments.some((c) => c.id === s.open && c.page === page.path))
    );
    // A frame drawn once keeps its page while it is away from the screen: hidden where it is,
    // so coming back neither moves it nor lays it out again.
    const [kept, setKept] = useState(false);
    const drawn = visible;
    const hosted = visible || kept;
    const name = frameName(page, drawnRoot);
    // A callback ref: the selection's toolbar is drawn in it once it is there.
    const [toolbarLayer, setToolbarLayer] = useState<HTMLDivElement | null>(
      null
    );

    // What the frame says, heard while it is on screen and drawn. Its error the frame keeps,
    // whoever listens (`Highlights`).
    useFrameEvents(drawn ? frameId : null, {
      // The frame keeps its page; the canvas brings the page the link leads to into view.
      navigateTo: (route) => focusLink(route),
      rects: (rects) => useEditor.getState().setRects(frameId, rects),
      rendered: () => setKept(true),
      size: (size) => useEditor.getState().setSize(frameId, size),
      textCommit: (nodeId, text) => commitText(frameId, nodeId, text),
    });

    // The document at the frame's width, in the design system (the preview's look over it),
    // drawn while it is on screen. A page is as wide as its frame; a node on the canvas as it is held
    // while it is resized, or as its own width.
    useFrameDrawing(
      drawn ? frameId : null,
      pageRequest({
        defaults,
        designSystem,
        held,
        isolate,
        mode: kind === "page" ? "page" : "fit",
        problem,
        root: drawnRoot,
        width: kind === "page" ? frame.width : undefined,
      })
    );

    // A selection whose node is gone (an undo, an agent) is let go of.
    useEffect(() => {
      const [lead] = selectedHere;
      if (lead !== undefined && root && !findNode(root, lead)) {
        useEditor.getState().select(null);
      }
    }, [selectedHere, root]);

    // What agents are changing here: outlined on the canvas, skeletons in the preview.
    const work = useFrameWork(frameId);
    useSkeletons(frameId, work.skeletons);
    useWatchedRects(frameId, [
      ...selectedHere,
      hoverHere,
      ...work.pieces.flatMap((p) => p.nodeIds),
    ]);

    const {
      marquee,
      onCommentContextMenu,
      onSelectLayerGone,
      onContextMenu,
      onDoubleClick,
      onPlaceComment,
      onPointerCancel,
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
          holdsSelection={selectedHere !== null}
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
          {hosted && canvas !== null ? (
            <PreviewHost
              away={!visible}
              canvas={canvas}
              frameId={frameId}
              isNode={isNode}
              preview={preview}
              title={name}
            />
          ) : null}
          <SelectLayer
            name={name}
            onClick={onSelectClick}
            onContextMenu={onContextMenu}
            onDoubleClick={onDoubleClick}
            onGone={onSelectLayerGone}
            onPointerCancel={onPointerCancel}
            onPointerDown={onPointerDown}
            onPointerLeave={onPointerLeave}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {isNode ? null : (
            <CommentLayer
              name={name}
              onClick={onPlaceComment}
              onContextMenu={onCommentContextMenu}
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

/**
 * The frame's page, drawn in a shadow root of the editor's page (ADR 0034). Outside interact
 * mode the page is a picture: the pointer goes past it, and the frame takes no input. Only this
 * reads the mode, so Space or another tool draws no frame again.
 */
const PreviewHost = ({
  away,
  canvas,
  frameId,
  isNode,
  preview,
  title,
}: {
  /** Off the screen: kept as it is, and skipped by the browser. */
  away: boolean;
  canvas: string;
  frameId: string;
  isNode: boolean;
  preview: Preview;
  title: string;
}) => {
  const interactive = useEditor(isInteractive);
  const holder = useRef<HTMLDivElement>(null);
  // Opened before the frame listens to it, which happens in the frame's passive effects; parked
  // when it goes.
  useLayoutEffect(() => {
    if (!holder.current) {
      return;
    }
    return frameOf(frameId).open({
      canvas,
      className: cn(
        "block h-full w-full",
        isNode ? "bg-transparent" : "bg-white"
      ),
      holder: holder.current,
      keep: true,
      preview,
    }).close;
  }, [frameId, canvas, isNode, preview]);
  useEffect(() => {
    const frame = frameOf(frameId);
    frame.setTitle(title);
    frame.setInteractive(interactive);
  }, [frameId, title, interactive]);
  useLayoutEffect(() => {
    frameOf(frameId).setAway(away);
  }, [frameId, away]);
  // The camera writes the zoom on the layer as `--inv`, which everything under it inherits; pinned
  // on the holder, a zoom stops here: the host, whose style applies every `:host` rule of the
  // page's stylesheet (all of its tokens), is not styled again on every step.
  return (
    <div
      className="h-full w-full"
      ref={holder}
      style={{ "--inv": "1" } as CSSProperties}
    />
  );
};

type LayerHandler<E> = (e: E) => void;

/** Over the frame in select mode, without Space held: what picks nodes in the preview. */
const SelectLayer = ({
  name,
  onClick,
  onContextMenu,
  onDoubleClick,
  onGone,
  onPointerCancel,
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
}: {
  name: string;
  onClick: LayerHandler<ReactMouseEvent>;
  onContextMenu: LayerHandler<ReactMouseEvent>;
  onDoubleClick: LayerHandler<ReactMouseEvent>;
  /** Called as the layer goes away: the pointer resting on it then sends no leave. */
  onGone: () => void;
  onPointerCancel: () => void;
  onPointerDown: LayerHandler<ReactPointerEvent>;
  onPointerLeave: LayerHandler<ReactPointerEvent>;
  onPointerMove: LayerHandler<ReactPointerEvent>;
  onPointerUp: LayerHandler<ReactPointerEvent>;
}) => {
  const selecting = useEditor(isSelecting);
  const gone = useEffectEvent(onGone);
  useEffect(() => {
    if (selecting) {
      return () => gone();
    }
  }, [selecting]);
  if (!selecting) {
    return null;
  }
  return (
    <button
      aria-label={`Select in ${name}`}
      className="absolute inset-0 h-full w-full cursor-default"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      type="button"
    />
  );
};

/** Over a page in comment mode, without Space held: a click places a comment. */
const CommentLayer = ({
  name,
  onClick,
  onContextMenu,
}: {
  name: string;
  onClick: LayerHandler<ReactMouseEvent>;
  onContextMenu: LayerHandler<ReactMouseEvent>;
}) => {
  const commenting = useEditor((s) => s.mode === "comment" && !s.spacePan);
  if (!commenting) {
    return null;
  }
  return (
    <button
      aria-label={`Comment on ${name}`}
      className="absolute inset-0 h-full w-full"
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{ cursor: commentCursor }}
      type="button"
    />
  );
};

/** The box being drawn over a frame to select what it touches. */
const Marquee = ({
  box,
}: {
  box: { height: number; width: number; x: number; y: number };
}) => (
  <div
    className="pointer-events-none absolute border border-selection bg-selection/10"
    style={{
      borderWidth: screenPx(1),
      height: box.height,
      left: box.x,
      top: box.y,
      width: box.width,
    }}
  />
);

/**
 * The breakpoint a page's frame or view is drawn at, once the page has views (ADR 0036), and on a
 * view the button that takes it away.
 */
const ViewBadge = ({ frameId }: { frameId: string }) => {
  const breakpoint = useFrameBreakpoint(frameId);
  const isView = viewOfFrame(frameId) !== null;
  const hasViews = useEditor(
    (s) => (s.frames[pageOfFrame(frameId)]?.views?.length ?? 0) > 0
  );
  if (!(isView || hasViews)) {
    return null;
  }
  return (
    <>
      <span
        className="rounded bg-muted px-1 font-code text-muted-foreground"
        title="The breakpoint this view shows, and the one its edits land at"
      >
        {breakpoint ?? "base"}
      </span>
      {isView ? (
        <button
          aria-label="Remove this view"
          className="flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => useEditor.getState().removeView(frameId)}
          onPointerDown={(e) => e.stopPropagation()}
          title="Remove this view"
          type="button"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </>
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
      s.selectedPage === pageOfFrame(frameId) ||
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
  return CORNERS.map((corner) => (
    <ResizeHandle
      corner={corner}
      frameId={frameId}
      key={corner}
      onDragStart={onDragStart}
      shown={isSelected}
    />
  ));
};

/** One corner's handle; its size and distance from the corner are screen pixels. */
const ResizeHandle = ({
  corner,
  frameId,
  onDragStart,
  shown,
}: Pick<Props, "frameId" | "onDragStart"> & {
  corner: Corner;
  /** Shown whatever the pointer does: the frame is selected. */
  shown: boolean;
}) => {
  // Off the corner by the same distance on screen at any zoom.
  const off = screenPx(-6);
  const north = corner[0] === "n";
  const west = corner[1] === "w";
  return (
    <div
      className={cn(
        "absolute rounded-sm bg-brand",
        corner === "nw" || corner === "se"
          ? "cursor-nwse-resize"
          : "cursor-nesw-resize",
        !shown && "opacity-0 group-hover/frame:opacity-100"
      )}
      onPointerDown={(e) => onDragStart(e, frameId, "resize", corner)}
      style={{
        bottom: north ? undefined : off,
        height: screenPx(10),
        left: west ? off : undefined,
        right: west ? undefined : off,
        top: north ? off : undefined,
        width: screenPx(10),
      }}
    />
  );
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
  holdsSelection,
  kind,
  name,
  onDragStart,
  root,
}: Pick<Props, "frame" | "frameId" | "kind" | "onDragStart"> & {
  /** Something in the frame is selected: the label is lit while it is, not after. */
  holdsSelection: boolean;
  name: string;
  root: DesignNode | null;
}) => {
  const isSelected = useFrameSelected(frameId, kind, root);
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
          isSelected || holdsSelection
            ? "text-foreground"
            : "text-muted-foreground"
        )}
        style={{
          bottom: `calc(100% + ${screenPx(HEADER_GAP)})`,
          height: HEADER_HEIGHT,
          transform: UNZOOM,
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
        {kind === "page" && <ViewBadge frameId={frameId} />}
      </div>
      {kind === "page" && isSelected && viewOfFrame(frameId) === null ? (
        <PageToolbar
          headerHeight={HEADER_GAP + HEADER_HEIGHT}
          pageId={frameId}
        />
      ) : null}
      {isSelected || titleHover ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            outline: `${screenPx(isSelected ? 2 : 1)} solid ${isSelected ? kindColor("element") : kindHoverColor("element")}`,
          }}
        />
      ) : null}
      {kind === "page" && <FramePresence pageId={frameId} />}
    </>
  );
};
