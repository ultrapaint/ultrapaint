import type { HostMessage } from "@ultrapaint/contracts/preview";
import { basePathOf } from "@ultrapaint/shared/route";
import { cn } from "cn";
import {
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  RotateCw,
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
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { followLink } from "../lib/links.ts";
import { editPageUrl, NO_URL_HINT } from "../lib/page-actions.ts";
import {
  deviceSize,
  type PrototypeDevice,
  parseDevice,
  prototypeDevices,
} from "../lib/presets.ts";
import { toggleCommenting, useComments } from "../state/comments.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { pagesOfCanvas, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { bridgeFor, removeBridge } from "./bridge.ts";
import { commentCursor, FrameComments, placeComment } from "./comments.tsx";
import { useHostUrl } from "./frame.tsx";
import { HotspotLayer, HotspotsToggle, onPrototypePress } from "./hotspots.tsx";

/** Room kept free around the page for the workspace switcher and the bottom strip. */
const inset = { bottom: 72, side: 32, top: 64 };

/** Asks the prototype to reload its iframe, which restarts the canvas from its current route. */
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

const pickDevice = (value: string) =>
  useDevice.getState().setDevice(parseDevice(value));

/** The one iframe of a prototype. Navigating swaps the page inside it, it never reloads. */
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
  bridgeFor(frameIdOf(canvas)).render({
    designSystem: useDesignSystem.getState().designSystem,
    mode: "page",
    root: state?.root ?? null,
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
 * mode the sheet a click drops a new one on. Laid over the iframe in the page's own pixels and
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
 * route: what a link inside asks for comes back out as a navigation, and the iframe is told what
 * to show.
 */
export const Prototype = () => {
  const ref = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvas = useEditor((s) => s.canvas);
  const route = useEditor((s) => s.route);
  const activePage = useEditor((s) => s.activePage);
  const frame = useEditor((s) =>
    activePage ? s.frames[activePage] : undefined
  );
  const pages = useProject((s) => s.pages);
  const title =
    route ?? pages.find((p) => p.id === activePage)?.name ?? "Prototype";
  const hostUrl = useHostUrl();
  const device = useDevice((s) => s.device);
  const [area, setArea] = useState({ height: 0, width: 0 });
  const [reloads, setReloads] = useState(0);
  const hasPages = canvas !== null && pages.some((p) => p.canvas === canvas);

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

  const url =
    hostUrl && canvas !== null
      ? `${hostUrl}/?canvas=${encodeURIComponent(canvas)}&frame=${encodeURIComponent(frameIdOf(canvas))}`
      : null;

  const size = deviceSize(device, frame);
  const scale = Math.min(
    1,
    (area.width - inset.side * 2) / size.width,
    (area.height - inset.top - inset.bottom) / size.height
  );

  let content: string | null = null;
  if (!hasPages) {
    content = "This canvas has no pages yet";
  } else if (!hostUrl) {
    content = "Preview host not running";
  }
  // The iframe only exists once the area is measured, which is after the first render.
  const shown = content === null && url !== null && scale > 0;

  // `reloads` remounts the iframe, and `shown` mounts it in the first place: the bridge has to
  // be attached to whichever iframe is there, or its `ed:ready` goes unheard.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the remount is the dependency.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!(iframe && url && canvas !== null)) {
      return;
    }
    const frameId = frameIdOf(canvas);
    const bridge = bridgeFor(frameId);
    bridge.attach(iframe);
    const off = bridge.on((msg: HostMessage) => {
      if (msg.type === "ed:ready") {
        // Whatever the iframe started on, the editor says what it shows; and it is for clicking.
        renderRoute(canvas);
        bridge.setInteractive(true);
      }
      if (msg.type === "ed:navigateTo") {
        followLink(msg.route, { push: !msg.replace });
      }
      onPrototypePress(msg, useEditor.getState().activePage);
    });
    return () => {
      off();
      removeBridge(frameId);
    };
  }, [canvas, url, reloads, shown]);

  // The editor holds the route; the preview draws the page serving it, without reloading.
  const document = useDocuments((s) =>
    activePage ? s.docs[activePage] : undefined
  );
  const designSystem = useDesignSystem((s) => s.designSystem);
  // biome-ignore lint/correctness/useExhaustiveDependencies: what is drawn is the dependency.
  useEffect(() => {
    if (canvas !== null && url && bridgeFor(frameIdOf(canvas)).ready) {
      renderRoute(canvas);
    }
  }, [route, canvas, url, document, designSystem]);

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
            <iframe
              className="block origin-top-left border-0 bg-white"
              key={`${canvas}:${reloads}`}
              ref={iframeRef}
              src={url}
              style={{
                height: size.height,
                transform: `scale(${scale})`,
                width: size.width,
              }}
              title={title}
            />
            {canvas === null ? null : (
              <HotspotLayer
                frameId={frameIdOf(canvas)}
                // A reloaded iframe has a bridge of its own, which the layer has to listen to.
                key={`${canvas}:${reloads}`}
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
const NoUrlWarning = () => {
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
      className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-xl border border-warning/40 bg-sidebar py-1 pr-1 pl-3 text-sidebar-foreground text-xs shadow-black/30 shadow-lg"
      role="status"
      title={NO_URL_HINT}
    >
      <TriangleAlert className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 truncate">
        <span className="font-medium">{base.name}</span> has no URL: no link
        leads here.
      </span>
      <Button
        className="shrink-0"
        onClick={() => editPageUrl(base)}
        size="sm"
        variant="outline"
      >
        Set URL
      </Button>
    </div>
  );
};

/** How the bar names a page: where it is served, then what it is called. */
const pageOption = (page: {
  readonly id: string;
  readonly name: string;
  readonly route?: string | undefined;
}) => ({
  label:
    page.route === undefined
      ? `${page.name} · no URL`
      : `${page.route} · ${page.name}`,
  value: page.id,
});

/**
 * Floating strip under the prototype: the canvas's history, the page it is on, the variant it
 * clicks through when the canvas has variants, the device it is tried on, commenting on the page,
 * what can be pressed, and a restart. A page without a URL is on the list too, and says so over
 * the bar when it is shown.
 */
export const PrototypeBar = () => {
  const canvas = useEditor((s) => s.canvas);
  const activePage = useEditor((s) => s.activePage);
  const variant = useEditor((s) => s.variant);
  const commenting = useEditor((s) => s.mode === "comment");
  const device = useDevice((s) => s.device);
  const variants = useProject(
    (s) => s.canvases.find((c) => c.id === canvas)?.variants ?? NO_VARIANTS
  );
  // Subscribed to so the list follows a page being created, renamed or given a URL.
  useProject((s) => s.pages);
  const all = pagesOfCanvas(canvas);
  const bases = all
    .filter((p) => p.variant === undefined)
    .sort((a, b) => {
      if (a.route !== undefined && b.route !== undefined) {
        return a.route.localeCompare(b.route);
      }
      if (a.route !== undefined || b.route !== undefined) {
        return a.route === undefined ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });
  // A variant's page is shown as its base page, the one the list names.
  const shown = all.find((p) => p.id === activePage);
  const current = shown
    ? (bases.find((p) => p.path === basePathOf(shown.path))?.id ?? null)
    : null;
  const go = (id: string) => useEditor.getState().openPage(id);
  const pickVariant = (next: string) =>
    useEditor.getState().setVariant(next === BASE ? null : next);

  return (
    <>
      <NoUrlWarning />
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-sidebar p-1 text-sidebar-foreground shadow-black/30 shadow-lg">
        <IconButton className="size-8 rounded-lg" onClick={back} tooltip="Back">
          <ArrowLeft />
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
                { label: "Base", value: BASE },
                ...variants.map((v) => ({ label: v, value: v })),
              ]}
              value={variant ?? BASE}
            />
          </div>
        ) : null}
        <div className="w-72">
          <OptionSelect
            className="border-transparent bg-transparent dark:bg-transparent"
            onChange={go}
            options={bases.map(pageOption)}
            placeholder="No page"
            value={current}
          />
        </div>
        <HotspotsToggle />
        <IconButton
          aria-label="Comment"
          aria-pressed={commenting}
          className={cn(
            "size-8 rounded-lg",
            commenting && "bg-brand text-brand-foreground hover:bg-brand/90"
          )}
          disabled={canvas === null}
          onClick={toggleCommenting}
          tooltip={
            <>
              {commenting ? "Stop commenting" : "Comment"} <Kbd>C</Kbd>
            </>
          }
        >
          <MessageCircle />
        </IconButton>
        <div className="w-28">
          <OptionSelect
            className="border-transparent bg-transparent dark:bg-transparent"
            onChange={pickDevice}
            options={prototypeDevices}
            value={device}
          />
        </div>
        <IconButton
          className="size-8 rounded-lg"
          disabled={canvas === null}
          onClick={reload}
          tooltip="Restart the prototype"
        >
          <RotateCw />
        </IconButton>
      </div>
    </>
  );
};
