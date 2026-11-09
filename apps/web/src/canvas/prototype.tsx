import { presetSize } from "@ultrapaint/contracts/pages";
import { basePathOf } from "@ultrapaint/shared/route";
import {
  ArrowLeft,
  ArrowRight,
  type LucideIcon,
  MessageCircle,
  Monitor,
  PanelsTopLeft,
  RotateCw,
  Smartphone,
  Tablet,
  TriangleAlert,
} from "lucide-react";
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
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
import { useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { pagesOfCanvas, useEditor } from "../state/editor.ts";
import { goTo } from "../state/location.ts";
import { useProject } from "../state/project.ts";
import { commentCursor, FrameComments, placeComment } from "./comments.tsx";
import { useFrameDrawing, useFrameError } from "./editor-frame.ts";
import { HotspotLayer, HotspotsToggle, onPrototypePress } from "./hotspots.tsx";
import { pageRequest } from "./page-request.ts";
import { PreviewSurface } from "./preview-surface.tsx";

/** Room kept free around the page for the place switch at the top and the bar at the bottom. */
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

/** What the prototype says when no page serves the route the editor holds. */
const noPage = (route: string | null) =>
  route === null ? "No page" : `No page serves ${route}`;

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

/** A canvas with no pages: nothing to click through until one is drawn. */
const NoPages = () => (
  <div className="flex max-w-xs flex-col items-center gap-1 text-center">
    <PanelsTopLeft className="mb-2 size-5 text-muted-foreground" />
    <span className="font-body-medium">No pages to try</span>
    <span className="text-balance font-body-small text-muted-foreground">
      The prototype clicks through the pages of this canvas. Draw one first.
    </span>
    <Button
      className="mt-3"
      onClick={() => useEditor.getState().setWorkspace("design")}
      size="sm"
      variant="secondary"
    >
      Go to the canvas
    </Button>
  </div>
);

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
  const device = useDevice((s) => s.device);
  const [area, setArea] = useState({ height: 0, width: 0 });
  const [reloads, setReloads] = useState(0);
  const hasPages = canvas !== null && pages.some((p) => p.canvas === canvas);
  // What a part of the page threw and nothing caught, until it draws again.
  const pageError = useFrameError(canvas === null ? null : frameIdOf(canvas));

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

  // The frame only exists once the area is measured, which is after the first render.
  const shown = hasPages && canvas !== null && scale > 0;

  // The editor holds the route; the preview draws the page serving it, without reloading, as
  // it is at the device's width (its breakpoints' values, ADR 0036), in the design system.
  const document = useDocuments((s) =>
    activePage ? s.docs[activePage] : undefined
  );
  const designSystem = useDesignSystem((s) => s.designSystem);
  const defaults = useEditor((s) => s.layout.defaults);
  useFrameDrawing(
    shown ? frameIdOf(canvas) : null,
    pageRequest({
      absent: activePage ? undefined : noPage(route),
      defaults,
      designSystem,
      mode: "page",
      problem: document?.problem,
      root: document?.root ?? null,
      width: size.width,
    })
  );

  return (
    <div
      // Shown in the layer that floats over the canvas, which passes clicks through: the page
      // itself takes them.
      className="pointer-events-auto relative flex h-full w-full items-center justify-center overflow-hidden bg-canvas"
      onPointerDown={closeComments}
      ref={ref}
      style={{ paddingBottom: inset.bottom, paddingTop: inset.top }}
    >
      {shown ? (
        <div
          className="relative shrink-0"
          style={{ height: size.height * scale, width: size.width * scale }}
        >
          {/* The device's screen: the page on white, edged with a hairline in either theme. */}
          <div className="relative h-full w-full overflow-hidden rounded-lg bg-white shadow-floating ring-1 ring-black/8 dark:ring-white/8">
            {canvas === null ? null : (
              <PreviewSurface
                canvas={canvas}
                className="origin-top-left bg-white"
                frameId={frameIdOf(canvas)}
                interactive
                // A reload draws the page anew, from the route the editor holds.
                key={`${canvas}:${reloads}`}
                listeners={{
                  navigateTo: (to, replace) =>
                    followLink(to, { push: !replace }),
                  pressed: (nodeIds) =>
                    onPrototypePress(nodeIds, useEditor.getState().activePage),
                }}
                style={{
                  height: size.height,
                  transform: `scale(${scale})`,
                  width: size.width,
                }}
                title={title}
              />
            )}
            {pageError ? (
              <div
                className="absolute inset-x-0 bottom-0 flex max-h-40 flex-col gap-1 overflow-auto border-destructive/40 border-t bg-popover px-3 py-2.5 text-popover-foreground"
                role="alert"
              >
                <span className="flex items-center gap-1.5 font-body-medium">
                  <TriangleAlert className="size-4 shrink-0 text-destructive" />
                  Part of this page failed to draw
                </span>
                <pre className="select-text whitespace-pre-wrap font-code text-muted-foreground">
                  {pageError.message}
                </pre>
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
      ) : null}
      {hasPages ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center px-2">
          <PrototypeControls />
        </div>
      ) : (
        <NoPages />
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
 * The page a page without a URL is a variant of, or the page itself: what the address says has
 * no URL. Null while the prototype shows a URL, or a page that has one.
 */
const useNoUrlPage = () => {
  const activePage = useEditor((s) => s.activePage);
  const route = useEditor((s) => s.route);
  const page = useProject((s) => s.pages.find((p) => p.id === activePage));
  if (route !== null || !page || page.route !== undefined) {
    return null;
  }
  return (
    pagesOfCanvas(page.canvas).find(
      (p) => p.variant === undefined && p.path === basePathOf(page.path)
    ) ?? page
  );
};

/**
 * The prototype's address, as a browser's: the URL the editor holds, which can be typed over
 * and followed with Enter, Escape putting it back. A page without a URL says so in its place:
 * it can be looked at, but nothing in the click-through leads to it.
 */
const AddressField = () => {
  const route = useEditor((s) => s.route);
  const noUrl = useNoUrlPage();
  const [draft, setDraft] = useState<string | null>(null);
  const go = (e: FormEvent) => {
    e.preventDefault();
    const to = draft?.trim();
    setDraft(null);
    if (to && to !== route) {
      followLink(to, { push: true });
    }
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const field = (
    <form
      className="group/address mx-1 flex h-8 w-64 min-w-0 shrink items-center gap-1.5 rounded-lg border border-transparent bg-muted px-2.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25 hover:border-input"
      onSubmit={go}
    >
      {noUrl ? (
        <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
      ) : null}
      <input
        aria-label="URL"
        className="min-w-0 flex-1 bg-transparent font-code outline-none placeholder:font-body-small placeholder:text-muted-foreground"
        onBlur={() => setDraft(null)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        placeholder={noUrl ? `${noUrl.name} has no URL` : "/"}
        spellCheck={false}
        value={draft ?? route ?? ""}
      />
    </form>
  );
  if (!noUrl || draft !== null) {
    return field;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="flex min-w-0" />}>
        {field}
      </TooltipTrigger>
      <TooltipContent className="max-w-64" side="top">
        {NO_URL_HINT}
      </TooltipContent>
    </Tooltip>
  );
};

const DEVICE_ICON: Record<PrototypeDevice, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

/** The device the page is tried on, one always picked. */
const DeviceSwitch = () => {
  const device = useDevice((s) => s.device);
  return (
    <ToggleGroup
      aria-label="Device"
      onValueChange={pickDevice}
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
                  className="size-8 rounded-lg text-muted-foreground data-pressed:bg-accent data-pressed:text-foreground"
                  value={d.value}
                >
                  <Icon />
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="top">
              {d.label}
              <span className="tabular-nums opacity-70">{d.description}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
};

const BarDivider = () => (
  <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-input" />
);

/**
 * The prototype's bar, at the bottom of it where the canvas has its tools: the history and a
 * restart, the address, the variant it clicks through when the canvas has variants, the device it
 * is tried on, then what can be pressed and commenting. The page it is on is picked in the left
 * panel too.
 */
const PrototypeControls = () => {
  const canvas = useEditor((s) => s.canvas);
  const variant = useEditor((s) => s.variant);
  const commenting = useEditor((s) => s.mode === "comment");
  const variants = useProject(
    (s) => s.canvases.find((c) => c.id === canvas)?.variants ?? NO_VARIANTS
  );
  const pickVariant = (next: string) =>
    goTo({ variant: next === BASE ? null : next });

  return (
    <div
      aria-label="Prototype"
      className="floating pointer-events-auto flex min-w-0 items-center gap-0.5 p-1"
      role="toolbar"
    >
      <IconButton
        className="size-8 rounded-lg"
        onClick={back}
        side="top"
        tooltip="Back"
      >
        <ArrowLeft />
      </IconButton>
      <IconButton
        className="size-8 rounded-lg"
        onClick={forward}
        side="top"
        tooltip="Forward"
      >
        <ArrowRight />
      </IconButton>
      <IconButton
        className="size-8 rounded-lg"
        disabled={canvas === null}
        onClick={reload}
        side="top"
        tooltip="Restart"
      >
        <RotateCw />
      </IconButton>
      <AddressField />
      {variants.length > 0 ? (
        <div className="w-32 shrink-0 pl-1">
          <OptionSelect
            className="h-8 rounded-lg"
            onChange={pickVariant}
            options={[
              { label: "No variant", value: BASE },
              ...variants.map((v) => ({ label: v, value: v })),
            ]}
            value={variant ?? BASE}
          />
        </div>
      ) : null}
      <BarDivider />
      <DeviceSwitch />
      <BarDivider />
      <HotspotsToggle />
      <IconButton
        aria-pressed={commenting}
        className="size-8 rounded-lg aria-pressed:bg-brand aria-pressed:text-brand-foreground aria-pressed:hover:bg-brand/90"
        disabled={canvas === null}
        label="Comment"
        onClick={toggleCommenting}
        side="top"
        tooltip={
          <>
            {commenting ? "Stop commenting" : "Comment"} <Kbd>C</Kbd>
          </>
        }
      >
        <MessageCircle />
      </IconButton>
    </div>
  );
};

/*
 * The prototype draws its own bar now, at the bottom centre where the canvas has its tools; the
 * column of tools beside the left card and the warning over the bar are part of it. These stay
 * until the shell stops placing them.
 */
