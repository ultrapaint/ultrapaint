/// <reference lib="dom" />
/**
 * `pnpm e2e:sandbox`: the guards between the preview's code and the editor's page
 * (docs/PLAN-preview-sandbox.md), checked in a headless Chrome against the fixture host
 * `fixtures/sandbox-host`, whose components do what applications do to the page. It starts an
 * editor of its own on that host, on free ports, and stops it when done:
 *
 * - the application hears no key typed in the editor, and its own frame's keys still;
 * - the editor's address, title and head stay the editor's;
 * - a request to the application's own origin reaches its backend through the repository's
 *   proxy, not the editor's routes;
 * - the application's storage is its own, the editor's keys and databases out of its reach;
 * - a theme class and a scroll lock land on their frame, not the editor, and a colour scheme
 *   left to the system reads the frame's theme;
 * - styles the application's code writes (CSS-in-JS, StyleX as it develops) and stylesheets it
 *   links, its own and another site's, reach its frames, not the editor;
 * - a frame's code reads the frame's width and scroll as the window's;
 * - the editor's CSS variables do not reach a frame;
 * - what nothing caught (a timer, a click in the prototype) is shown on its frame;
 * - a loop that never ends, in a render or a click, in the repository's code or a dependency's,
 *   is stopped and shown on its frame;
 * - what a module's own top-level code added to the window goes when the module is edited;
 * - a rejection is shown on the frame whose code made it, or on none when nothing says which;
 *   what is shown names the line of the source, not of the module as the server sent it;
 * - reloading the editor asks nothing, whatever the page's "unsaved changes" guard says;
 * - a parked frame's animation waits, and goes on when the frame is seen again;
 * - a page that stopped the editor is a placeholder when the editor loads again.
 *
 *   pnpm e2e:sandbox [--chrome /path/to/chrome]
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { type BrowserContext, chromium, type Page } from "playwright-core";

const { values: args } = parseArgs({
  options: { chrome: { type: "string" } },
});

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG = path.join(ROOT, "fixtures/sandbox-host/ultrapaint.config.json");
const PROTOTYPE = "prototype:guards";

interface Probe {
  log: { detail?: unknown; probe: string; what: string }[];
}
interface EditorState {
  canvas: string | null;
  frames: Record<string, unknown>;
  setMode: (mode: string) => void;
  setWorkspace: (workspace: string) => void;
}
/** What the editor's page offers the check: its dev handle, and what the probes wrote. */
interface CheckWindow {
  __ed: {
    /** Every frame's error, described, by frame. */
    frameErrors: () => Record<string, string>;
    goTo: (to: { route: string }) => void;
    openCanvas: (id: string) => void;
    useEditor: { getState: () => EditorState };
    useProject: { getState: () => { pages: { id: string }[] } };
    zoomToFit: () => void;
    /** Takes the project's page, not its id. */
    zoomToPage: (page: { id: string }) => void;
  };
  __probe?: Probe;
}

const chromePath = () => {
  const found = [
    args.chrome,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((c) => c && existsSync(c));
  if (!found) {
    throw new Error("No Chrome found: pass --chrome or set CHROME_PATH.");
  }
  return found;
};

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address ? address.port : 0)
      );
    });
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads until `done` holds of what `read` gives, or `timeout` ms have passed: what the page does
 * after an action (a request answered, a style mirrored, an error caught) is waited for, never
 * slept on. Gives the last read, which the check then judges and reports.
 */
const readUntil = async <A>(
  read: () => Promise<A>,
  done: (value: A) => boolean,
  timeout = 10_000
): Promise<A> => {
  const end = Date.now() + timeout;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    // biome-ignore lint/performance/noAwaitInLoops: polling, one look at a time.
    await sleep(100);
    value = await read();
  }
  return value;
};

/** An editor on the fixture host, in a process group of its own, stopped through its handle. */
/**
 * The application's backend: answers every request with the path it was asked for, and serves
 * a stylesheet of another site at `/cross.css`.
 */
const startBackend = () =>
  new Promise<{ server: Server; url: string }>((resolve) => {
    const server = createHttpServer((request, response) => {
      if (request.url === "/cross.css") {
        // A stylesheet of another site that allows being read, as a CDN's does.
        response.setHeader("access-control-allow-origin", "*");
        response.setHeader("content-type", "text/css");
        response.end(
          ".probe-cross-box { background-color: rgb(128, 0, 128); }"
        );
        return;
      }
      response.end(`backend:${request.url}`);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });

const startEditor = async (
  api: string
): Promise<{ stop: () => void; url: string }> => {
  const port = await freePort();
  const web = await freePort();
  const child: ChildProcess = spawn(
    "pnpm",
    ["dev", "--", "--config", CONFIG, "--no-open"],
    {
      cwd: ROOT,
      detached: true,
      env: {
        ...process.env,
        ULTRAPAINT_PORT: String(port),
        ULTRAPAINT_WEB_PORT: String(web),
        // The fixture's Vite config proxies `/api` there.
        SANDBOX_HOST_API: api,
      },
      stdio: "ignore",
    }
  );
  const stop = () => {
    if (child.pid !== undefined && child.exitCode === null) {
      process.kill(-child.pid, "SIGINT");
    }
  };
  const url = `http://127.0.0.1:${web}`;
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    // biome-ignore lint/performance/noAwaitInLoops: polling, one look at a time.
    const up = await fetch(url).then(
      (r) => r.ok,
      () => false
    );
    if (up) {
      return { stop, url };
    }
    await sleep(500);
  }
  stop();
  throw new Error(`the editor did not answer at ${url}`);
};

const launch = (profile: string) =>
  chromium.launchPersistentContext(profile, {
    args: ["--disable-renderer-backgrounding"],
    // The system prefers dark: a light frame's code reads light only because the frame says so.
    colorScheme: "dark",
    executablePath: chromePath(),
    headless: true,
    viewport: { height: 1000, width: 1600 },
  });

/**
 * Waits until `canvas` is open and every one of its frames is on the canvas, its page drawn.
 * Frames are drawn a few at a time, and one off the screen only once the camera is there: the
 * frames already drawn are not all of them.
 */
const allDrawn = (page: Page, canvas: string) =>
  page.waitForFunction(
    (c) => {
      const ed = (window as unknown as Partial<CheckWindow>).__ed;
      const state = ed?.useEditor.getState();
      const ids = Object.keys(state?.frames ?? {});
      return (
        state?.canvas === c &&
        ids.length > 0 &&
        ids.every((id) =>
          document
            .querySelector(
              `[data-canvas] [data-ed-frame-host="${CSS.escape(id)}"]`
            )
            ?.hasAttribute("data-ed-drawn")
        )
      );
    },
    canvas,
    { timeout: 60_000 }
  );

/**
 * Reads until `judge` passes what `read` gives (see `readUntil`): true, or what was wrong with
 * the last read.
 */
const judged = async <A>(
  read: () => Promise<A>,
  judge: (value: A) => true | string
): Promise<true | string> =>
  judge(await readUntil(read, (v) => judge(v) === true));

/** Opens `canvas` and waits until every frame on it has drawn its page. */
const open = async (page: Page, url: string, canvas: string) => {
  await page.goto(`${url}/?canvas=${canvas}`, { waitUntil: "load" });
  await allDrawn(page, canvas);
};

/** Has the camera bring the page `id` into view, as Zoom to page does. */
const zoomToPage = (page: Page, id: string) =>
  page.evaluate((pageId) => {
    const ed = (window as unknown as CheckWindow).__ed;
    const target = ed.useProject.getState().pages.find((p) => p.id === pageId);
    if (!target) {
      throw new Error(`no page ${pageId}`);
    }
    ed.zoomToPage(target);
  }, id);

/** What the probes wrote down from `probe`, from entry `from` on. */
const logOf = (page: Page, probe: string, from = 0) =>
  page.evaluate(
    ({ probe: name, from: start }) =>
      ((window as unknown as CheckWindow).__probe?.log ?? [])
        .slice(start)
        .filter((e) => e.probe === name),
    { from, probe }
  );

const logLength = (page: Page) =>
  page.evaluate(
    () => (window as unknown as CheckWindow).__probe?.log.length ?? 0
  );

/**
 * The center of the first element matching `selector` inside a frame host, once a click there
 * reaches it: on the screen, the camera still (the same place twice in a row), the frame taking
 * input and nothing over it. Null when it does not within 10 s.
 */
const centerIn = async (page: Page, host: string, selector: string) => {
  const read = () =>
    page.evaluate(
      ({ host: id, selector: sel }) => {
        const frame = document.querySelector(
          `[data-ed-frame-host="${CSS.escape(id)}"]`
        );
        const el = frame?.shadowRoot?.querySelector(sel);
        if (!(frame?.shadowRoot && el)) {
          return null;
        }
        const box = el.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const hit = frame.shadowRoot.elementFromPoint(x, y);
        return {
          reached:
            document.elementFromPoint(x, y) === frame &&
            hit !== null &&
            el.contains(hit) &&
            el.closest("[inert]") === null,
          x,
          y,
        };
      },
      { host, selector }
    );
  let last = "";
  const point = await readUntil(read, (p) => {
    const at = JSON.stringify(p && [p.x, p.y]);
    const still = at === last;
    last = at;
    return p?.reached === true && still;
  });
  return point?.reached ? { x: point.x, y: point.y } : null;
};

const results: { detail?: string; name: string; ok: boolean }[] = [];
const check = async (name: string, run: () => Promise<string | true>) => {
  try {
    const outcome = await run();
    results.push(
      outcome === true
        ? { name, ok: true }
        : { detail: outcome, name, ok: false }
    );
  } catch (error) {
    results.push({ detail: String(error), name, ok: false });
  }
  const last = results.at(-1);
  console.log(
    last?.ok
      ? `✓ ${name}`
      : `✗ ${name}${last?.detail ? `: ${last.detail}` : ""}`
  );
};

const guards = async (page: Page, url: string) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    d.accept().catch(() => undefined);
  });
  await open(page, url, "guards");
  const frameErrors = () =>
    page.evaluate(() => (window as unknown as CheckWindow).__ed.frameErrors());

  await check("the application hears no key typed in the editor", async () => {
    const from = await logLength(page);
    await page.mouse.click(800, 900);
    await page.keyboard.press("/");
    await page.keyboard.press("Control+z");
    const heard = await logOf(page, "hotkey", from);
    return heard.length === 0 || `heard ${JSON.stringify(heard)}`;
  });

  await check(
    "the application hears the keys typed in its own frame",
    async () => {
      await zoomToPage(page, "guards/hotkey.page.json");
      await page.evaluate(() =>
        (window as unknown as CheckWindow).__ed.useEditor
          .getState()
          .setMode("interact")
      );
      const input = await centerIn(page, "guards/hotkey.page.json", "input");
      if (!input) {
        return "the frame's field is not on the screen";
      }
      const from = await logLength(page);
      await page.mouse.click(input.x, input.y);
      await page.keyboard.press("a");
      const heard = await readUntil(
        () => logOf(page, "hotkey", from),
        (h) => h.length > 0,
        2000
      );
      await page.evaluate(() => {
        const ed = (window as unknown as CheckWindow).__ed;
        ed.useEditor.getState().setMode("select");
        // Every frame of the canvas on the screen again, for the checks that read them.
        ed.zoomToFit();
      });
      await allDrawn(page, "guards");
      return heard.length > 0 || "the frame's key was not heard";
    }
  );

  await check("the editor's address stays the editor's", async () => {
    const search = await page.evaluate(() => location.search);
    return !search.includes("tab=") || `the address became ${search}`;
  });

  await check("the editor's title and head stay the editor's", async () => {
    const head = await page.evaluate(() => ({
      meta: document.head.querySelector('meta[name="probe-meta"]') !== null,
      title: document.title,
      titles: [...document.head.querySelectorAll("title")].map((t) => t.text),
    }));
    return (
      (!head.meta &&
        head.title !== "Probe app" &&
        !head.titles.includes("Probe title")) ||
      JSON.stringify(head)
    );
  });

  await check(
    "a request to the application's own origin reaches its backend, not the editor",
    async () => {
      const answer = await readUntil(
        () =>
          page.evaluate(
            () =>
              document
                .querySelector('[data-ed-frame-host="guards/fetch.page.json"]')
                ?.shadowRoot?.querySelector('[data-probe="fetch"]')?.textContent
          ),
        (a) => a === "backend:/api/health"
      );
      return answer === "backend:/api/health" || `answered ${answer}`;
    }
  );

  await check(
    "the application's storage is its own, the editor's out of its reach",
    async () =>
      judged(
        () =>
          page.evaluate(() => {
            const text = document
              .querySelector('[data-ed-frame-host="guards/storage.page.json"]')
              ?.shadowRoot?.querySelector(
                '[data-probe="storage"]'
              )?.textContent;
            return {
              editor: {
                canvas: localStorage.getItem("ultrapaint:canvas"),
                theme: localStorage.getItem("theme"),
              },
              frame: text?.startsWith("{")
                ? (JSON.parse(text) as {
                    databases: string[];
                    editorKey: string | null;
                    theme: string | null;
                  })
                : null,
            };
          }),
        (seen) => {
          const { editor, frame } = seen;
          return (
            (frame !== null &&
              frame.editorKey === null &&
              frame.theme === "probe-dark" &&
              !frame.databases.includes("ultrapaint-watchdog") &&
              editor.canvas !== null &&
              editor.theme === null) ||
            JSON.stringify(seen)
          );
        }
      )
  );

  await check(
    "a theme class and a scroll lock land on their frame, not the editor",
    async () =>
      judged(
        () =>
          page.evaluate(() => {
            const host = document.querySelector(
              '[data-ed-frame-host="guards/theme.page.json"]'
            ) as HTMLElement | null;
            const body = host?.shadowRoot?.querySelector(
              "[data-ed-body]"
            ) as HTMLElement | null;
            return {
              editor: {
                locked: document.body.hasAttribute("data-scroll-locked"),
                overflow: document.body.style.overflow,
                scheme: document.documentElement.style.colorScheme,
                theme:
                  document.documentElement.classList.contains("probe-theme"),
              },
              frame: {
                bodyTheme: body?.classList.contains("probe-theme") ?? false,
                hostTheme: host?.classList.contains("probe-theme") ?? false,
                locked: body?.getAttribute("data-scroll-locked") ?? null,
                scheme: host?.shadowRoot?.querySelector('[data-probe="theme"]')
                  ?.textContent,
              },
            };
          }),
        (seen) => {
          const { editor, frame } = seen;
          return (
            (!(editor.locked || editor.theme) &&
              editor.overflow === "" &&
              editor.scheme === "" &&
              frame.hostTheme &&
              frame.bodyTheme &&
              frame.locked === "1" &&
              frame.scheme === "light") ||
            JSON.stringify(seen)
          );
        }
      )
  );

  await check(
    "styles the application's code writes (CSS-in-JS, StyleX) reach its frames, not the editor",
    () => {
      return judged(
        () =>
          page.evaluate(() => {
            const shadow = document.querySelector(
              '[data-ed-frame-host="guards/css-in-js.page.json"]'
            )?.shadowRoot;
            const stylexBox = document
              .querySelector('[data-ed-frame-host="guards/stylex.page.json"]')
              ?.shadowRoot?.querySelector('[data-probe="stylex"]');
            const box = shadow?.querySelector('[data-probe="css-box"]');
            const text = shadow?.querySelector('[data-probe="text-box"]');
            const body = shadow?.querySelector("[data-ed-body]");
            return {
              editor: {
                inHead: document.head.querySelectorAll(
                  'style[data-emotion="probe"], #_goober, style[data-stylex]'
                ).length,
                outline: getComputedStyle(document.body).outlineStyle,
              },
              frame: {
                box: box ? getComputedStyle(box).backgroundColor : null,
                outline: body ? getComputedStyle(body).outlineStyle : null,
                // StyleX, its width query the frame's (440 px): dashed below 500.
                stylex: stylexBox
                  ? `${getComputedStyle(stylexBox).backgroundColor} ${getComputedStyle(stylexBox).borderTopStyle}`
                  : null,
                text: text ? getComputedStyle(text).color : null,
              },
            };
          }),
        (seen) => {
          const { editor, frame } = seen;
          return (
            (frame.box === "rgb(255, 0, 0)" &&
              frame.text === "rgb(0, 0, 255)" &&
              frame.outline === "solid" &&
              frame.stylex === "rgb(0, 160, 0) dashed" &&
              editor.outline !== "solid" &&
              editor.inHead === 0) ||
            JSON.stringify(seen)
          );
        }
      );
    }
  );

  await check(
    "stylesheets the application's code links reach its frames, not the editor",
    () => {
      return judged(
        () =>
          page.evaluate(() => {
            const shadow = document.querySelector(
              '[data-ed-frame-host="guards/link.page.json"]'
            )?.shadowRoot;
            const own = shadow?.querySelector('[data-probe="link-box"]');
            const cross = shadow?.querySelector('[data-probe="cross-box"]');
            return {
              cross: cross ? getComputedStyle(cross).backgroundColor : null,
              inHead: [...document.head.querySelectorAll("link")].filter(
                (l) =>
                  l.href.includes("probe-link") || l.href.includes("cross.css")
              ).length,
              own: own ? getComputedStyle(own).backgroundColor : null,
              // Its relative URL, made absolute against the stylesheet's address.
              ownImage: own ? getComputedStyle(own).backgroundImage : null,
            };
          }),
        (seen) =>
          (seen.own === "rgb(255, 165, 0)" &&
            seen.ownImage?.includes("/preview/probe-dot.svg") &&
            seen.cross === "rgb(128, 0, 128)" &&
            seen.inHead === 0) ||
          JSON.stringify(seen)
      );
    }
  );

  const windowProbe = () =>
    page.evaluate(() => {
      const text = document
        .querySelector('[data-ed-frame-host="guards/window.page.json"]')
        ?.shadowRoot?.querySelector('[data-probe="window"]')?.textContent;
      return text ? (JSON.parse(text) as Record<string, unknown>) : null;
    });

  await check(
    "a frame's code reads the frame's width as the window's",
    async () =>
      judged(
        windowProbe,
        (read) =>
          (read?.innerWidth === 390 && read.phone === true) ||
          JSON.stringify(read)
      )
  );

  await check(
    "a frame's scroll is its window's, never the editor's",
    async () => {
      await page.evaluate(() => {
        const host = document.querySelector(
          '[data-ed-frame-host="guards/window.page.json"]'
        );
        if (host) {
          host.scrollTop = 120;
        }
      });
      return judged(
        async () => ({
          editor: await page.evaluate(() => window.scrollY),
          read: await windowProbe(),
        }),
        ({ editor, read }) =>
          (read?.scrollY === 120 && editor === 0) ||
          `${JSON.stringify(read)}, editor ${editor}`
      );
    }
  );

  await check("the editor's CSS variables do not reach a frame", async () => {
    const values = await page.evaluate(() => {
      const root = document
        .querySelector("[data-canvas] [data-ed-frame-host]")
        ?.shadowRoot?.querySelector("#root");
      return {
        editor: getComputedStyle(document.documentElement).getPropertyValue(
          "--primary"
        ),
        frame: root
          ? getComputedStyle(root).getPropertyValue("--primary")
          : "no frame",
      };
    });
    return (
      (values.editor !== "" && values.frame === "") || JSON.stringify(values)
    );
  });

  await check("an error thrown in a timer is shown on its own frame", () =>
    judged(frameErrors, (errors) => {
      const shown = errors["guards/err-timeout.page.json"] ?? "";
      const elsewhere = Object.entries(errors).filter(
        ([frame, text]) => frame !== "guards/err-timeout.page.json" && text
      );
      return (
        (shown.includes("thrown in a timeout") && elsewhere.length === 0) ||
        JSON.stringify(errors)
      );
    })
  );

  await check(
    "an error thrown by a click in the prototype is shown",
    async () => {
      await page.evaluate(() => {
        const ed = (window as unknown as CheckWindow).__ed;
        ed.useEditor.getState().setWorkspace("prototype");
        ed.goTo({ route: "/err-click" });
      });
      const button = await centerIn(
        page,
        PROTOTYPE,
        '[data-probe="throw-on-click"]'
      );
      if (!button) {
        return "the prototype's button is not on the screen";
      }
      await page.mouse.click(button.x, button.y);
      const verdict = await judged(
        async () => ({
          banner: await page.evaluate(() =>
            [...document.querySelectorAll("pre")].some((p) =>
              p.textContent?.includes("thrown in a click handler")
            )
          ),
          shown: (await frameErrors())[PROTOTYPE] ?? "",
        }),
        ({ banner, shown }) =>
          (shown.includes("thrown in a click handler") && banner) ||
          `shown: ${shown}, banner ${banner}`
      );
      await page.evaluate(() =>
        (window as unknown as CheckWindow).__ed.useEditor
          .getState()
          .setWorkspace("design")
      );
      return verdict;
    }
  );

  await check("reloading the editor asks nothing", async () => {
    // A guard that asked would have opened its dialog before the page unloaded.
    await page.reload({ waitUntil: "load" });
    return dialogs.length === 0 || `asked: ${dialogs.join(", ")}`;
  });
};

/** The line (from 1) of the probes' source that follows the line holding `after` and holds `text`. */
const probeLine = (after: string, text: string) => {
  const lines = readFileSync(
    path.join(ROOT, "fixtures/sandbox-host/src/components/probes.tsx"),
    "utf8"
  ).split("\n");
  const from = lines.findIndex((l) => l.includes(after));
  return lines.findIndex((l, i) => i > from && l.includes(text)) + 1;
};

/** A module whose top-level code listens and ticks, edited twice while the page shows it. */
const leftovers = async (page: Page, url: string) => {
  const file = path.join(
    ROOT,
    "fixtures/sandbox-host/src/components/leftovers.tsx"
  );
  const source = await readFile(file, "utf8");
  const shown = () =>
    page.evaluate(
      () =>
        document
          .querySelector('[data-ed-frame-host="hmr/leftovers.page.json"]')
          ?.shadowRoot?.querySelector('[data-probe="leftovers"]')?.textContent
    );
  try {
    await open(page, url, "hmr");
    for (const version of [2, 3]) {
      // biome-ignore lint/performance/noAwaitInLoops: one edit after the other, as a person makes them.
      await writeFile(
        file,
        source.replace("VERSION = 1", `VERSION = ${version}`)
      );
      const end = Date.now() + 20_000;
      // biome-ignore lint/performance/noAwaitInLoops: polling, one look at a time.
      while ((await shown()) !== `leftovers v${version}` && Date.now() < end) {
        await sleep(200);
      }
    }
    await check(
      "what a module's own code added goes when the module is edited",
      async () => {
        const version = await shown();
        const counted = await page.evaluate(async () => {
          const counts = (
            window as unknown as {
              __leftovers: { heard: number; ticks: number };
            }
          ).__leftovers;
          counts.heard = 0;
          counts.ticks = 0;
          window.postMessage("leftover-probe", "*");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return { heard: counts.heard, ticks: counts.ticks };
        });
        // One listener and one 100 ms interval left: three of each without.
        return (
          (version === "leftovers v3" &&
            counted.heard === 1 &&
            counted.ticks <= 14) ||
          `${version}: ${JSON.stringify(counted)}`
        );
      }
    );
  } finally {
    await writeFile(file, source);
  }
};

const loops = async (page: Page, url: string) => {
  const errors = () =>
    page.evaluate(() => (window as unknown as CheckWindow).__ed.frameErrors());
  /** What the frame of the loop in a render draws: its page's error boundary. */
  const renderFrame = () =>
    page.evaluate(
      () =>
        (
          document
            .querySelector('[data-ed-frame-host="loops/loop-render.page.json"]')
            ?.shadowRoot?.querySelector("#root") as HTMLElement | null
        )?.innerText ?? ""
    );
  // Toasts last 10 s, less than the loops below hold the page: each is written down as it shows.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll("[data-sonner-toast]")) {
        const text = (toast as HTMLElement).innerText;
        if (!seen.includes(text)) {
          seen.push(text);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const start = Date.now();
  await page.goto(`${url}/?canvas=loops`, { waitUntil: "load" });
  await page.waitForFunction(
    () =>
      (
        document
          .querySelector('[data-ed-frame-host="loops/loop-render.page.json"]')
          ?.shadowRoot?.querySelector("#root") as HTMLElement | null
      )?.innerText.includes("Stopped a loop"),
    undefined,
    { timeout: 30_000 }
  );
  const loaded = Date.now() - start;

  await check(
    "a loop that never ends in a render is stopped and shown on its frame",
    async () => {
      const shown = await renderFrame();
      return (
        (shown.includes("Stopped a loop") && loaded < 15_000) ||
        `shown: ${shown}, loaded in ${loaded} ms`
      );
    }
  );

  await check(
    "a dependency's loop that never ends (React rendering a component inside itself) is stopped",
    () =>
      judged(
        () =>
          page.evaluate(
            () =>
              (
                document
                  .querySelector(
                    '[data-ed-frame-host="loops/loop-react.page.json"]'
                  )
                  ?.shadowRoot?.querySelector("#root") as HTMLElement | null
              )?.innerText ?? ""
          ),
        (shown) =>
          shown.includes("Stopped a loop") || `shown: ${shown.slice(0, 200)}`
      )
  );

  await check("a rejection is shown on the frame whose code made it", () => {
    const line = probeLine("async function load", "throw new Error");
    return judged(errors, (shown) => {
      const a = shown["loops/reject-a.page.json"] ?? "";
      const b = shown["loops/reject-b.page.json"] ?? "";
      return (
        (a.includes("rejected in a") &&
          a.includes(`probes.tsx:${line}`) &&
          !a.includes("rejected in b") &&
          b.includes("rejected in b")) ||
        JSON.stringify(shown)
      );
    });
  });

  await check("a rejection no frame can be said to make is shown on none", () =>
    judged(
      async () => ({
        onFrames: Object.values(await errors()).some((text) =>
          text?.includes("rejected in a chain")
        ),
        toast: await page.evaluate(() =>
          (window as unknown as { __toasts: string[] }).__toasts.some((text) =>
            text.includes("rejected in a chain")
          )
        ),
      }),
      ({ onFrames, toast }) =>
        (!onFrames && toast) || `on a frame ${onFrames}, toast ${toast}`
    )
  );
  await check(
    "a loop that never ends in a click is stopped and shown on its frame",
    async () => {
      await zoomToPage(page, "loops/loop-click.page.json");
      await page.evaluate(() =>
        (window as unknown as CheckWindow).__ed.useEditor
          .getState()
          .setMode("interact")
      );
      const button = await centerIn(
        page,
        "loops/loop-click.page.json",
        '[data-probe="loop-on-click"]'
      );
      if (!button) {
        return "the frame's button is not on the screen";
      }
      const clicked = Date.now();
      await page.mouse.click(button.x, button.y);
      await page.evaluate(() => true);
      const held = Date.now() - clicked;
      const line = probeLine("const loopOnClick", "while (");
      const verdict = await judged(
        async () => (await errors())["loops/loop-click.page.json"] ?? "",
        (shown) =>
          (shown.includes("Stopped a loop") &&
            shown.includes(`probes.tsx:${line}`) &&
            held < 5000) ||
          `shown: ${shown}, held ${held} ms`
      );
      await page.evaluate(() =>
        (window as unknown as CheckWindow).__ed.useEditor
          .getState()
          .setMode("select")
      );
      return verdict;
    }
  );
};

const animations = async (page: Page, url: string) => {
  await open(page, url, "raf");
  /** How many frames each animation has drawn, by its frame (parked or not). */
  const frames = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("[data-ed-frame-host]")]
          .map((h): [string, number] => [
            (h as HTMLElement).dataset.edFrameHost ?? "",
            Number(
              (
                h.shadowRoot?.querySelector(
                  '[data-probe="raf"]'
                ) as HTMLElement | null
              )?.dataset.frames ?? 0
            ),
          ])
          .filter(([id]) => id.startsWith("raf/"))
      )
    );
  await check(
    "a parked frame's animation waits, and goes on when seen",
    async () => {
      await page.evaluate(() =>
        (window as unknown as CheckWindow).__ed.openCanvas("calm")
      );
      // The other canvas drawn: the animations' frames are parked.
      await allDrawn(page, "calm");
      const parked = await frames();
      // Held for a while, which only time can say.
      await sleep(1500);
      const later = await frames();
      await page.evaluate(() =>
        (window as unknown as CheckWindow).__ed.openCanvas("raf")
      );
      await allDrawn(page, "raf");
      const back = await readUntil(frames, (counts) =>
        Object.entries(counts).some(([id, n]) => n > (later[id] ?? 0))
      );
      const ids = Object.keys(later);
      const waited = ids.every((id) => later[id] === parked[id]);
      const resumed = ids.some((id) => (back[id] ?? 0) > (later[id] ?? 0));
      const all = (counts: Record<string, number>) =>
        ids.map((id) => counts[id]).join(",");
      return (
        (ids.length > 0 && waited && resumed) ||
        `parked ${all(parked)}, 1.5 s later ${all(later)}, back ${all(back)}`
      );
    }
  );
};

/** A page that stops the editor for 8 s: the browser is closed while it does. */
const freeze = async (url: string) => {
  const profile = await mkdtemp(path.join(tmpdir(), "e2e-sandbox-freeze-"));
  let context: BrowserContext | null = null;
  try {
    context = await launch(profile);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${url}/?canvas=freeze`, { waitUntil: "load" });
    const start = Date.now();
    let stopped = false;
    while (!stopped && Date.now() - start < 30_000) {
      // biome-ignore lint/performance/noAwaitInLoops: polling, one look at a time.
      const answer = await Promise.race([
        page.evaluate(() => true),
        sleep(1000).then(() => false),
      ]);
      stopped = !answer;
      await sleep(100);
    }
    // The watchdog writes the frame down after 3 s of silence; the browser goes before 8.
    await sleep(4000);
    await context.close().catch(() => undefined);
    context = await launch(profile);
    const again = context.pages()[0] ?? (await context.newPage());
    await again.goto(`${url}/?canvas=freeze`, { waitUntil: "load" });
    const shown = await readUntil(
      () =>
        again.evaluate(() => ({
          drawn: document.querySelectorAll("[data-canvas] [data-ed-frame-host]")
            .length,
          placeholder: document.body.innerText.includes("stopped the editor"),
        })),
      (seen) => seen.placeholder,
      15_000
    );
    await check(
      "a page that stopped the editor is a placeholder after",
      async () =>
        (stopped && shown.placeholder && shown.drawn === 0) ||
        `stopped ${stopped}, ${JSON.stringify(shown)}`
    );
  } finally {
    await context?.close().catch(() => undefined);
    await rm(profile, { force: true, recursive: true });
  }
};

const main = async () => {
  const backend = await startBackend();
  const editor = await startEditor(backend.url);
  const profile = await mkdtemp(path.join(tmpdir(), "e2e-sandbox-"));
  try {
    const context = await launch(profile);
    const page = context.pages()[0] ?? (await context.newPage());
    await guards(page, editor.url);
    await loops(page, editor.url);
    await leftovers(page, editor.url);
    await animations(page, editor.url);
    await context.close();
    await freeze(editor.url);
  } finally {
    editor.stop();
    backend.server.close();
    await rm(profile, { force: true, recursive: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
};

await main();
