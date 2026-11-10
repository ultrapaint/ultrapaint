import type { DesignNode } from "@ultrapaint/contracts/document";
import type { Rect } from "@ultrapaint/contracts/preview";
import { linksIn } from "@ultrapaint/shared/link";
import { MousePointerClick } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { IconButton } from "../components/icon-button.tsx";
import { linkedNodesOf } from "../lib/links.ts";
import { useDocuments } from "../state/documents.ts";
import { frameOf } from "./editor-frame.ts";

const SHOWN_KEY = "ultrapaint:hotspots";
/** How long the hotspots stay up after a press that led nowhere. */
const FLASH_MS = 700;

interface HotspotsStore {
  /** Up for a moment after a press that led nowhere, as Figma's prototype does. */
  flashing: boolean;
  /** Always shown, by choice. */
  shown: boolean;
  toggle: () => void;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;

const useHotspots = create<HotspotsStore>((set, get) => ({
  flashing: false,
  shown: localStorage.getItem(SHOWN_KEY) === "true",
  toggle: () => {
    const shown = !get().shown;
    localStorage.setItem(SHOWN_KEY, String(shown));
    set({ shown });
  },
}));

const flash = () => {
  if (flashTimer) {
    clearTimeout(flashTimer);
  }
  useHotspots.setState({ flashing: true });
  flashTimer = setTimeout(() => {
    flashTimer = null;
    useHotspots.setState({ flashing: false });
  }, FLASH_MS);
};

/**
 * A press in the prototype's page, on these nodes outermost first: one that landed on no linked
 * node shows what can be pressed.
 */
export const onPrototypePress = (
  nodeIds: readonly string[],
  page: string | null
) => {
  const linked = new Set(linkedNodesOf(page));
  if (!nodeIds.some((id) => linked.has(id))) {
    flash();
  }
};

/** Every linked node of a document's tree, none while it is not read yet. */
const linkedIn = (root: DesignNode | null | undefined): string[] =>
  linksIn(root).map((link) => link.nodeId);

/**
 * The parts of the page on screen that lead somewhere, drawn over the prototype at its scale:
 * always when they are asked for, for a moment after a press that led nowhere. The preview
 * measures them, and measures again as the page scrolls.
 */
export const HotspotLayer = ({
  frameId,
  page,
  scale,
}: {
  frameId: string;
  page: string | null;
  scale: number;
}) => {
  const visible = useHotspots((s) => s.shown || s.flashing);
  const root = useDocuments((s) => (page ? s.docs[page]?.root : undefined));
  const [rects, setRects] = useState<Record<string, Rect>>({});

  useEffect(() => {
    // Watched from now on, by the frame open now and the one opened after a reload.
    const frame = frameOf(frameId);
    frame.watchRects(linkedIn(root));
    const off = frame.listen({ rects: setRects });
    return () => {
      off();
      frame.watchRects([]);
    };
  }, [frameId, root]);

  if (!visible) {
    return null;
  }
  // What was measured for the page shown before stays until the preview measures again.
  const current = new Set(linkedIn(root));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {Object.entries(rects)
        .filter(([id]) => current.has(id))
        .map(([id, rect]) => (
          <span
            className="absolute rounded-sm bg-selection/15 ring-2 ring-selection"
            key={id}
            style={{
              height: rect.height * scale,
              left: rect.x * scale,
              top: rect.y * scale,
              width: rect.width * scale,
            }}
          />
        ))}
    </div>
  );
};

/** The prototype's switch that keeps the hotspots up. */
export const HotspotsToggle = () => {
  const shown = useHotspots((s) => s.shown);
  return (
    <IconButton
      aria-pressed={shown}
      className="size-8 rounded-lg aria-pressed:bg-accent aria-pressed:text-foreground"
      label="Show hotspots"
      onClick={() => useHotspots.getState().toggle()}
      side="top"
      tooltip={shown ? "Hide hotspots" : "Show hotspots"}
    >
      <MousePointerClick />
    </IconButton>
  );
};
