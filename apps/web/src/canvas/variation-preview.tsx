/**
 * The variation preview on the canvas (ADR 0098): the thing in its page, outlined dashed while
 * it shows another than the variation in use, with its controls hanging under its bottom-left
 * edge as the agent's ✦ hangs off a selection's top-left: Done while it is the one in use; Reset
 * and Use this once it differs, after what it is made of when it mixes several; while an agent
 * makes more, how many are coming.
 * Drawn in the frame's own pixels, at their size on screen whatever the zoom.
 */
import type { Rect } from "@ultrapaint/contracts/preview";
import { CornerDownLeft } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { kindColor } from "../lib/selection-kind.ts";
import { useEditor } from "../state/editor.ts";
import { reportError } from "../state/project.ts";
import {
  closeVariations,
  previewDiffers,
  previewName,
  putPreviewInUse,
  resetPreview,
  takesOfOpen,
  useVariations,
} from "../state/variations.ts";
import { screenPx, useExactInv } from "./camera.ts";

/**
 * How the canvas stacks while a thing's variations are open (ADR 0098): a scrim over every frame,
 * a comment card's included (`CARD_LIFT`, 40), fading the rest of the canvas back; the variations
 * over it; and the thing's page over them, so its preview's controls are never covered.
 */
export const CHOOSING_LIFT = { page: 52, scrim: 50, variations: 51 } as const;

/** Where the open thing is in a frame: its rect, or the whole frame for the frame's own node. */
const useThingRect = (
  frameId: string,
  frame: { height: number; width: number }
): Rect | null => {
  const open = useVariations((s) =>
    s.open?.frame === frameId ? s.open : null
  );
  const rect = useEditor((s) =>
    open ? s.rects[frameId]?.[open.node] : undefined
  );
  if (!open) {
    return null;
  }
  return rect ?? { height: frame.height, width: frame.width, x: 0, y: 0 };
};

/**
 * The preview's controls: Done, or Reset and Use this, after what the preview is made of when it
 * holds parts of several. One variation alone is named over it beside the page, outlined.
 */
export const PreviewControls = () => {
  const differs = useVariations(previewDiffers);
  // What the preview is made of, said only of a mix (ADR 0098).
  const mixed = useVariations((s) => (s.open?.mix ?? null) !== null);
  const name = useVariations(previewName);
  // An agent's takes still being made (ADR 0098).
  const coming = useVariations((s) => takesOfOpen(s).coming);
  return (
    <div
      className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      data-variation-controls=""
    >
      {coming > 0 ? (
        <span className="px-1.5 font-body-small text-muted-foreground">
          {coming} more coming
        </span>
      ) : null}
      {differs ? (
        <>
          {mixed ? (
            <span className="px-1.5 font-body-small text-muted-foreground">
              {name}
            </span>
          ) : null}
          <Button onClick={resetPreview} size="sm" variant="ghost">
            Reset
          </Button>
          <Button
            onClick={() => putPreviewInUse().catch(reportError)}
            size="sm"
          >
            Use this
            <Kbd className="text-primary-foreground/80 ring-primary-foreground/30">
              <CornerDownLeft />
            </Kbd>
          </Button>
        </>
      ) : (
        <Button onClick={closeVariations} size="sm" variant="ghost">
          Done
        </Button>
      )}
    </div>
  );
};

/** The open thing's outline and controls in the frame its preview is drawn in. */
export const VariationPreviewChrome = ({
  frame,
  frameId,
}: {
  frame: { height: number; width: number };
  frameId: string;
}) => {
  const rect = useThingRect(frameId, frame);
  const differs = useVariations(previewDiffers);
  const ref = useRef<HTMLDivElement>(null);
  useExactInv(ref);
  if (!rect) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute z-30"
      data-variation-preview=""
      ref={ref}
      style={{
        height: rect.height,
        left: rect.x,
        outlineColor: kindColor("element"),
        outlineStyle: differs ? "dashed" : "none",
        outlineWidth: screenPx(1.5),
        top: rect.y,
        width: rect.width,
      }}
    >
      <div
        className="pointer-events-auto absolute top-full left-0"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          marginTop: screenPx(4),
          transform: "scale(var(--inv))",
          transformOrigin: "top left",
        }}
      >
        <PreviewControls />
      </div>
    </div>
  );
};
