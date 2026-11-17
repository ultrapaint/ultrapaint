/**
 * A thing's variations laid out beside its page (ADR 0098), while they are open: each drawn
 * straight on the canvas background, with no card around it, its name and what it varied over
 * it, the one in use marked. A click shows it in the preview, the thing in its page. Opening them
 * fits the camera to the page and its variations. After them, an agent's takes still coming are
 * placeholders in its colour, and those that failed red boxes with Try again.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import { componentOfDoc } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type {
  Variation,
  VariationRound,
} from "@ultrapaint/contracts/variations";
import { findNode } from "@ultrapaint/design-document/tree";
import { memo, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { tryAgain } from "../lib/ask-variations.ts";
import { zoomToBoxes } from "../state/camera.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { canvasNodes, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import { nodeFrameLayout } from "../state/page-layout.ts";
import {
  besideBoxes,
  closeOnSelecting,
  type OpenVariations,
  openSet,
  rootOfDocument,
  showVariation,
  sizedAsInPage,
  takesOfOpen,
  useVariations,
} from "../state/variations.ts";
import { screenPx } from "./camera.ts";
import { useFrameDrawing } from "./editor-frame.ts";
import { FrameHeader, HEADER_NAME } from "./frame.tsx";
import { pageRequest } from "./page-request.ts";
import { PreviewSurface } from "./preview-surface.tsx";

/** The frame a variation is drawn in: none of the page canvas's frames. */
const variationFrameOf = (open: OpenVariations, variation: string) =>
  `variation:${open.doc}/${open.node}/${variation}`;

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
  }: {
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
  }) => {
    const designSystem = useDesignSystem((s) => s.designSystem);
    const defaults = useEditor((s) => s.layout.defaults);
    const canvas = useEditor((s) => s.canvas) ?? "";
    // A part is drawn as its parent sizes it in its page; a page fills its own.
    const { height, width } = inPage;
    const root = useMemo(
      () => (tree && sized ? sizedAsInPage(tree, { height, width }) : tree),
      [tree, sized, height, width]
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
          <span className={cn(HEADER_NAME, "text-foreground")}>
            {variation.name}
          </span>
          {variation.varied ? (
            <span className="text-muted-foreground">{variation.varied}</span>
          ) : null}
          {inUse ? <Badge variant="outline">In use</Badge> : null}
        </FrameHeader>
        <PreviewSurface
          canvas={canvas}
          className="absolute top-0 left-0 w-max"
          frameId={frameId}
          listeners={listeners}
          title={variation.name}
        />
        <button
          aria-label={`Show ${variation.name}`}
          aria-pressed={shown}
          className="absolute inset-0 h-full w-full cursor-default"
          onClick={() => showVariation(variation.id)}
          onPointerDown={(e) => e.stopPropagation()}
          type="button"
        />
      </div>
    );
  }
);
VariationFrame.displayName = "VariationFrame";

/**
 * A take an agent has not handed in: a placeholder in the agent's colour while it is made, or a
 * red box once its turn ended without it, which asks again on a click. What it is is said over
 * it, as a variation's name is, so a small thing's box holds nothing it could spill.
 */
const TakeBox = ({
  box,
  round,
}: {
  box: Box;
  /** The round it failed in; none while it is still coming. */
  round?: VariationRound | undefined;
}) => (
  <div
    className={cn(
      "absolute",
      round
        ? "bg-destructive/5"
        : "animate-agent-sweep bg-[linear-gradient(100deg,color-mix(in_srgb,var(--agent)_6%,transparent)_20%,color-mix(in_srgb,var(--agent)_18%,transparent)_45%,color-mix(in_srgb,var(--agent)_6%,transparent)_70%)] bg-size-[250%_100%]"
    )}
    data-take={round ? "failed" : "coming"}
    style={{
      height: box.height,
      left: box.x,
      outline: `${screenPx(1.5)} ${round ? "solid var(--destructive)" : "dashed var(--agent)"}`,
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
      {set.variations.map((variation) => {
        const box = boxes[variation.id];
        return box ? (
          <VariationFrame
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
          />
        ) : null;
      })}
      {takes.map(({ key: take, round }) => {
        const box = boxes[take];
        return box ? <TakeBox box={box} key={take} round={round} /> : null;
      })}
    </>
  );
};
