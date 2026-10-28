import { presetSize } from "@ultrapaint/contracts/pages";
import { resolveAt } from "@ultrapaint/design-document/breakpoints";
import { basePathOf } from "@ultrapaint/shared/route";
import { cn } from "cn";
import {
  ArrowLeft,
  ArrowRight,
  type LucideIcon,
  MessageCircle,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
  TriangleAlert,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { followLink } from "../lib/links.ts";
import { NO_URL_HINT } from "../lib/page-actions.ts";
import {
  type PrototypeDevice,
  parseDevice,
  prototypeDevices,
} from "../lib/presets.ts";
import { toggleCommenting, useComments } from "../state/comments.ts";
import { breakpointsFor, useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { pagesOfCanvas, useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { useDesignLookVersion } from "../state/look.ts";
import { useProject } from "../state/project.ts";
import { commentCursor, FrameComments, placeComment } from "./comments.tsx";
import { frameOf } from "./editor-frame.ts";
import { formatHostError } from "./frame.tsx";
import { HotspotLayer, HotspotsToggle, onPrototypePress } from "./hotspots.tsx";
import { usePreview } from "./preview-module.ts";
import { PreviewSurface } from "./preview-surface.tsx";

/** Room kept free around the page for the cards at the top and the bottom strip. */
const inset = { bottom: 72, side: 32, top: 64 };

/** Asks the prototype to draw its page anew, which restarts the canvas from its current route. */
const RELOAD_EVENT = "ultrapaint:reload-prototype";

const DEVICE_KEY = "ultrapaint:prototype-device";

/**
 * The device the prototype is tried on. It sizes the preview alone, never the page's frame: a
 * design drawn for the desktop can be clicked through on a phone without being redrawn. A
 * preference of this browser, kept across reloads.
 */
const useDevice = create<{
  device: PrototypeDevice;
  setDevice: (device: PrototypeDevice) => void;
}>((set) => ({
  device: parseDevice(localStorage.getItem(DEVICE_KEY)),
  setDevice: (device) => {
    localStorage.setItem(DEVICE_KEY, device);
    set({ device });
  },
}));

const pickDevice = (next: readonly unknown[]) => {
  // Pressing the device already on keeps it: one is always picked.
  if (typeof next[0] === "string") {
    useDevice.getState().setDevice(parseDevice(next[0]));
  }
};

/** The one frame of a prototype. Navigating swaps the page inside it, it is never drawn anew. */
export const frameIdOf = (canvas: string) => `prototype:${canvas}`;

/** Tells the prototype what the route shows: the page serving it, in the design system. */
const renderRoute = (canvas: string) => {
  const { activePage, route } = useEditor.getState();
  const state = activePage
    ? useDocuments.getState().docs[activePage]
    : undefined;
  let message: string | undefined;
  if (!activePage) {
    message = route === null ? "No page" : `No page serves ${route}`;
  } else if (state?.problem !== undefined) {
    message = `This page cannot be read: ${state.problem}`;
  }
  const { designSystem } = useDesignSystem.getState();
  const root = state?.root ?? null;
  // Drawn as the page is at the device's width: its breakpoints' values (ADR 0036).
  const { width } = presetSize[useDevice.getState().device];
  frameOf(frameIdOf(canvas)).render({
    defaults: useEditor.getState().layout.defaults,
    designSystem,
    mode: "page",
    root: root && resolveAt(root, breakpointsFor(designSystem), width),
    ...(message !== undefined && { message }),
  });
};

/** A press beside the page lets go of the comment open on it, or of the one being written. */
const closeComments = (e: ReactPointerEvent) => {
  if (e.target === e.currentTarget) {
    useComments.getState().setDraft(null);
    useComments.getState().setOpen(null);
  }
};

/**
 * The comments of the page the prototype shows, pinned where they were placed, and in comment
 * mode the sheet a click drops a new one on. Laid over the frame in the page's own pixels and
 * scaled as it is; the pins and cards are scaled back to keep their size, and are not clipped
 * by the page's edge, so a card near it can still be read.
 */
const PageComments = ({
  frame,
  height,
  scale,
  width,
}: {
  frame: string;
  height: number;
  scale: number;
  width: number;
}) => {
  const activePage = useEditor((s) => s.activePage);
  const commenting = useEditor((s) => s.mode === "comment");
  const page = useProject((s) => s.pages.find((p) => p.id === activePage));
  if (!page) {
    return null;
  }
  const place = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    placeComment(frame, page.id, {
      x: (e.clientX - r.left) / scale,
      y: (e.clientY - r.top) / scale,
    });
  };
  return (
    <div
      className="pointer-events-none absolute top-0 left-0 origin-top-left *:pointer-events-auto"
      style={{ height, transform: `scale(${scale})`, width }}
    >
      {commenting ? (
        <button
          aria-label={`Comment on ${page.name}`}
          className="absolute inset-0 h-full w-full"
          onClick={place}
          style={{ cursor: commentCursor }}
          type="button"
        />
      ) : null}
      <FrameComments inv={1 / scale} page={page} />
    </div>
  );
};

/**
 * The canvas at the size of the current page's frame, or of the device picked under it, scaled
 * down only when it does not fit, with clicks going to the page itself. The editor holds the
 * route: what a link inside asks for comes back out as a navigation, and the frame is told what
 * to show.
 */
export const Prototype = () => {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useEditor((s) => s.canvas);
  const route = useEditor((s) => s.route);
  const activePage = useEditor((s) => s.activePage);
  const pages = useProject((s) => s.pages);
  const title =
    route ?? pages.find((p) => p.id === activePage)?.name ?? "Prototype";
  const preview = usePreview();
  const device = useDevice((s) => s.device);
  const [area, setArea] = useState({ height: 0, width: 0 });
  const [reloads, setReloads] = useState(0);
  const hasPages = canvas !== null && pages.some((p) => p.canvas === canvas);
  const hostError = useEditor((s) =>
    canvas === null ? null : (s.hostErrors[frameIdOf(canvas)] ?? null)
  );

  useEffect(() => {
    const onReload = () => setReloads((n) => n + 1);
    window.addEventListener(RELOAD_EVENT, onReload);
    const el = ref.current;
    if (!el) {
      return () => window.removeEventListener(RELOAD_EVENT, onReload);
    }
    const measure = () =>
      setArea({ height: el.clientHeight, width: el.clientWidth });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => {
      window.removeEventListener(RELOAD_EVENT, onReload);
      ro.disconnect();
    };
  }, []);

  const size = presetSize[device];
  const scale = Math.min(
    1,
    (area.width - inset.side * 2) / size.width,
    (area.height - inset.top - inset.bottom) / size.height
  );

  let content: string | null = null;
  if (!hasPages) {
    content = "This canvas has no pages yet";
  } else if (!preview) {
    content = "Preview host not running";
  }
  // The frame only exists once the area is measured, which is after the first render.
  const shown = content === null && canvas !== null && scale > 0;

  // The editor holds the route; the preview draws the page serving it, without reloading.
  const document = useDocuments((s) =>
    activePage ? s.docs[activePage] : undefined
  );
  const designSystem = useDesignSystem((s) => s.designSystem);
  const defaults = useEditor((s) => s.layout.defaults);
  const look = useDesignLookVersion();
  // biome-ignore lint/correctness/useExhaustiveDependencies: what is drawn is the dependency.
  useEffect(() => {
    if (canvas !== null && shown && frameOf(frameIdOf(canvas)).ready) {
      renderRoute(canvas);
    }
  }, [route, canvas, shown, document, designSystem, defaults, device, ...look]);

  return (
    <div
      // Shown in the layer that floats over the canvas, which passes clicks through: the page
      // itself takes them.
      className="pointer-events-auto relative flex h-full w-full items-center justify-center overflow-hidden bg-background"
      onPointerDown={closeComments}
      ref={ref}
      style={{ paddingBottom: inset.bottom, paddingTop: inset.top }}
    >
      {shown ? (
        <div
          className="relative shrink-0"
          style={{ height: size.height * scale, width: size.width * scale }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-md bg-white shadow-2xl">
            {canvas === null ? null : (
              <PreviewSurface
                canvas={canvas}
                className="origin-top-left bg-white"
                frameId={frameIdOf(canvas)}
                interactive
                // A reload draws the page anew, from the route the editor holds.
                key={`${canvas}:${reloads}`}
                listeners={{
                  // What the page threw and nothing caught (a click's handler, a timer), until it
                  // draws again or its code changes.
                  error: (error) =>
                    useEditor
                      .getState()
                      .setHostError(frameIdOf(canvas), formatHostError(error)),
                  hmr: () =>
                    useEditor.getState().setHostError(frameIdOf(canvas), null),
                  navigateTo: (to, replace) =>
                    followLink(to, { push: !replace }),
                  pressed: (nodeIds) =>
                    onPrototypePress(nodeIds, useEditor.getState().activePage),
                  ready: () => renderRoute(canvas),
                  rendered: () =>
                    useEditor.getState().setHostError(frameIdOf(canvas), null),
                }}
                style={{
                  height: size.height,
                  transform: `scale(${scale})`,
                  width: size.width,
                }}
                title={title}
              />
            )}
            {hostError ? (
              <div className="absolute inset-x-0 bottom-0 flex items-start gap-2 bg-destructive/90 p-3 font-code text-white">
                <TriangleAlert className="size-4 shrink-0" />
                <pre className="whitespace-pre-wrap">{hostError}</pre>
              </div>
            ) : null}
            {canvas === null ? null : (
              <HotspotLayer
                frameId={frameIdOf(canvas)}
                key={`hotspots:${canvas}:${reloads}`}
                page={activePage}
                scale={scale}
              />
            )}
          </div>
          {canvas === null ? null : (
            <PageComments
              frame={frameIdOf(canvas)}
              height={size.height}
              scale={scale}
              width={size.width}
            />
          )}
        </div>
      ) : (
        <span className="text-muted-foreground">{content}</span>
      )}
    </div>
  );
};

const reload = () => window.dispatchEvent(new CustomEvent(RELOAD_EVENT));
// The editor's own history is the prototype's: every navigation put an entry in it.
const back = () => window.history.back();
const forward = () => window.history.forward();

const BASE = "";
/** A canvas's variants before the canvas is known: one list, so the store's answer is stable. */
const NO_VARIANTS: readonly string[] = [];

/**
 * Said over the bar while the prototype shows a page that serves no URL: it can be looked at, but
 * nothing in the click-through leads to it.
 */
export const NoUrlWarning = () => {
  const activePage = useEditor((s) => s.activePage);
  const route = useEditor((s) => s.route);
  const page = useProject((s) => s.pages.find((p) => p.id === activePage));
  if (route !== null || !page || page.route !== undefined) {
    return null;
  }
  const base =
    pagesOfCanvas(page.canvas).find(
      (p) => p.variant === undefined && p.path === basePathOf(page.path)
    ) ?? page;
  return (
    <div
      className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-xl border border-warning/40 bg-sidebar px-3 py-1.5 font-body text-sidebar-foreground shadow-black/30 shadow-lg"
      role="status"
      title={NO_URL_HINT}
    >
      <TriangleAlert className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 truncate">
        <span className="font-medium">{base.name}</span> has no URL: no link
        leads here.
      </span>
    </div>
  );
};

/**
 * Floating strip at the bottom of the prototype's column of tools: the canvas's history, a
 * restart, and the variant it clicks through when the canvas has variants. The page it is on is
 * picked in the left panel.
 */
export const PrototypeBar = () => {
  const canvas = useEditor((s) => s.canvas);
  const variant = useEditor((s) => s.variant);
  const variants = useProject(
    (s) => s.canvases.find((c) => c.id === canvas)?.variants ?? NO_VARIANTS
  );
  const pickVariant = (next: string) =>
    goTo({ variant: next === BASE ? null : next });

  return (
    <div className="floating pointer-events-auto flex items-center gap-1 p-1">
      <IconButton className="size-8 rounded-lg" onClick={back} tooltip="Back">
        <ArrowLeft />
      </IconButton>
      <IconButton
        className="size-8 rounded-lg"
        disabled={canvas === null}
        onClick={reload}
        tooltip="Restart the prototype"
      >
        <RotateCw />
      </IconButton>
      <IconButton
        className="size-8 rounded-lg"
        onClick={forward}
        tooltip="Forward"
      >
        <ArrowRight />
      </IconButton>
      {variants.length > 0 ? (
        <div className="w-32">
          <OptionSelect
            className="border-transparent bg-transparent dark:bg-transparent"
            onChange={pickVariant}
            options={[
              { label: "No variant", value: BASE },
              ...variants.map((v) => ({ label: v, value: v })),
            ]}
            value={variant ?? BASE}
          />
        </div>
      ) : null}
    </div>
  );
};

const DEVICE_ICON: Record<PrototypeDevice, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

/**
 * The prototype's tools, floating in a column beside the left panel as the canvas's are: what can
 * be pressed and commenting on the page, then, in a card of its own, the device it is tried on.
 * The app positions it.
 */
export const PrototypeTools = () => {
  const canvas = useEditor((s) => s.canvas);
  const commenting = useEditor((s) => s.mode === "comment");
  const device = useDevice((s) => s.device);
  return (
    <div className="flex flex-col gap-2">
      <div className="floating pointer-events-auto flex flex-col items-center gap-1 p-1">
        <HotspotsToggle />
        <IconButton
          aria-pressed={commenting}
          className={cn(
            "size-8 rounded-lg",
            commenting && "bg-brand text-brand-foreground hover:bg-brand/90"
          )}
          disabled={canvas === null}
          label={commenting ? "Stop commenting" : "Comment"}
          onClick={toggleCommenting}
          side="right"
          tooltip={
            <>
              {commenting ? "Stop commenting" : "Comment"} <Kbd>C</Kbd>
            </>
          }
        >
          <MessageCircle />
        </IconButton>
      </div>
      <div className="floating pointer-events-auto flex flex-col items-center p-1">
        <ToggleGroup
          aria-label="Device"
          onValueChange={pickDevice}
          orientation="vertical"
          spacing={0.5}
          value={[device]}
        >
          {prototypeDevices.map((d) => {
            const Icon = DEVICE_ICON[d.value];
            return (
              <Tooltip key={d.value}>
                <TooltipTrigger
                  render={
                    <ToggleGroupItem
                      aria-label={d.label}
                      className="size-8 rounded-lg data-pressed:bg-muted data-pressed:text-foreground"
                      value={d.value}
                    >
                      <Icon />
                    </ToggleGroupItem>
                  }
                />
                <TooltipContent side="right">
                  {d.label} · {d.description}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </div>
    </div>
  );
};
