/**
 * A board view's canvas (ADR 0045), in the page canvas's place while one is open: the same camera
 * (its wheel, its pan, Space held, the zoom control), on a blue-tinted ground of dots of its own,
 * over the boards of the item open and nothing else. A board is a generated document drawn as a
 * frame by the page's renderer, as the Components tab's matrix is: nothing here draws a design.
 *
 * Its frames are `board:<view>/<item>/<name>`, laid out in a row or a column as they report their
 * size (`boardLayout`), and told to the camera through `setBoardFrames`. A click picks the node a
 * board names for what it stands for (B6); on the Library's Overview, a component's tile opens it.
 * The interact tool makes a board run, as a page does.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import type { ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignDocument } from "@ultrapaint/contracts/design-system";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { cn } from "cn";
import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { libraryBoards, OVERVIEW } from "../boards/library-boards.ts";
import {
  type Board,
  type Boards,
  guidelineId,
  systemBoards,
  systemItemName,
} from "../boards/system-boards.ts";
import { boardLayout } from "../lib/board-layout.ts";
import {
  type BoardPlace,
  openBoard,
  pickOf,
  pickOnBoard,
  setBoardFrames,
  useBoard,
} from "../state/board.ts";
import { nextView, setViewSoon } from "../state/camera.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { boardFrameOf } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import {
  screenPx,
  UNZOOM,
  useCamera,
  useSpacePan,
  wheelView,
} from "./camera.ts";
import { frameOf, useFrameDrawing } from "./editor-frame.ts";
import { dotsBackground } from "./grid.ts";
import { PreviewSurface } from "./preview-surface.tsx";

/** A component's file as a board draws it: the project's, or the system component's default look. */
const fileOf = (
  components: readonly ComponentFile[],
  name: string
): ComponentFile | undefined =>
  components.find((c) => c.name === name) ?? defaultLookOf(name);

/** The boards of the item open, generated anew whenever what they are made from changes. */
const useBoards = (open: BoardPlace): Boards => {
  const ds = useDesignSystem((s) => s.designSystem);
  const document = useDesignSystem((s) => s.document);
  const catalogue = useComponents((s) => s.catalogue);
  const components = useComponents((s) => s.components);
  const guideDraft = useBoard((s) => s.guideDraft);
  return useMemo(
    () =>
      open.view === "system"
        ? systemBoards(open.item, ds, withGuideDraft(document, guideDraft))
        : libraryBoards(open.item, catalogue, (name) =>
            fileOf(components, name)
          ),
    [open, ds, document, catalogue, components, guideDraft]
  );
};

/** DESIGN.md with a guideline's text as it is typed, for its board to draw. */
const withGuideDraft = (
  document: DesignDocument | null,
  draft: { readonly item: string; readonly text: string } | null
): DesignDocument | null =>
  document && draft
    ? {
        ...document,
        sections: document.sections.map((s) =>
          guidelineId(s.heading) === draft.item ? { ...s, text: draft.text } : s
        ),
      }
    : document;

/** What the item open is called: over its boards, in its inspector. */
export const useItemName = (open: BoardPlace) => {
  const document = useDesignSystem((s) => s.document);
  if (open.view === "system") {
    return systemItemName(open.item, document);
  }
  return open.item === OVERVIEW ? "Overview" : open.item;
};

/** What a board names for something a click picks: a token, a group, a cell, a style, a component. */
const PICKABLE = /^(token|group|cell|style|item):/;

/** The tools that pick on a board: the pointer goes to the frame only in select. */
const isSelecting = (s: { mode: string; spacePan: boolean }) =>
  s.mode === "select" && !s.spacePan;

export const BoardCanvas = ({ open }: { open: BoardPlace }) => {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const mode = useEditor((s) => s.mode);
  const spacePan = useEditor((s) => s.spacePan);
  const [panning, setPanning] = useState(false);
  const { boards, direction } = useBoards(open);
  const name = useItemName(open);
  const [sizes, setSizes] = useState<
    Record<string, { height: number; width: number }>
  >({});
  useCamera(ref, layer, dotsBackground);
  useSpacePan();

  const ids = useMemo(
    () => boards.map((b) => boardFrameOf({ ...open, name: b.name })),
    [boards, open]
  );
  const layout = useMemo(
    () => boardLayout(ids, sizes, direction),
    [ids, sizes, direction]
  );
  useLayoutEffect(() => setBoardFrames(layout), [layout]);

  // Where the canvas is in the window, for a zoom about the pointer.
  const origin = useRef({ left: 0, top: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const rect = el.getBoundingClientRect();
      origin.current = { left: rect.left, top: rect.top };
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelView(e, origin.current);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const onSize = useMemo(
    () => (frame: string, size: { height: number; width: number }) =>
      setSizes((s) => {
        const known = s[frame];
        return known?.width === size.width && known.height === size.height
          ? s
          : { ...s, [frame]: size };
      }),
    []
  );

  const panFrom = useRef<{
    startX: number;
    startY: number;
    vx: number;
    vy: number;
  } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    const pan = e.button === 1 || spacePan || mode === "pan";
    if (!pan) {
      // The ground picks nothing: what was picked is let go.
      if (e.button === 0 && e.target === e.currentTarget) {
        pickOnBoard(null);
      }
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPanning(true);
    const from = nextView();
    panFrom.current = {
      startX: e.clientX,
      startY: e.clientY,
      vx: from.x,
      vy: from.y,
    };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = panFrom.current;
    if (p) {
      setViewSoon({
        x: p.vx + (e.clientX - p.startX),
        y: p.vy + (e.clientY - p.startY),
      });
    }
  };
  const onPointerUp = () => {
    panFrom.current = null;
    setPanning(false);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: the canvas is the pointer's; the panels name what it shows.
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-board",
        (spacePan || mode === "pan") && "cursor-grab [&_*]:cursor-grab!",
        panning && "cursor-grabbing! [&_*]:cursor-grabbing!"
      )}
      data-board-canvas
      data-canvas
      onContextMenu={(e) => e.preventDefault()}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={ref}
    >
      {/* Moved by the camera, not by rendering: see `useCamera`. */}
      <div
        className="absolute top-0 left-0"
        ref={layer}
        style={{ transformOrigin: "0 0" }}
      >
        {boards.map((board, i) => {
          const id = ids[i] as string;
          const box = layout[id];
          return box ? (
            <BoardFrame
              board={board}
              box={box}
              frameId={id}
              key={id}
              name={name}
              onSize={onSize}
            />
          ) : null;
        })}
      </div>
      {boards.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-body text-muted-foreground">
          Nothing to draw for {name}
        </div>
      ) : null}
    </div>
  );
};

/**
 * What a board is drawn in: its theme (Color's own, a board a theme, else the switch's), and the
 * design's text colour, taken in that theme as a page's is.
 */
const useBoardDefaults = (board: Board) => {
  const theme = useBoard((s) => board.theme ?? s.theme);
  return useMemo(
    () => ({ color: "$color-foreground", ...(theme && { theme }) }),
    [theme]
  );
};

const HEADER_GAP = 6;
const HEADER_HEIGHT = 26;

/** A board: its generated document drawn in a frame, its name over it, what is picked outlined. */
const BoardFrame = memo(
  ({
    board,
    box,
    frameId,
    name,
    onSize,
  }: {
    board: Board;
    box: Box;
    frameId: string;
    name: string;
    onSize: (frame: string, size: { height: number; width: number }) => void;
  }) => {
    const designSystem = useDesignSystem((s) => s.designSystem);
    const defaults = useBoardDefaults(board);
    const selecting = useEditor(isSelecting);
    const interactive = useEditor((s) => s.mode === "interact" && !s.spacePan);
    useFrameDrawing(
      frameId,
      useMemo(
        () => ({
          ...(board.css && { css: board.css }),
          defaults,
          designSystem,
          mode: "fit" as const,
          root: board.root,
        }),
        [board.css, defaults, designSystem, board.root]
      )
    );
    const listeners = useMemo(
      () => ({
        size: (size: { height: number; width: number }) =>
          onSize(frameId, size),
      }),
      [frameId, onSize]
    );

    const onClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const { zoom } = useEditor.getState().view;
      const chain = frameOf(frameId).hitTest(
        (e.clientX - r.left) / zoom,
        (e.clientY - r.top) / zoom
      );
      const nodeId = chain.findLast((id) => PICKABLE.test(id)) ?? null;
      if (nodeId?.startsWith("item:")) {
        openBoard({ item: nodeId.slice("item:".length), view: "library" });
        return;
      }
      pickOnBoard(nodeId ? { frame: frameId, nodeId } : null);
    };

    return (
      <div
        className="absolute"
        data-board-frame={frameId}
        style={{
          height: box.height,
          left: box.x,
          top: box.y,
          width: box.width,
        }}
      >
        <div
          className="absolute left-0 flex items-center gap-2 whitespace-nowrap font-body"
          style={{
            bottom: `calc(100% + ${screenPx(HEADER_GAP)})`,
            height: HEADER_HEIGHT,
            transform: UNZOOM,
            transformOrigin: "bottom left",
          }}
        >
          <span className="font-medium text-foreground">{name}</span>
          <span className="text-muted-foreground">{board.title}</span>
        </div>
        <PreviewSurface
          className="absolute top-0 left-0 w-max"
          frameId={frameId}
          hostClassName="block"
          interactive={interactive}
          listeners={listeners}
          style={{ "--inv": "1" } as CSSProperties}
          title={`${name}: ${board.title}`}
        />
        {selecting ? (
          <button
            aria-label={`Pick in ${name}: ${board.title}`}
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={onClick}
            type="button"
          />
        ) : null}
        <PickOutline frameId={frameId} />
      </div>
    );
  }
);
BoardFrame.displayName = "BoardFrame";

/** What is picked in a board, outlined where the frame has it, measured again as it draws. */
const PickOutline = ({ frameId }: { frameId: string }) => {
  const [rect, setRect] = useState<Box | null>(null);
  useEffect(() => {
    const measure = () => {
      const pick = pickOf(useBoard.getState());
      const nodeId = pick?.frame === frameId ? pick.nodeId : null;
      setRect(
        nodeId === null
          ? null
          : (frameOf(frameId).measure([nodeId])[nodeId] ?? null)
      );
    };
    const offs = [
      useBoard.subscribe(measure),
      frameOf(frameId).listen({ ready: measure, rendered: measure }),
    ];
    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [frameId]);
  if (!rect) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute rounded-[2px]"
      style={{
        height: rect.height,
        left: rect.x,
        outline: `${screenPx(2)} solid var(--color-selection)`,
        outlineOffset: screenPx(2),
        top: rect.y,
        width: rect.width,
      }}
    />
  );
};
