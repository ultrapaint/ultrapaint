import type { HostMessage, Rect } from "@ultrapaint/contracts/preview";
import { MousePointerClick } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { IconButton } from "../components/icon-button.tsx";
import { linkedNodesOf } from "../lib/links.ts";
import { useDocuments } from "../state/documents.ts";
import { bridgeFor } from "./bridge.ts";

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
 * What the prototype's preview says about presses: one that landed on no linked node shows
 * what can be pressed.
 */
export const onPrototypePress = (msg: HostMessage, page: string | null) => {
  if (msg.type !== "ed:pressed") {
    return;
  }
  const linked = new Set(linkedNodesOf(page));
  if (!msg.nodeIds.some((id) => linked.has(id))) {
    flash();
  }
};

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: the page's document is what has links.
  useEffect(() => {
    const bridge = bridgeFor(frameId);
    const ids = linkedNodesOf(page);
    bridge.watchRects(ids);
    const off = bridge.on((msg: HostMessage) => {
      if (msg.type === "ed:ready") {
        bridge.watchRects(ids);
      }
      if (msg.type === "ed:rects") {
        setRects(msg.rects);
      }
    });
    return () => {
      off();
      bridge.watchRects([]);
    };
  }, [frameId, page, root]);

  if (!visible) {
    return null;
  }
  // What was measured for the page shown before stays until the preview measures again.
  const current = new Set(linkedNodesOf(page));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {Object.entries(rects)
        .filter(([id]) => current.has(id))
        .map(([id, rect]) => (
          <span
            className="absolute rounded-sm bg-sky-500/20 ring-2 ring-sky-500/80 transition-opacity"
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

/** The prototype bar's switch that keeps the hotspots up. */
export const HotspotsToggle = () => {
  const shown = useHotspots((s) => s.shown);
  return (
    <IconButton
      aria-pressed={shown}
      className="size-8 rounded-lg aria-pressed:bg-muted aria-pressed:text-sky-500"
      onClick={() => useHotspots.getState().toggle()}
      tooltip={shown ? "Hide what can be pressed" : "Show what can be pressed"}
    >
      <MousePointerClick />
    </IconButton>
  );
};
