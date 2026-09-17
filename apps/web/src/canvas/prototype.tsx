import { presetSize } from "@ultrapaint/contracts/screens";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";
import { useHostUrl } from "./frame.tsx";

/** Room kept free around the screen for the workspace switcher and the bottom strip. */
const inset = { bottom: 72, side: 32, top: 64 };

const useFlowScreens = () => {
  const flow = useEditor((s) => s.flow);
  const screens = useProject((s) => s.screens);
  return screens.filter((s) => s.flow === flow);
};

/** The screen on show: the active one, or the flow's first. */
const useCurrentScreen = () => {
  const screens = useFlowScreens();
  const active = useEditor((s) => s.activeScreen);
  return screens.find((s) => s.id === active) ?? screens[0] ?? null;
};

/** Asks the prototype to reload its iframe, which restarts the screen's state. */
const RELOAD_EVENT = "ultrapaint:reload-prototype";

/**
 * One screen at its frame's size, scaled down only when it does not fit, with clicks going to the
 * screen itself.
 */
export const Prototype = () => {
  const ref = useRef<HTMLDivElement>(null);
  const screen = useCurrentScreen();
  const frame = useEditor((s) => (screen ? s.frames[screen.id] : undefined));
  const hostUrl = useHostUrl();
  const [area, setArea] = useState({ height: 0, width: 0 });
  const [reloads, setReloads] = useState(0);

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

  const size = frame ?? presetSize.desktop;
  const scale = Math.min(
    1,
    (area.width - inset.side * 2) / size.width,
    (area.height - inset.top - inset.bottom) / size.height
  );

  let content: string | null = null;
  if (!screen) {
    content = "This flow has no screens yet";
  } else if (!hostUrl) {
    content = "Preview host not running";
  }

  return (
    <div
      // Shown in the layer that floats over the canvas, which passes clicks through: the screen
      // itself takes them.
      className="pointer-events-auto relative flex h-full w-full items-center justify-center overflow-hidden bg-background"
      ref={ref}
      style={{ paddingBottom: inset.bottom, paddingTop: inset.top }}
    >
      {content === null && screen && hostUrl && scale > 0 ? (
        <div
          className="shrink-0 overflow-hidden rounded-md bg-white shadow-2xl"
          style={{
            height: size.height * scale,
            width: size.width * scale,
          }}
        >
          <iframe
            className="block origin-top-left border-0 bg-white"
            key={`${screen.id}:${reloads}`}
            src={`${hostUrl}/?screen=${encodeURIComponent(screen.id)}`}
            style={{
              height: size.height,
              transform: `scale(${scale})`,
              width: size.width,
            }}
            title={screen.name}
          />
        </div>
      ) : (
        <span className="text-muted-foreground">{content}</span>
      )}
    </div>
  );
};

const reload = () => window.dispatchEvent(new CustomEvent(RELOAD_EVENT));

/** Floating strip under the prototype: step through the flow's screens or restart the one shown. */
export const PrototypeBar = () => {
  const screens = useFlowScreens();
  const screen = useCurrentScreen();
  const index = screen ? screens.indexOf(screen) : -1;
  const show = (id: string) => useEditor.getState().setActiveScreen(id);
  const step = (by: number) => {
    const next = screens[index + by];
    if (next) {
      show(next.id);
    }
  };
  const previous = () => step(-1);
  const next = () => step(1);

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-sidebar p-1 text-sidebar-foreground shadow-black/30 shadow-lg">
      <IconButton
        className="size-8 rounded-lg"
        disabled={index <= 0}
        onClick={previous}
        tooltip="Previous screen"
      >
        <ChevronLeft />
      </IconButton>
      <div className="w-48">
        <OptionSelect
          className="border-transparent bg-transparent dark:bg-transparent"
          onChange={show}
          options={screens.map((s) => ({ label: s.name, value: s.id }))}
          placeholder="No screen"
          value={screen?.id ?? null}
        />
      </div>
      <IconButton
        className="size-8 rounded-lg"
        disabled={index < 0 || index >= screens.length - 1}
        onClick={next}
        tooltip="Next screen"
      >
        <ChevronRight />
      </IconButton>
      <IconButton
        className="size-8 rounded-lg"
        disabled={!screen}
        onClick={reload}
        tooltip="Restart screen"
      >
        <RotateCw />
      </IconButton>
    </div>
  );
};
