/**
 * A board view's canvas (ADR 0045), in the page canvas's place while one is open: the same camera
 * (its wheel, its pan, Space held, the zoom control), on a blue-tinted ground of dots of its own,
 * over the boards of the item open and nothing else. A board is a generated document drawn as a
 * frame by the page's renderer, as a page is: nothing here draws a design.
 *
 * Its frames are `board:<view>/<item>/<name>`, laid out by the board view's state as they report
 * their size (`showBoards`, `setBoardSize`), on the ground the page canvas has too
 * (`CanvasGround`). A click picks the node a board names for what it stands for (B6,
 * `boards/pick.ts`); on the Library's Overview, a component's tile opens it.
 * The interact tool makes a board run, as a page does. On an app component's board, a
 * double-click edits its tree in place (`isolation.ts`), and that board then takes the pointer as
 * a page's frame does: hover, select, drag, text typed where it is.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import type { ComponentMeta } from "@ultrapaint/contracts/catalogue";
import { APP_FROM, type ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignDocument } from "@ultrapaint/contracts/design-system";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import {
  type CSSProperties,
  memo,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/cn";
import {
  drawnWidths,
  libraryBoards,
  OVERVIEW,
} from "../boards/library-boards.ts";
import { lookBoards } from "../boards/look-boards.ts";
import { pickOfId } from "../boards/pick.ts";
import {
  type Board,
  type Boards,
  guidelineId,
  systemBoards,
  systemItemName,
} from "../boards/system-boards.ts";
import { CutText } from "../components/cut-text.tsx";
import {
  type BoardPlace,
  openBoard,
  pickOf,
  pickOnBoard,
  setBoardSize,
  showBoards,
  useBoard,
} from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { boardFrameOf } from "../state/frame-ref.ts";
import {
  isolate,
  leaveIsolation,
  useIsolatedRequest,
  useIsolation,
} from "../state/isolation.ts";
import { LOOK_ITEM, useLookPage } from "../state/look-page.ts";
import { useSelectedIn } from "../state/selection.ts";
import { screenPx } from "./camera.ts";
import { CanvasGround } from "./canvas-ground.tsx";
import { frameOf, useFrameDrawing, useFrameEvents } from "./editor-frame.ts";
import {
  commitText,
  FrameHeader,
  HEADER_NAME,
  isInteractive,
  isSelecting,
  Marquee,
  SelectLayer,
  useWatchedRects,
} from "./frame.tsx";
import { Highlights, useHoverIn } from "./frame-highlights.tsx";
import { PreviewSurface } from "./preview-surface.tsx";
import { useFramePointer } from "./use-frame-pointer.ts";

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
  const dials = useLookPage((s) => s.dials);
  const drawn = useOverviewWidths(open, catalogue);
  return useMemo(() => {
    if (open.view === "system" && open.item === LOOK_ITEM) {
      return lookBoards(dials);
    }
    return open.view === "system"
      ? systemBoards(open.item, ds, withGuideDraft(document, guideDraft))
      : libraryBoards(
          open.item,
          catalogue,
          (name) => fileOf(components, name),
          drawn
        );
  }, [open, ds, document, catalogue, components, guideDraft, drawn, dials]);
};

/**
 * How wide the Overview draws each app component, measured as it draws: one that hugs what it
 * holds says its width only drawn, and the Overview scales it to its tile with it.
 */
const useOverviewWidths = (
  open: BoardPlace,
  catalogue: readonly ComponentMeta[]
): Readonly<Record<string, number>> => {
  const [drawn, setDrawn] = useState<Readonly<Record<string, number>>>({});
  const apps = useMemo(
    () => catalogue.flatMap((c) => (c.importFrom === APP_FROM ? [c.name] : [])),
    [catalogue]
  );
  const overview = open.view === "library" && open.item === OVERVIEW;
  useEffect(() => {
    if (!overview) {
      return;
    }
    const frame = frameOf(boardFrameOf({ ...open, name: OVERVIEW }));
    const measure = () => {
      const rects = frame.measure(apps.map((name) => `example:${name}`));
      setDrawn((was) => drawnWidths(apps, rects, was));
    };
    return frame.listen({ rendered: measure });
  }, [overview, open, apps]);
  return drawn;
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
  if (open.view === "system" && open.item === LOOK_ITEM) {
    return "Samples";
  }
  if (open.view === "system") {
    return systemItemName(open.item, document);
  }
  return open.item === OVERVIEW ? "Overview" : open.item;
};

export const BoardCanvas = ({ open }: { open: BoardPlace }) => {
  const { boards, direction } = useBoards(open);
  const name = useItemName(open);
  const ids = useMemo(
    () => boards.map((b) => boardFrameOf({ ...open, name: b.name })),
    [boards, open]
  );
  // The boards laid out where the camera and the frames read them: the board view's state.
  useLayoutEffect(() => showBoards(ids, direction), [ids, direction]);
  const layout = useBoard((s) => s.frames);

  return (
    <CanvasGround
      background="board"
      onContextMenu={(e) => e.preventDefault()}
      overlay={
        boards.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-body-small text-muted-foreground">
            Nothing to show for {name}
          </div>
        ) : null
      }
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
          />
        ) : null;
      })}
    </CanvasGround>
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

/** A board: its generated document drawn in a frame, its name over it, what is picked outlined. */
const BoardFrame = memo(
  ({
    board,
    box,
    frameId,
    name,
  }: {
    board: Board;
    box: Box;
    frameId: string;
    name: string;
  }) => {
    const designSystem = useDesignSystem((s) => s.designSystem);
    const defaults = useBoardDefaults(board);
    const selecting = useEditor(isSelecting);
    const interactive = useEditor(isInteractive);
    const canvas = useEditor((s) => s.canvas) ?? "";
    // The app component's tree edited in place here: drawn as the nodes the editor selects.
    const isolated = useIsolatedRequest(frameId);
    const editing = useIsolation((s) => s.isolated?.frame === frameId);
    useFrameDrawing(
      frameId,
      useMemo(
        () => ({
          ...(board.css && { css: board.css }),
          defaults,
          designSystem,
          ...(isolated && { isolate: isolated }),
          mode: "fit" as const,
          root: board.root,
        }),
        [board.css, defaults, designSystem, isolated, board.root]
      )
    );
    const listeners = useMemo(
      () => ({
        size: (size: { height: number; width: number }) =>
          setBoardSize(frameId, size),
      }),
      [frameId]
    );

    const onClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const { zoom } = useEditor.getState().view;
      const chain = frameOf(frameId).hitTest(
        (e.clientX - r.left) / zoom,
        (e.clientY - r.top) / zoom
      );
      // The innermost node that stands for something; a component's tile opens it.
      const nodeId = chain.findLast((id) => pickOfId(id) !== null) ?? null;
      const picked = nodeId === null ? null : pickOfId(nodeId);
      if (picked?.kind === "item") {
        openBoard({ item: picked.name, view: "library" });
        return;
      }
      // Another variant's board is clicked: the one edited in place is left.
      if (board.inPlace && useIsolation.getState().isolated) {
        leaveIsolation();
      }
      pickOnBoard(nodeId ? { frame: frameId, nodeId } : null);
    };
    /** An app component's tree is edited in place on its board, landing on its member. */
    const onDoubleClick = () => {
      if (board.inPlace) {
        isolate(frameId, board.inPlace.instance, {
          variant: board.inPlace.variant,
        });
      }
    };

    return (
      <div
        // The page around a tree edited in place is dimmed up to the board's edge, not past it.
        className={cn("absolute", editing && "overflow-hidden rounded-lg")}
        data-board-frame={frameId}
        style={{
          height: box.height,
          left: box.x,
          top: box.y,
          width: box.width,
        }}
      >
        {/* The board's own name: the item's is the panels' title already. */}
        <FrameHeader width={box.width}>
          <CutText
            className={cn(HEADER_NAME, "text-muted-foreground")}
            tip={`${name}: ${board.title}`}
          >
            {board.title}
          </CutText>
        </FrameHeader>
        <PreviewSurface
          canvas={canvas}
          className="absolute top-0 left-0 w-max"
          frameId={frameId}
          hostClassName="block"
          interactive={interactive}
          listeners={listeners}
          style={{ "--inv": "1" } as CSSProperties}
          title={`${name}: ${board.title}`}
        />
        {editing ? <BoardTree box={box} frameId={frameId} name={name} /> : null}
        {selecting && !editing ? (
          <button
            aria-label={`Pick in ${name}: ${board.title}`}
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            type="button"
          />
        ) : null}
        {editing ? null : <PickOutline frameId={frameId} />}
      </div>
    );
  }
);
BoardFrame.displayName = "BoardFrame";

/**
 * An app component's tree edited in place on a board: the pointer as a page's frame has it (a
 * hover, a click, a drag, a marquee, a menu, text typed where it is) over the frame's preview, and
 * the outlines of what is hovered and selected. The element toolbar is a page's: the inspector on
 * the right edits what is selected here.
 */
const BoardTree = ({
  box,
  frameId,
  name,
}: {
  box: Box;
  frameId: string;
  name: string;
}) => {
  const canvas = useEditor((s) => s.canvas);
  const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frameId));
  const selected = useSelectedIn(frameId);
  const hover = useHoverIn(frameId);
  useWatchedRects(frameId, [...selected, hover]);
  useFrameEvents(frameId, {
    rects: (rects) => useEditor.getState().setRects(frameId, rects),
    textCommit: (nodeId, text) => commitText(frameId, nodeId, text),
  });
  const pointer = useFramePointer({
    canvas,
    frame: box,
    frameId,
    root,
  });
  return (
    <div className="absolute inset-0">
      <SelectLayer
        name={name}
        onClick={pointer.onSelectClick}
        onContextMenu={pointer.onContextMenu}
        onDoubleClick={pointer.onDoubleClick}
        onGone={pointer.onSelectLayerGone}
        onPointerCancel={pointer.onPointerCancel}
        onPointerDown={pointer.onPointerDown}
        onPointerLeave={pointer.onPointerLeave}
        onPointerMove={pointer.onPointerMove}
        onPointerUp={pointer.onPointerUp}
      />
      {pointer.marquee ? <Marquee box={pointer.marquee} /> : null}
      <Highlights frameId={frameId} />
    </div>
  );
};

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
