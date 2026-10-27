/**
 * Components that do to the page what applications do: listen on the document, read and write the
 * window, the address and the head, throw, animate, loop. Each writes down what it saw in
 * `window.__probe`, which `pnpm e2e:sandbox` reads (docs/PLAN-preview-sandbox.md).
 */
import { useEffect, useRef, useState } from "react";

interface Entry {
  readonly detail?: unknown;
  readonly probe: string;
  readonly what: string;
}

const seen = window as unknown as { __probe?: { log: Entry[] } };
seen.__probe ??= { log: [] };
const { log } = seen.__probe;
const note = (probe: string, what: string, detail?: unknown) =>
  log.push({ detail, probe, what });

/**
 * Works for `ms` on the page's thread, as a heavy render or an animation's step does. Without a
 * loop of its own, as a dependency's work is: the preview's server checks the repository's own
 * loops, which would stop this one at 2.5 s.
 */
const busy = (ms: number) => {
  const end = performance.now() + ms;
  Array.prototype.find.call(
    { length: 2 ** 32 - 1 },
    () => performance.now() >= end
  );
};

/** A document-level shortcut, as command palettes have. */
export function HotkeyProbe() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => note("hotkey", "keydown", e.key);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return <input placeholder="Search" style={{ margin: 16 }} />;
}

/** The window's size and scroll as a hook reads them. */
const readWindow = () => ({
  innerWidth: window.innerWidth,
  phone: window.matchMedia("(max-width: 640px)").matches,
  scrollY: Math.round(window.scrollY),
});

/** What the window says, on a tall page, so it scrolls. */
export function WindowProbe() {
  const [shown, setShown] = useState(readWindow);
  useEffect(() => {
    const update = () => setShown(readWindow());
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <div style={{ minHeight: 2000, padding: 16 }}>
      <pre data-probe="window">{JSON.stringify(shown)}</pre>
    </div>
  );
}

/** A filter kept in the address, as `nuqs` or a router's search params keep it. */
export function RouterProbe() {
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("tab", "overview");
    history.replaceState(history.state, "", url);
  }, []);
  return <p style={{ padding: 16 }}>router</p>;
}

/** The page's own title and meta, through React 19 and through the document. */
export function HeadProbe() {
  useEffect(() => {
    document.title = "Probe app";
  }, []);
  return (
    <div style={{ padding: 16 }}>
      <title>Probe title</title>
      <meta content="1" name="probe-meta" />
      head
    </div>
  );
}

/**
 * What the application's backend answers, asked as an application asks its own origin. The
 * editor has an `/api/health` of its own.
 */
export function FetchProbe() {
  const [answer, setAnswer] = useState("waiting");
  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.text())
      .then(setAnswer, (error: unknown) => setAnswer(String(error)));
  }, []);
  return (
    <pre data-probe="fetch" style={{ padding: 16 }}>
      {answer}
    </pre>
  );
}

/** What the application's storage holds, and what it keeps there: a theme, as providers do. */
export function StorageProbe() {
  const [held, setHeld] = useState("waiting");
  useEffect(() => {
    const editorKey = localStorage.getItem("ultrapaint:canvas");
    localStorage.setItem("theme", "probe-dark");
    indexedDB.databases().then((all) =>
      setHeld(
        JSON.stringify({
          databases: all.map((d) => d.name),
          editorKey,
          theme: localStorage.getItem("theme"),
        })
      )
    );
  }, []);
  return (
    <pre data-probe="storage" style={{ padding: 16 }}>
      {held}
    </pre>
  );
}

/**
 * A theme provider's class and colour scheme on `<html>`, and a modal's scroll lock on `<body>`;
 * the colour scheme a provider left on "system" reads.
 */
export function ThemeProbe() {
  // Read as it draws: the frame drawing is the one asked about.
  const [scheme] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("probe-theme");
    root.style.colorScheme = "dark";
    document.body.style.overflow = "hidden";
    document.body.setAttribute("data-scroll-locked", "1");
  }, []);
  return (
    <pre data-probe="theme" style={{ padding: 16 }}>
      {scheme}
    </pre>
  );
}

/** An "unsaved changes" guard. */
export function LeaveProbe() {
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  return <p style={{ padding: 16 }}>leave</p>;
}

const throwOnClick = () => {
  throw new Error("probe: thrown in a click handler");
};

/** Throws where it is told: in a timer, or when its button is clicked. */
export function ErrorProbe({ where = "click" }: { where?: string }) {
  useEffect(() => {
    if (where !== "timeout") {
      return;
    }
    const timer = setTimeout(() => {
      throw new Error("probe: thrown in a timeout");
    }, 0);
    return () => clearTimeout(timer);
  }, [where]);
  return (
    <button
      data-probe="throw-on-click"
      onClick={throwOnClick}
      style={{ margin: 16 }}
      type="button"
    >
      throws ({where})
    </button>
  );
}

/** An animation driven from JavaScript, as a canvas hero runs it: `work` ms a frame. */
export function RafProbe({ work = 1 }: { work?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id = 0;
    let frames = 0;
    const tick = () => {
      busy(work);
      frames += 1;
      if (box.current) {
        box.current.dataset.frames = String(frames);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [work]);
  return <div data-probe="raf" ref={box} style={{ height: 20, width: 20 }} />;
}

/** A render that takes `ms`: long enough, it stops the editor. */
export function SpinProbe({ ms = 200 }: { ms?: number }) {
  busy(ms);
  return <p style={{ padding: 16 }}>spun {ms} ms</p>;
}

const loopOnClick = () => {
  let turns = 0;
  while (turns >= 0) {
    turns += 1;
  }
};

/** A loop that never ends: in its render, or when its button is clicked. */
export function LoopProbe({ where = "click" }: { where?: string }) {
  if (where === "render") {
    let turns = 0;
    while (turns >= 0) {
      turns += 1;
    }
  }

  return (
    <button
      data-probe="loop-on-click"
      onClick={loopOnClick}
      style={{ margin: 16 }}
      type="button"
    >
      loops ({where})
    </button>
  );
}

async function load(label: string) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  throw new Error(`probe: rejected in ${label}`);
}

/**
 * A rejection nothing handles, after a wait in which other frames draw: from an `async`
 * function, or from a `.then` chain, which carries no mark.
 */
export function RejectProbe({
  label = "",
  via = "async",
}: {
  label?: string;
  via?: string;
}) {
  useEffect(() => {
    if (via === "then") {
      fetch("/probe-missing").then(() => {
        throw new Error(`probe: rejected in a chain ${label}`);
      });
    } else {
      load(label);
    }
  }, [label, via]);
  return (
    <p style={{ padding: 16 }}>
      rejects ({via} {label})
    </p>
  );
}
