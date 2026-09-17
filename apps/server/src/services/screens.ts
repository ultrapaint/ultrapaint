import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  type CanvasLayout,
  CanvasLayout as CanvasLayoutSchema,
  emptyCanvasLayout,
  type Screen,
} from "@ultrapaint/contracts";
import { humanise } from "@ultrapaint/shared";
import chokidar, { type FSWatcher } from "chokidar";
import * as S from "effect/Schema";
import { AppError } from "../router.ts";
import { hashContent, toPosix, writeAtomic } from "../util.ts";
import type { RepoPaths } from "./repo.ts";

const IGNORED_DIRS = new Set(["node_modules", ".ultrapaint", "dist", ".vite"]);
const CANVAS_FILE = "canvas.json";

export interface ScreensEvents {
  onScreens: (screens: Screen[]) => void;
  onFileChanged: (file: string, hash: string) => void;
  onCanvas: (flow: string, layout: CanvasLayout) => void;
}

/** Discovers screens (TSX files) in the designs directory and watches them. */
export class ScreensService {
  private watcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;

  constructor(
    private readonly paths: RepoPaths,
    private readonly events: ScreensEvents,
  ) {}

  private isScreenFile(file: string) {
    return (
      /\.tsx$/.test(file) &&
      !/\.(stories|test|spec)\.tsx$/.test(file) &&
      !path.basename(file).startsWith("_")
    );
  }

  list(): Screen[] {
    const root = this.paths.designsDir;
    if (!existsSync(root)) return [];
    const out: Screen[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
          walk(abs);
        } else if (entry.isFile() && this.isScreenFile(entry.name)) {
          const id = toPosix(path.relative(root, abs));
          out.push({
            id,
            name: humanise(entry.name),
            flow: toPosix(path.dirname(id)) === "." ? "" : toPosix(path.dirname(id)),
            file: this.paths.relative(abs),
          });
        }
      }
    };
    walk(root);
    return out;
  }

  flows(): string[] {
    const set = new Set(this.list().map((s) => s.flow));
    return Array.from(set).sort();
  }

  watch() {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.paths.designsDir, {
      ignored: (p) => p.split(path.sep).some((seg) => IGNORED_DIRS.has(seg)),
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
    });
    const emitScreens = () => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.events.onScreens(this.list()), 80);
    };
    this.watcher.on("add", (p) => {
      if (this.isScreenFile(p)) emitScreens();
    });
    this.watcher.on("unlink", (p) => {
      if (this.isScreenFile(p)) emitScreens();
    });
    this.watcher.on("addDir", emitScreens);
    this.watcher.on("unlinkDir", emitScreens);
    this.watcher.on("change", (p) => {
      if (path.basename(p) === CANVAS_FILE) {
        const flow = toPosix(path.relative(this.paths.designsDir, path.dirname(p)));
        this.events.onCanvas(flow === "." ? "" : flow, this.readCanvas(flow === "." ? "" : flow));
        return;
      }
      if (!this.isScreenFile(p)) return;
      try {
        const content = readFileSync(p, "utf8");
        this.events.onFileChanged(this.paths.relative(p), hashContent(content));
      } catch {
        /* removed between events */
      }
    });
  }

  async close() {
    await this.watcher?.close();
    this.watcher = null;
  }

  // ---- canvas layout ----
  private canvasPath(flow: string) {
    return path.join(this.paths.designsDir, flow, CANVAS_FILE);
  }

  readCanvas(flow: string): CanvasLayout {
    const file = this.canvasPath(flow);
    if (!existsSync(file)) return emptyCanvasLayout();
    try {
      return S.decodeUnknownSync(CanvasLayoutSchema)(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      throw new AppError(
        "conflict",
        `canvas.json in ${flow || "designs root"} is invalid: ${(error as Error).message}`,
      );
    }
  }

  writeCanvas(flow: string, layout: CanvasLayout) {
    const file = this.paths.resolve(this.canvasPath(flow));
    const sorted: CanvasLayout = {
      version: 1,
      frames: Object.fromEntries(
        Object.entries(layout.frames).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
    writeAtomic(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }

  // ---- lifecycle ----
  private screenById(id: string): Screen {
    const s = this.list().find((x) => x.id === id);
    if (!s) throw new AppError("not_found", `screen not found: ${id}`);
    return s;
  }

  private componentName(fileName: string) {
    const base = fileName.replace(/\.tsx$/, "");
    const pascal = base.replaceAll(/(^|[-_ ])(\w)/g, (_, __, c: string) => c.toUpperCase());
    return /^[A-Za-z]/.test(pascal) ? pascal : `Screen${pascal}`;
  }

  templates(): { id: string; name: string }[] {
    return [
      { id: "blank", name: "Blank" },
      { id: "centered", name: "Centered content" },
      { id: "page", name: "Page with header" },
    ];
  }

  private template(id: string, name: string): string {
    switch (id) {
      case "centered":
        return `export default function ${name}() {\n  return (\n    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background-100 p-8">\n      <h1 className="font-semibold text-2xl text-foreground">${humanise(name)}</h1>\n      <p className="text-muted">Start designing here.</p>\n    </main>\n  );\n}\n`;
      case "page":
        return `export default function ${name}() {\n  return (\n    <main className="flex min-h-screen flex-col bg-background-100">\n      <header className="flex items-center justify-between border-border-100 border-b px-6 py-4">\n        <span className="font-semibold text-foreground">${humanise(name)}</span>\n      </header>\n      <section className="flex flex-1 flex-col gap-4 p-6">\n        <p className="text-muted">Start designing here.</p>\n      </section>\n    </main>\n  );\n}\n`;
      default:
        return `export default function ${name}() {\n  return <main className="min-h-screen bg-background-100 p-8" />;\n}\n`;
    }
  }

  create(flow: string, name: string, templateId = "blank"): Screen {
    const fileName = `${
      name
        .trim()
        .replaceAll(/[^A-Za-z0-9-_]+/g, "-")
        .replaceAll(/^-+|-+$/g, "")
        .toLowerCase() || "screen"
    }.tsx`;
    const dir = this.paths.resolve(path.join(this.paths.designsDir, flow));
    mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, fileName);
    if (existsSync(abs)) throw new AppError("conflict", `screen already exists: ${fileName}`);
    writeAtomic(abs, this.template(templateId, this.componentName(fileName)));
    const id = toPosix(path.relative(this.paths.designsDir, abs));
    return { id, name: humanise(fileName), flow, file: this.paths.relative(abs) };
  }

  rename(id: string, name: string): Screen {
    const s = this.screenById(id);
    const abs = this.paths.resolve(path.join(this.paths.designsDir, s.id));
    const fileName = `${
      name
        .trim()
        .replaceAll(/[^A-Za-z0-9-_]+/g, "-")
        .replaceAll(/^-+|-+$/g, "")
        .toLowerCase() || "screen"
    }.tsx`;
    const target = path.join(path.dirname(abs), fileName);
    if (existsSync(target)) throw new AppError("conflict", `screen already exists: ${fileName}`);
    renameSync(abs, target);
    const layout = this.readCanvas(s.flow);
    const old = path.basename(s.id);
    if (layout.frames[old]) {
      const { [old]: frame, ...rest } = layout.frames;
      this.writeCanvas(s.flow, {
        version: 1,
        frames: { ...rest, [fileName]: frame as NonNullable<typeof frame> },
      });
    }
    const newId = toPosix(path.relative(this.paths.designsDir, target));
    return { id: newId, name: humanise(fileName), flow: s.flow, file: this.paths.relative(target) };
  }

  duplicate(id: string): Screen {
    const s = this.screenById(id);
    const abs = this.paths.resolve(path.join(this.paths.designsDir, s.id));
    const base = path.basename(abs, ".tsx");
    let n = 2;
    let target = path.join(path.dirname(abs), `${base}-${n}.tsx`);
    while (existsSync(target)) {
      n += 1;
      target = path.join(path.dirname(abs), `${base}-${n}.tsx`);
    }
    const content = readFileSync(abs, "utf8").replace(
      new RegExp(`export default function ${this.componentName(path.basename(abs))}\\b`),
      `export default function ${this.componentName(path.basename(target))}`,
    );
    writeAtomic(target, content);
    const layout = this.readCanvas(s.flow);
    const frame = layout.frames[path.basename(s.id)];
    if (frame) {
      this.writeCanvas(s.flow, {
        version: 1,
        frames: {
          ...layout.frames,
          [path.basename(target)]: { ...frame, x: frame.x + frame.width + 80 },
        },
      });
    }
    const newId = toPosix(path.relative(this.paths.designsDir, target));
    return {
      id: newId,
      name: humanise(path.basename(target)),
      flow: s.flow,
      file: this.paths.relative(target),
    };
  }

  delete(id: string) {
    const s = this.screenById(id);
    const abs = this.paths.resolve(path.join(this.paths.designsDir, s.id));
    if (!statSync(abs).isFile()) throw new AppError("not_found", id);
    rmSync(abs);
    const layout = this.readCanvas(s.flow);
    const key = path.basename(s.id);
    if (layout.frames[key]) {
      const { [key]: _removed, ...rest } = layout.frames;
      this.writeCanvas(s.flow, { version: 1, frames: rest });
    }
  }
}
