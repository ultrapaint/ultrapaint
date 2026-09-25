import { presetSize } from "@ultrapaint/contracts/pages";
import type { HostMessage } from "@ultrapaint/contracts/preview";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { useDesignSystem } from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { pagesOfSpace, useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { bridgeFor, removeBridge } from "./bridge.ts";
import { useHostUrl } from "./frame.tsx";

/** Room kept free around the page for the workspace switcher and the bottom strip. */
const inset = { bottom: 72, side: 32, top: 64 };

/** Asks the prototype to reload its iframe, which restarts the space from its current route. */
const RELOAD_EVENT = "ultrapaint:reload-prototype";

/** The one iframe of a prototype. Navigating swaps the page inside it, it never reloads. */
export const frameIdOf = (space: string) => `prototype:${space}`;

/** Tells the prototype what the route shows: the page serving it, in the design system. */
const renderRoute = (space: string) => {
  const { activePage, route } = useEditor.getState();
  const state = activePage
    ? useDocuments.getState().docs[activePage]
    : undefined;
  let message: string | undefined;
  if (!activePage) {
    message = `No page for ${route}`;
  } else if (state?.problem !== undefined) {
    message = `This page cannot be read: ${state.problem}`;
  }
  bridgeFor(frameIdOf(space)).render({
    designSystem: useDesignSystem.getState().designSystem,
    mode: "page",
    root: state?.root ?? null,
    ...(message !== undefined && { message }),
  });
};

/**
 * The space at the size of the current page's frame, scaled down only when it does not fit,
 * with clicks going to the page itself. The editor holds the route: what a link inside asks
 * for comes back out as a navigation, and the iframe is told what to show.
 */
export const Prototype = () => {
  const ref = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const space = useEditor((s) => s.space);
  const route = useEditor((s) => s.route);
  const activePage = useEditor((s) => s.activePage);
  const frame = useEditor((s) =>
    activePage ? s.frames[activePage] : undefined
  );
  const pages = useProject((s) => s.pages);
  const hostUrl = useHostUrl();
  const [area, setArea] = useState({ height: 0, width: 0 });
  const [reloads, setReloads] = useState(0);
  const hasPages = space !== null && pages.some((p) => p.space === space);

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
    hostUrl && space !== null
      ? `${hostUrl}/?space=${encodeURIComponent(space)}&frame=${encodeURIComponent(frameIdOf(space))}`
      : null;

  const size = frame ?? presetSize.desktop;
  const scale = Math.min(
    1,
    (area.width - inset.side * 2) / size.width,
    (area.height - inset.top - inset.bottom) / size.height
  );

  let content: string | null = null;
  if (!hasPages) {
    content = "This space has no pages yet";
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
    if (!(iframe && url && space !== null)) {
      return;
    }
    const frameId = frameIdOf(space);
    const bridge = bridgeFor(frameId);
    bridge.attach(iframe);
    const off = bridge.on((msg: HostMessage) => {
      if (msg.type === "ed:ready") {
        // Whatever the iframe started on, the editor says what it shows; and it is for clicking.
        renderRoute(space);
        bridge.setInteractive(true);
      }
      if (msg.type === "ed:navigateTo") {
        useEditor.getState().navigate(msg.route, { push: !msg.replace });
      }
    });
    return () => {
      off();
      removeBridge(frameId);
    };
  }, [space, url, reloads, shown]);

  // The editor holds the route; the preview draws the page serving it, without reloading.
  const document = useDocuments((s) =>
    activePage ? s.docs[activePage] : undefined
  );
  const designSystem = useDesignSystem((s) => s.designSystem);
  // biome-ignore lint/correctness/useExhaustiveDependencies: what is drawn is the dependency.
  useEffect(() => {
    if (space !== null && url && bridgeFor(frameIdOf(space)).ready) {
      renderRoute(space);
    }
  }, [route, space, url, document, designSystem]);

  return (
    <div
      // Shown in the layer that floats over the canvas, which passes clicks through: the page
      // itself takes them.
      className="pointer-events-auto relative flex h-full w-full items-center justify-center overflow-hidden bg-background"
      ref={ref}
      style={{ paddingBottom: inset.bottom, paddingTop: inset.top }}
    >
      {shown ? (
        <div
          className="shrink-0 overflow-hidden rounded-md bg-white shadow-2xl"
          style={{ height: size.height * scale, width: size.width * scale }}
        >
          <iframe
            className="block origin-top-left border-0 bg-white"
            key={`${space}:${reloads}`}
            ref={iframeRef}
            src={url}
            style={{
              height: size.height,
              transform: `scale(${scale})`,
              width: size.width,
            }}
            title={route}
          />
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

/** Floating strip under the prototype: the space's history, where it is, and a restart. */
export const PrototypeBar = () => {
  const space = useEditor((s) => s.space);
  const route = useEditor((s) => s.route);
  // Subscribed to so the routes follow a page being created or deleted.
  useProject((s) => s.pages);
  const routes = Array.from(
    new Set(pagesOfSpace(space).map((p) => p.route))
  ).sort();
  const go = (next: string) => useEditor.getState().navigate(next);

  return (
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
      <div className="w-64">
        <OptionSelect
          className="border-transparent bg-transparent font-mono dark:bg-transparent"
          onChange={go}
          options={routes.map((r) => ({ label: r, value: r }))}
          placeholder="No route"
          value={routes.includes(route) ? route : null}
        />
      </div>
      <IconButton
        className="size-8 rounded-lg"
        disabled={space === null}
        onClick={reload}
        tooltip="Restart the prototype"
      >
        <RotateCw />
      </IconButton>
    </div>
  );
};
