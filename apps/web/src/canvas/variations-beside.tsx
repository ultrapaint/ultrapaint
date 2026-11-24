/**
 * A thing's variations laid out beside its page (ADR 0098), while they are open: each drawn
 * straight on the canvas background, with no card around it, its name and what it varied over
 * it, the one in use marked. A click shows it in the preview, the thing in its page. Opening them
 * fits the camera to the page and its variations. After them, an agent's takes still coming are
 * placeholders in its colour, and those that failed red boxes with Try again. The rest of the
 * canvas fades back under them, so they may lie over a neighbouring page, and a press on it
 * closes them.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import { componentOfDoc } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect as FrameRect } from "@ultrapaint/contracts/preview";
import type {
  Variation,
  VariationRound,
} from "@ultrapaint/contracts/variations";
import { resolveAtBreakpoint } from "@ultrapaint/design-document/breakpoints";
import { findNode } from "@ultrapaint/design-document/tree";
import { ArrowLeft } from "lucide-react";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { tryAgain } from "../lib/ask-variations.ts";
import { zoomToBoxes } from "../state/camera.ts";
import { useComponents } from "../state/components.ts";
import { useBreakpoints, useDesignSystem } from "../state/design-system.ts";
import { canvasNodes, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import { nodeFrameLayout } from "../state/page-layout.ts";
import { useAgentSweeps } from "../state/preferences.ts";
import { useFrameBreakpoint } from "../state/selection.ts";
import {
  besideBoxes,
  clickUndone,
  clickVariation,
  closeOnSelecting,
  closeVariations,
  type OpenVariations,
  openSet,
  partInPreview,
  partShown,
  putPartInPreview,
  rootOfDocument,
  selectPart,
  sizedAsInPage,
  takesOfOpen,
  useVariations,
  variationFrameOf,
} from "../state/variations.ts";
import { screenPx, UNZOOM } from "./camera.ts";
import { pansAnywhere } from "./canvas-ground.tsx";
import { frameOf, useFrameDrawing } from "./editor-frame.ts";
import { FrameHeader, HEADER_NAME } from "./frame.tsx";
import { pageRequest } from "./page-request.ts";
import { PreviewSurface } from "./preview-surface.tsx";
import { CHOOSING_LIFT } from "./variation-preview.tsx";

/** The heights its variations were drawn at, by variation, from those told by frame. */
const heightsOf = (
  open: OpenVariations,
  ids: readonly string[],
  byFrame: Readonly<Record<string, number>>
): Record<string, number> =>
  Object.fromEntries(
    ids.flatMap((id) => {
      const height = byFrame[variationFrameOf(open, id)];
      return height === undefined ? [] : [[id, height]];
    })
  );

/**
 * What each variation varied, said over it once: a variation that varied what one before it
 * said (three takes on "Colour of the page") leaves it to that one.
 */
export const variedOnce = (
  variations: readonly Variation[]
): Record<string, string | undefined> => {
  const said = new Set<string>();
  return Object.fromEntries(
    variations.map((v) => {
      if (!v.varied || said.has(v.varied)) {
        return [v.id, undefined];
      }
      said.add(v.varied);
      return [v.id, v.varied];
    })
  );
};

/** The box of the frame the preview is drawn in, on the canvas: a page's, or a node's beside them. */
const useFrameBox = (frameId: string | null): Box | null => {
  const page = useEditor((s) => (frameId ? s.frames[frameId] : undefined));
  const size = useEditor((s) => (frameId ? s.sizes[frameId] : undefined));
  const canvas = useEditor((s) => s.canvas);
  const ref = frameId ? frameRefOf(frameId) : null;
  const node = useDocuments((s) =>
    ref?.kind === "node"
      ? canvasNodes(s.docs, canvas).find((n) => n.id === ref.node)
      : undefined
  );
  if (page) {
    return page;
  }
  return node ? nodeFrameLayout(node, size) : null;
};

/** One variation, drawn as wide as the thing, at the canvas's zoom. */
const VariationFrame = memo(
  ({
    at,
    box,
    frameId,
    inUse,
    inPage,
    onHeight,
    page,
    pageWidth,
    shown,
    sized,
    tree,
    variation,
    varied,
  }: {
    /** The breakpoint its page is drawn at, which a part is drawn at too. */
    at: string | null;
    box: Box;
    frameId: string;
    /** The thing's size in its page, which a part is drawn at. */
    inPage: { readonly height: number; readonly width: number };
    inUse: boolean;
    /** Tells the height it is drawn at, by its frame. */
    onHeight: (frame: string, height: number) => void;
    /** It is a whole page, drawn at the page's width. */
    page: boolean;
    /** The width of the page it is from, whose breakpoint it is drawn at. */
    pageWidth: number;
    shown: boolean;
    /** It is a part of its page, drawn at the thing's width there. */
    sized: boolean;
    tree: DesignNode | null;
    variation: Variation;
    /** What it varied, said over it; none where a variation before it said the same. */
    varied: string | undefined;
  }) => {
    const designSystem = useDesignSystem((s) => s.designSystem);
    const breakpoints = useBreakpoints();
    const defaults = useEditor((s) => s.layout.defaults);
    const canvas = useEditor((s) => s.canvas) ?? "";
    // A part is drawn as its parent sizes it in its page; a page fills its own.
    const { height, width } = inPage;
    const root = useMemo(
      () =>
        tree && sized
          ? // Sized as its breakpoint has it: a height that fills there is drawn at its height.
            sizedAsInPage(resolveAtBreakpoint(tree, breakpoints, at), {
              height,
              width,
            })
          : tree,
      [tree, sized, height, width, breakpoints, at]
    );
    useFrameDrawing(
      frameId,
      useMemo(
        () =>
          pageRequest({
            defaults,
            designSystem,
            mode: page ? "page" : "fit",
            root,
            // A part is drawn at its page's breakpoint, as the page draws it.
            width: pageWidth,
          }),
        [defaults, designSystem, page, root, pageWidth]
      )
    );
    const listeners = useMemo(
      () => ({
        size: (size: { height: number; width: number }) =>
          onHeight(frameId, size.height),
      }),
      [onHeight, frameId]
    );
    return (
      <div
        className="absolute"
        data-variation={variation.id}
        style={{
          height: box.height,
          left: box.x,
          outline: shown ? `${screenPx(2)} solid var(--selection)` : undefined,
          top: box.y,
          width: box.width,
        }}
      >
        <FrameHeader width={box.width}>
          {/* As tall as its text, as what follows it is, so the header centres both on one line. */}
          <span className={cn(HEADER_NAME, "h-auto text-foreground")}>
            {variation.name}
          </span>
          {varied ? (
            <span className="text-muted-foreground">{varied}</span>
          ) : null}
          {inUse ? (
            // Filled a step off the canvas, which shares the badge's own fill in the light theme.
            <Badge className="bg-foreground/8">In use</Badge>
          ) : null}
        </FrameHeader>
        <PreviewSurface
          canvas={canvas}
          // A page fills the box it is drawn in, as its frame does; a part is as big as it draws.
          className={cn(
            "absolute top-0 left-0",
            page ? "overflow-hidden" : "w-max"
          )}
          frameId={frameId}
          listeners={listeners}
          style={page ? { height: box.height, width: box.width } : undefined}
          title={variation.name}
        />
        <button
          aria-label={`Show ${variation.name}`}
          aria-pressed={shown}
          className="absolute inset-0 h-full w-full cursor-default"
          onClick={(e) => clickVariation(variation.id, e.detail)}
          onDoubleClick={(e) => pickPart(e, frameId, box.width, variation.id)}
          onPointerDown={(e) => e.stopPropagation()}
          type="button"
        />
        <PartChrome frameId={frameId} variation={variation} />
      </div>
    );
  }
);
VariationFrame.displayName = "VariationFrame";

/**
 * A double-click inside a variation selects one of its parts, as on the canvas: the outermost
 * under the pointer below its root, then one deeper with each double-click on the part selected.
 */
const pickPart = (
  e: ReactMouseEvent<HTMLElement>,
  frameId: string,
  width: number,
  variation: string
) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const scale = rect.width / width || 1;
  const hits = frameOf(frameId).hitTest(
    (e.clientX - rect.left) / scale,
    (e.clientY - rect.top) / scale
  );
  // Under the pointer, the part one deeper than the one selected; else the outermost below the root.
  const part = useVariations.getState().open?.part;
  const at = part?.variation === variation ? hits.indexOf(part.node) : -1;
  const node = at < 0 ? (hits[1] ?? hits[0]) : (hits[at + 1] ?? hits[at]);
  // The double-click's clicks showed the variation: the preview goes back to what it was.
  clickUndone();
  if (node !== undefined) {
    selectPart({ node, variation });
  }
};

/**
 * The part selected in this variation: outlined, with the arrow on its edge, pointing at the page,
 * that puts it in the preview (Use in preview, or Add to preview where the preview lacks it), or
 * says why it cannot.
 */
const PartChrome = ({
  frameId,
  variation,
}: {
  frameId: string;
  variation: Variation;
}) => {
  const part = useVariations((s) =>
    s.open?.part?.variation === variation.id ? s.open.part : null
  );
  const open = useVariations((s) => s.open);
  const set = useVariations(openSet);
  // Worked out once per change: each put makes a tree of its own.
  const put = useMemo(
    () => (part && open && set ? partInPreview(open, set, part) : null),
    [part, open, set]
  );
  // Where the part is drawn, by the part it was measured for: measured once it is selected and
  // again as the frame draws.
  const [measured, setMeasured] = useState<{
    readonly node: string;
    readonly rect: FrameRect | null;
  } | null>(null);
  useEffect(() => {
    if (!part) {
      return;
    }
    const measure = () =>
      setMeasured({
        node: part.node,
        rect: frameOf(frameId).measure([part.node])[part.node] ?? null,
      });
    measure();
    return frameOf(frameId).listen({ rendered: measure, size: measure });
  }, [frameId, part]);
  const rect = measured?.node === part?.node ? (measured?.rect ?? null) : null;
  if (!(part && rect)) {
    return null;
  }
  // A part of the variation the preview shows whole has nowhere else to go: no arrow.
  const shownWhole = open !== null && partShown(open, part);
  const label = put?.how === "use" ? "Use in preview" : "Add to preview";
  return (
    <div
      className="pointer-events-none absolute"
      data-part={part.node}
      style={{
        height: rect.height,
        left: rect.x,
        outline: `${screenPx(1.5)} solid var(--selection)`,
        top: rect.y,
        width: rect.width,
      }}
    >
      <div
        className="pointer-events-auto absolute top-0 right-full pr-1"
        hidden={shownWhole}
        style={{ transform: UNZOOM, transformOrigin: "top right" }}
      >
        {put?.tree ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={label}
                  onClick={() => putPartInPreview(part)}
                  onPointerDown={(e) => e.stopPropagation()}
                  size="icon-sm"
                />
              }
            >
              <ArrowLeft />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ) : (
          // A disabled button takes no pointer: why it cannot is said beside it.
          <span className="flex items-center gap-1.5 whitespace-nowrap font-body-small text-muted-foreground">
            {put?.why}
            <Button aria-label={put?.why ?? label} disabled size="icon-sm">
              <ArrowLeft />
            </Button>
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * A take an agent has not handed in: a placeholder in the agent's colour while it is made (a light
 * passing through it, or a still outline under Calm or reduced motion, `useAgentSweeps`), or a red
 * box once its turn ended without it, which asks again on a click. What it is is said over it, as
 * a variation's name is, so a small thing's box holds nothing it could spill.
 */
const TakeBox = ({
  box,
  round,
}: {
  box: Box;
  /** The round it failed in; none while it is still coming. */
  round?: VariationRound | undefined;
}) => {
  const sweeps = useAgentSweeps();
  return (
    <div
      className={cn(
        "absolute",
        round && "bg-destructive/5",
        !round &&
          sweeps &&
          "animate-agent-sweep bg-[linear-gradient(100deg,color-mix(in_srgb,var(--agent)_6%,transparent)_20%,color-mix(in_srgb,var(--agent)_18%,transparent)_45%,color-mix(in_srgb,var(--agent)_6%,transparent)_70%)] bg-size-[250%_100%]"
      )}
      data-take={round ? "failed" : "coming"}
      style={{
        height: box.height,
        left: box.x,
        outlineColor: round ? "var(--destructive)" : "var(--agent)",
        outlineStyle: round ? "solid" : "dashed",
        outlineWidth: screenPx(1.5),
        top: box.y,
        width: box.width,
      }}
    >
      <FrameHeader width={box.width}>
        {round ? (
          <>
            <button
              className={cn(HEADER_NAME, "text-destructive hover:underline")}
              onClick={() => tryAgain(round)}
              onPointerDown={(e) => e.stopPropagation()}
              type="button"
            >
              Try again
            </button>
            <span className="text-muted-foreground">Did not come back</span>
          </>
        ) : (
          <span className={cn(HEADER_NAME, "text-agent")}>Coming…</span>
        )}
      </FrameHeader>
      {round ? (
        <button
          aria-label="Try again"
          className="absolute inset-0 h-full w-full cursor-pointer"
          onClick={() => tryAgain(round)}
          onPointerDown={(e) => e.stopPropagation()}
          type="button"
        />
      ) : null}
    </div>
  );
};

/** How far the scrim reaches each way from the canvas's origin: past any canvas, at any zoom. */
const SCRIM_REACH = 1_000_000;

/**
 * The rest of the canvas while a thing's variations are open (ADR 0098): faded back under the
 * canvas's own colour, so the variations are drawn on its ground wherever they lie, a neighbouring
 * page included. A click on it closes them, the one in use kept, as Escape does, and selects
 * nothing under it; it pans as the canvas does. It closes on its own click, not on the press: a
 * scrim gone at the press would leave the release, and a browser's click after it, to what lies
 * under it, which would select it.
 */
const Scrim = ({ board }: { board: boolean }) => (
  <div
    aria-hidden
    className={cn(
      "fade-in-0 absolute animate-in duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none",
      board ? "bg-board/95" : "bg-canvas/95"
    )}
    data-variations-scrim=""
    onClick={() => {
      if (!pansAnywhere(useEditor.getState())) {
        closeVariations();
      }
    }}
    // The press is the scrim's, not the canvas's marquee; a pan's goes on to the canvas.
    onPointerDown={(e) => {
      if (e.button === 0 && !pansAnywhere(useEditor.getState())) {
        e.stopPropagation();
      }
    }}
    style={{
      height: 2 * SCRIM_REACH,
      left: -SCRIM_REACH,
      top: -SCRIM_REACH,
      width: 2 * SCRIM_REACH,
      zIndex: CHOOSING_LIFT.scrim,
    }}
  />
);

/** The keys of an agent's takes laid out after the variations: those coming, then those failed. */
const useTakeKeys = () => {
  const coming = useVariations((s) => takesOfOpen(s).coming);
  const failed = useVariations(useShallow((s) => takesOfOpen(s).failed));
  return useMemo(() => {
    const keys: { key: string; round?: VariationRound }[] = [];
    for (let i = 0; i < coming; i += 1) {
      keys.push({ key: `coming:${i}` });
    }
    for (const round of failed) {
      round.takes.forEach((take, i) => {
        if (take.state === "failed") {
          keys.push({ key: `failed:${round.id}:${i}`, round });
        }
      });
    }
    return keys;
  }, [coming, failed]);
};

/**
 * The open thing's variations, beside its page on the page canvas; beside its board, `board`,
 * on a component's board view, where its main tree is drawn (ADR 0098).
 */
export const VariationsBeside = ({
  board,
}: {
  board?: { readonly box: Box; readonly frameId: string };
}) => {
  const open = useVariations((s) => s.open);
  const set = useVariations(openSet);
  const frameBox = useFrameBox(board || !open ? null : open.frame);
  const onBoard = board && open?.frame === board.frameId ? board.box : null;
  const page = board ? onBoard : frameBox;
  const rect = useEditor((s) =>
    open && !board ? s.rects[open.frame]?.[open.node] : undefined
  );
  const docs = useDocuments((s) => s.docs);
  const at = useFrameBreakpoint(board || !open ? null : open.frame);
  const components = useComponents((s) => s.components);
  const docRoot = open ? rootOfDocument(docs, components, open.doc) : null;
  // By each variation's frame, which names its thing: two things' variations share ids.
  const [drawnHeights, setHeights] = useState<Record<string, number>>({});
  const onHeight = useMemo(
    () => (frame: string, height: number) =>
      setHeights((h) => (h[frame] === height ? h : { ...h, [frame]: height })),
    []
  );
  // A page's own root is drawn as a page; a component's main tree as wide as it draws.
  const whole = open !== null && docRoot?.id === open.node;
  const isPage = whole && componentOfDoc(open.doc) === null;
  // The thing on the canvas: its rect in its frame, or the whole frame for the frame's own.
  const thing: Box | null =
    page && rect && !whole
      ? { ...rect, x: page.x + rect.x, y: page.y + rect.y }
      : page;
  const ids = useMemo(() => set?.variations.map((v) => v.id) ?? [], [set]);
  const varied = useMemo(() => variedOnce(set?.variations ?? []), [set]);
  const takes = useTakeKeys();
  const heights = open ? heightsOf(open, ids, drawnHeights) : {};
  const boxes =
    page && thing
      ? besideBoxes(page, thing, [...ids, ...takes.map((t) => t.key)], heights)
      : undefined;

  // Open, selecting something closes them.
  const isOpen = open !== null;
  useEffect(() => (isOpen ? closeOnSelecting() : undefined), [isOpen]);

  // Opened, the camera fits the page, or the board, and its variations; again once they are all
  // measured, as tall as they draw, and not after, so a move of the camera is left as it is.
  const key = open ? `${open.doc}/${open.node}` : null;
  const measured = ids.length > 0 && ids.every((id) => id in heights);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per thing opened, and once measured.
  useEffect(() => {
    if (key !== null && page && boxes) {
      zoomToBoxes([page, ...Object.values(boxes)]);
    }
  }, [key, measured]);

  if (!(open && set && page && boxes)) {
    return null;
  }
  return (
    <>
      <Scrim board={board !== undefined} />
      {/* Over the scrim, at the canvas's origin as the frames are. */}
      <div
        className="absolute top-0 left-0"
        style={{ zIndex: CHOOSING_LIFT.variations }}
      >
        {set.variations.map((variation) => {
          const box = boxes[variation.id];
          return box ? (
            <VariationFrame
              at={at}
              box={box}
              frameId={variationFrameOf(open, variation.id)}
              inPage={thing ?? box}
              inUse={variation.id === set.inUse}
              key={variation.id}
              onHeight={onHeight}
              page={isPage}
              pageWidth={page.width}
              shown={variation.id === open.preview}
              sized={!whole}
              tree={
                variation.id === set.inUse
                  ? findNode(docRoot, open.node)
                  : (variation.tree ?? null)
              }
              variation={variation}
              varied={varied[variation.id]}
            />
          ) : null;
        })}
        {takes.map(({ key: take, round }) => {
          const box = boxes[take];
          return box ? <TakeBox box={box} key={take} round={round} /> : null;
        })}
      </div>
    </>
  );
};
