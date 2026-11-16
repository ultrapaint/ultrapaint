/**
 * A thing's variations laid out beside its page (ADR 0098), while they are open: each drawn
 * straight on the canvas background, with no card around it, its name and what it varied over
 * it, the one in use marked. A click shows it in the preview, the thing in its page. Opening them
 * fits the camera to the page and its variations.
 */
import type { Box } from "@ultrapaint/contracts/canvas-layout";
import { componentOfDoc } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Variation } from "@ultrapaint/contracts/variations";
import { findNode } from "@ultrapaint/design-document/tree";
import { memo, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { zoomToBoxes } from "../state/camera.ts";
import { useComponents } from "../state/components.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { canvasNodes, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import { nodeFrameLayout } from "../state/page-layout.ts";
import {
  besideBoxes,
  type OpenVariations,
  openSet,
  rootOfDocument,
  showVariation,
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
    onHeight,
    page,
    shown,
    sized,
    tree,
    variation,
  }: {
    box: Box;
    frameId: string;
    inUse: boolean;
    onHeight: (id: string, height: number) => void;
    /** It is a whole page, drawn at the page's width. */
    page: boolean;
    shown: boolean;
    /** It is a part of its page, drawn at the thing's width there. */
    sized: boolean;
    tree: DesignNode | null;
    variation: Variation;
  }) => {
    const designSystem = useDesignSystem((s) => s.designSystem);
    const defaults = useEditor((s) => s.layout.defaults);
    const canvas = useEditor((s) => s.canvas) ?? "";
    // A part is drawn at the thing's width; a page fills its own.
    const root = useMemo(
      () =>
        tree && sized && typeof tree.width !== "number"
          ? ({ ...tree, width: box.width } as DesignNode)
          : tree,
      [tree, sized, box.width]
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
            width: page ? box.width : undefined,
          }),
        [defaults, designSystem, page, root, box.width]
      )
    );
    const listeners = useMemo(
      () => ({
        size: (size: { height: number; width: number }) =>
          onHeight(variation.id, size.height),
      }),
      [onHeight, variation.id]
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
  const [heights, setHeights] = useState<Record<string, number>>({});
  const onHeight = useMemo(
    () => (id: string, height: number) =>
      setHeights((h) => (h[id] === height ? h : { ...h, [id]: height })),
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
  const boxes =
    page && thing ? besideBoxes(page, thing, ids, heights) : undefined;

  // Opened, the camera fits the page, or the board, and its variations.
  const key = open ? `${open.doc}/${open.node}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per thing opened, as first laid out.
  useEffect(() => {
    if (key !== null && page && boxes) {
      zoomToBoxes([page, ...Object.values(boxes)]);
    }
  }, [key]);

  if (!(open && set && boxes)) {
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
            inUse={variation.id === set.inUse}
            key={variation.id}
            onHeight={onHeight}
            page={isPage}
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
    </>
  );
};
