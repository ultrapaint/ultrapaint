import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Page, ViewportPreset } from "@ultrapaint/contracts/pages";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import type { Preview } from "@ultrapaint/preview-core/preview";
import { X } from "lucide-react";
import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { CutText } from "../components/cut-text.tsx";
import { IconButton } from "../components/icon-button.tsx";
import { focusLink } from "../lib/links.ts";
import { updateNodes } from "../lib/node-actions.ts";
import { kindColor } from "../lib/selection-kind.ts";
import { isPicked, useCanvasPicks } from "../state/canvas-picks.ts";
import { useComments } from "../state/comments.ts";
import { openMenuAt } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { drawnRootOf, rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf, ownFrameOf, pageOfRef } from "../state/frame-ref.ts";
import { useIsolatedRequest } from "../state/isolation.ts";
import { removeView } from "../state/page-layout.ts";
import {
  select,
  selectPage,
  useFrameBreakpoint,
  useSelectedIn,
} from "../state/selection.ts";
import { FramePresence } from "./agent-presence.tsx";
import { AgentWorkOverlay, useFrameWork, useSkeletons } from "./agent-work.tsx";
import { onScreen, screenPx, UNZOOM } from "./camera.ts";
import { commentCursor, FrameComments } from "./comments.tsx";
import { frameOf, useFrameDrawing, useFrameEvents } from "./editor-frame.ts";
import { pickedFramesMoved } from "./frame-gesture.ts";
import { Highlights, useHoverIn } from "./frame-highlights.tsx";
import { pageRequest } from "./page-request.ts";
import { usePreview } from "./preview-module.ts";
import { useFramePointer } from "./use-frame-pointer.ts";

/**
 * Writes an inline text edit from the preview back into the document, at the breakpoint of the
 * view it was typed in (ADR 0036): a page's, or an app component's tree edited on its board.
 */
export const commitText = (frame: string, nodeId: string, text: string) =>
  updateNodes([{ frame, nodeId }], { text }, "Edit text");

/** A frame takes input: the interact tool, Space not held. */
export const isInteractive = (s: { mode: string; spacePan: boolean }) =>
  s.mode === "interact" && !s.spacePan;

/** A frame's select layer is up (a board's pick layer too): the select tool, Space not held. */
export const isSelecting = (s: { mode: string; spacePan: boolean }) =>
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
  /** A page's frame, one of its views, or a node's beside the pages: its id says which. */
  frameId: string;
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
export const useWatchedRects = (
  frameId: string,
  nodeIds: readonly (string | null)[]
) => {
  const watched = nodeIds.filter((id) => id !== null).join(" ");
  useEffect(() => {
    frameOf(frameId).watchRects(watched === "" ? [] : watched.split(" "));
  }, [frameId, watched]);
  // A frame taken off the canvas watches nothing: its handle is forgotten with it.
  useEffect(() => () => frameOf(frameId).watchRects([]), [frameId]);
};

export const Frame = memo(
  ({ frameId, page, frame, visible, onDragStart }: Props) => {
    const preview = usePreview();
    const isNode = frameRefOf(frameId).kind === "node";
    // Only what is selected or hovered in this frame: elsewhere it is no business of this one.
    const selectedHere = useSelectedIn(frameId);
    const holdsSelection = selectedHere.length > 0;
    const hoverHere = useHoverIn(frameId);
    const canvas = useEditor((s) => s.canvas);
    // What its selection is in, and what it draws: the same but while a component is edited in place.
    const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
    const drawnRoot = useDocuments((s) => drawnRootOf(s.docs, canvas, frameId));
    const isolate = useIsolatedRequest(frameId);
    const problem = useDocuments((s) => {
      const shown = pageOfRef(frameRefOf(frameId));
      return shown === null ? undefined : s.docs[shown]?.problem;
    });
    const designSystem = useDesignSystem((s) => s.designSystem);
    const defaults = useEditor((s) => s.layout.defaults);
    const held = useEditor((s) => s.held[frameId]);
    const holdsCard = useComments(
      (s) =>
        s.draft?.pageId === ownFrameOf(frameId) ||
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
        mode: isNode ? "fit" : "page",
        problem,
        root: drawnRoot,
        width: isNode ? undefined : frame.width,
      })
    );

    // A selection whose node is gone (an undo, an agent) is let go of.
    useEffect(() => {
      const [lead] = selectedHere;
      if (lead !== undefined && root && !findNode(root, lead)) {
        select(null);
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
      root,
    });

    return (
      <div
        className="group/frame absolute"
        data-frame={frameId}
        style={{
          height: frame.height,
          left: frame.x,
          top: frame.y,
          width: frame.width,
          zIndex: liftOf(holdsSelection, holdsCard || isNode),
        }}
      >
        <FrameChrome
          frame={frame}
          frameId={frameId}
          holdsSelection={holdsSelection}
          isNode={isNode}
          name={name}
          onDragStart={onDragStart}
          root={root}
        />

        <div
          className={cn(
            "absolute inset-0",
            isNode
              ? "overflow-visible"
              : "overflow-hidden bg-white ring-1 ring-black/8 dark:ring-white/6"
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
          <Highlights frameId={frameId} />
        </div>

        {page ? <FrameComments page={page} /> : null}

        <ResizeHandles
          frameId={frameId}
          isNode={isNode}
          onDragStart={onDragStart}
          root={root}
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
export const SelectLayer = ({
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
export const Marquee = ({
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
 * view the button that takes it away, shown while the pointer is over the frame.
 */
const ViewBadge = ({ frameId }: { frameId: string }) => {
  const breakpoint = useFrameBreakpoint(frameId);
  const isView = frameRefOf(frameId).kind === "view";
  const hasViews = useEditor(
    (s) => (s.frames[ownFrameOf(frameId)]?.views?.length ?? 0) > 0
  );
  if (!(isView || hasViews)) {
    return null;
  }
  const name = breakpoint ?? "base";
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="flex h-4 items-center rounded-sm bg-foreground/8 px-1 font-body-small-medium text-muted-foreground" />
          }
        >
          {name}
        </TooltipTrigger>
        <TooltipContent>Breakpoint {name}</TooltipContent>
      </Tooltip>
      {isView ? (
        <IconButton
          className="text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover/frame:opacity-100"
          onClick={() => removeView(frameId)}
          onPointerDown={(e) => e.stopPropagation()}
          size="icon-xs"
          tooltip="Remove view"
        >
          <X className="size-3.5" />
        </IconButton>
      ) : null}
    </>
  );
};

/**
 * Whether the frame itself is selected: its root, which is the page as a whole (ADR 0075) in any
 * of its views, or the node on the canvas it shows.
 */
const useFrameSelected = (
  frameId: string,
  isNode: boolean,
  root: DesignNode | null
) =>
  useEditor(
    (s) =>
      s.selection !== null &&
      s.selection.nodeId === root?.id &&
      (isNode
        ? s.selection.frame === frameId
        : ownFrameOf(s.selection.frame) === ownFrameOf(frameId))
  );

/** A handle on each corner, shown while the frame is selected or the pointer is over it. */
const ResizeHandles = ({
  frameId,
  isNode,
  onDragStart,
  root,
}: Pick<Props, "frameId" | "onDragStart"> & {
  isNode: boolean;
  root: DesignNode | null;
}) => {
  const isSelected = useFrameSelected(frameId, isNode, root);
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

/**
 * One corner's handle, as Figma draws it: a small white square edged in the selection's colour,
 * centred on the corner of the outline. Its size and place are screen pixels at any zoom.
 */
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
  // Centred on the 2px outline, which is drawn just outside the frame's edge.
  const off = screenPx(-5);
  const north = corner[0] === "n";
  const west = corner[1] === "w";
  return (
    <div
      className={cn(
        "absolute rounded-[1px] bg-white",
        corner === "nw" || corner === "se"
          ? "cursor-nwse-resize"
          : "cursor-nesw-resize",
        !shown && "opacity-0 group-hover/frame:opacity-100"
      )}
      onPointerDown={(e) => onDragStart(e, frameId, "resize", corner)}
      style={{
        border: `${screenPx(1)} solid ${kindColor("element")}`,
        bottom: north ? undefined : off,
        height: screenPx(8),
        left: west ? off : undefined,
        right: west ? undefined : off,
        top: north ? off : undefined,
        width: screenPx(8),
      }}
    />
  );
};

/** The header's height and its distance from the frame, on screen. */
const HEADER_HEIGHT = 24;
const HEADER_GAP = 4;

/** The class of a header's first child, its name: cut short to the frame's width, as Figma does. */
export const HEADER_NAME =
  "pointer-events-auto min-w-0 max-w-full truncate h-6 @max-[32px]:invisible";

/**
 * What is said over a frame's top edge, a page's or a board's: its name and beside it what the
 * caller says, the same size and distance from the frame on screen at any zoom, and never wider
 * than the frame there (as Figma and tldraw have it), so zoomed out the names do not run into
 * each other. The name (`HEADER_NAME`) is cut short with an ellipsis, and gone on a frame too
 * narrow for one; what follows it shows only where it fits whole, as it wraps out of the one line.
 */
export const FrameHeader = ({
  children,
  className,
  width,
}: {
  children: ReactNode;
  className?: string;
  /** The frame's width, on the canvas. */
  width: number;
}) => (
  <div
    className={cn(
      "@container pointer-events-none absolute left-0 flex flex-wrap items-center gap-x-1.5 overflow-hidden whitespace-nowrap font-body-small *:pointer-events-auto",
      className
    )}
    style={{
      bottom: `calc(100% + ${screenPx(HEADER_GAP)})`,
      height: HEADER_HEIGHT,
      transform: UNZOOM,
      transformOrigin: "bottom left",
      width: onScreen(width),
    }}
  >
    {children}
  </div>
);

/**
 * The name above the frame, with the breakpoint while the page has views, and the frame's
 * selection outline. The route and the size are the inspector's, and a page's notes its
 * toolbar's (ADR 0085): nothing else on the header can be caught by a drag meant for the frame.
 */
const FrameChrome = ({
  frameId,
  frame,
  holdsSelection,
  isNode,
  name,
  onDragStart,
  root,
}: Pick<Props, "frame" | "frameId" | "onDragStart"> & {
  /** Something in the frame is selected: the label is lit while it is, not after. */
  holdsSelection: boolean;
  isNode: boolean;
  name: string;
  root: DesignNode | null;
}) => {
  const isSelected = useFrameSelected(frameId, isNode, root);
  // One of several frames picked together by a marquee: outlined and lit, as a selected one.
  const picked = useCanvasPicks((s) => isPicked(s.ids, frameId));
  const lit = isSelected || picked;
  const [titleHover, setTitleHover] = useState(false);
  const selectFrame = () => {
    // The click that ends moving the picked frames together keeps them picked.
    if (pickedFramesMoved()) {
      return;
    }
    if (!isNode) {
      selectPage(frameId);
    } else if (root) {
      select({ frame: frameId, nodeId: root.id });
    }
  };
  const onContextMenu = (e: ReactMouseEvent) => {
    selectFrame();
    if (!isNode) {
      openMenuAt(e, { kind: "page", pageId: frameId });
    } else if (root) {
      openMenuAt(e, { frame: frameId, kind: "node", nodeId: root.id });
    }
  };
  return (
    <>
      <FrameHeader width={frame.width}>
        <button
          className={cn(
            HEADER_NAME,
            "cursor-pointer select-none outline-none transition-colors focus-visible:underline",
            lit && "text-selection",
            !lit &&
              (holdsSelection || titleHover
                ? "text-foreground"
                : "text-muted-foreground")
          )}
          onClick={selectFrame}
          onContextMenu={onContextMenu}
          onPointerDown={(e) => onDragStart(e, frameId, "move")}
          onPointerEnter={() => setTitleHover(true)}
          onPointerLeave={() => setTitleHover(false)}
          type="button"
        >
          <CutText className="block truncate">{name}</CutText>
        </button>
        {isNode ? null : <ViewBadge frameId={frameId} />}
      </FrameHeader>
      {lit || titleHover ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            outline: `${screenPx(lit ? 2 : 1)} solid ${kindColor("element")}`,
          }}
        />
      ) : null}
      {isNode ? null : <FramePresence pageId={frameId} width={frame.width} />}
    </>
  );
};
