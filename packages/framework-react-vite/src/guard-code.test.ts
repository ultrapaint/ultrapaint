import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import {
  GUARD_ID,
  GUARD_MODULE,
  guardCode,
  guardedKind,
} from "./guard-code.ts";

const guard = (code: string, markModule = false) => {
  let id = 0;
  return guardCode(
    code,
    parseAst(code),
    () => {
      id += 1;
      return id;
    },
    { markModule }
  );
};

const IMPORT_RE = /^import\{[^}]*\}from"[^"]*";/;

/** The code as the browser would run it, `import` taken off, the guard's names given. */
const run = (code: string, names: Record<string, unknown>) =>
  new Function(
    ...Object.keys(names),
    (guard(code) ?? code).replace(IMPORT_RE, "")
  )(...Object.values(names));

describe("guardCode", () => {
  it("leaves a module without loops or async functions as it is", () => {
    expect(guard("export const a = (b) => b + 1;")).toBeNull();
  });

  it("checks every loop, braced or not, and imports the check", () => {
    const out = guard(
      "for (const a of b) { c(a); }\nwhile (d) e();\ndo f(); while (g);\nfor (;;);"
    );
    expect(out).toBe(
      `import{loop as __edLoop}from"${GUARD_ID}";for (const a of b) {__edLoop(1); c(a); }\nwhile (d) {__edLoop(2);e();}\ndo {__edLoop(3);f();} while (g);\nfor (;;){__edLoop(4);;}`
    );
  });

  it("keeps every line where it was", () => {
    const code =
      "const s = 'Città';\nasync function a() {\n  await b();\n}\nwhile (c) {\n  d();\n}\n";
    const out = guard(code) ?? "";
    expect(out.split("\n").length).toBe(code.split("\n").length);
    expect(out.split("\n")[5]).toBe("  d();");
  });

  it("marks what an async function rejects with the frame it was called for", async () => {
    const marked = new Map<unknown, unknown>();
    const names = {
      __edFrame: () => "frame-a",
      __edMark: (error: unknown, frame: unknown) => {
        marked.set(error, frame);
        return error;
      },
    };
    const out: { fns?: (() => Promise<void>)[] } = {};
    run(
      "out.fns = [async function a() { await null; throw new Error('a'); }, async () => Promise.reject(new Error('b'))];",
      { ...names, out }
    );
    const [block, arrow] = out.fns ?? [];
    if (!(block && arrow)) {
      throw new Error("not run");
    }
    const a = await block().catch((e: unknown) => e);
    const b = await arrow().catch((e: unknown) => e);
    expect(marked.get(a)).toBe("frame-a");
    expect(marked.get(b)).toBe("frame-a");
  });

  it("leaves async generators alone", () => {
    expect(guard("async function* a() { yield 1; }")).toBeNull();
  });

  it("closes the inner function before the outer at one place", () => {
    const out = guard("const f = async () => async () => x;") ?? "";
    expect(() => parseAst(out)).not.toThrow();
  });
});

describe("the guard module", () => {
  it("throws in a loop that holds the thread, and only then", async () => {
    const url = `data:text/javascript,${encodeURIComponent(GUARD_MODULE)}`;
    const { loop } = (await import(url)) as { loop: (id: number) => void };
    const short = () => {
      for (let i = 0; i < 100_000; i += 1) {
        loop(1);
      }
    };
    expect(short).not.toThrow();
    const start = performance.now();
    const endless = () => {
      for (;;) {
        loop(2);
      }
    };
    expect(endless).toThrow("Stopped a loop that held the editor for 2.5 s");
    expect(performance.now() - start).toBeGreaterThan(2400);
    // Caught and run again in the same task, it throws at once.
    expect(() => loop(2)).toThrow("Stopped a loop");
    // A dependency's loop does not: React runs its work loop again to draw the boundary.
    expect(() => loop(0)).not.toThrow();
  });
});

describe("guardedKind", () => {
  const GENERATED = "/home/u/.cache/ultrapaint/preview/designs-1a2b/";
  const BUNDLES = "/home/u/ultrapaint/packages/framework-react-vite/dist/";
  const kind = (id: string) => guardedKind(id, [GENERATED, BUNDLES]);

  it("guards all of the repository's own JavaScript, a library's beside it too", () => {
    expect(kind("/home/u/shop/src/page.tsx")).toBe("source");
    expect(kind("/home/u/shop/src/page.tsx?t=17")).toBe("source");
    expect(kind("/home/u/shop/packages/ui/button.mjs")).toBe("source");
    expect(kind("C:\\shop\\src\\page.jsx")).toBe("source");
  });

  it("checks only the loops of a dependency, installed or prebundled", () => {
    expect(kind("/home/u/shop/node_modules/react-dom/client.js")).toBe(
      "dependency"
    );
    expect(kind(`${GENERATED}.vite/deps/react-dom_client.js?v=1a2b`)).toBe(
      "dependency"
    );
    expect(kind("C:\\shop\\node_modules\\swr\\index.mjs")).toBe("dependency");
  });

  it("leaves the editor's modules, the dev server's and what is not JavaScript", () => {
    expect(kind(`${GENERATED}entry.tsx`)).toBeNull();
    expect(kind(`${BUNDLES}editor.js`)).toBeNull();
    expect(
      kind("/home/u/shop/node_modules/vite/dist/client/client.mjs")
    ).toBeNull();
    expect(
      kind("/home/u/shop/node_modules/@vitejs/plugin-react/refresh.js")
    ).toBeNull();
    expect(kind("/@react-refresh")).toBeNull();
    expect(kind(`\0${GUARD_ID}`)).toBeNull();
    expect(kind("/home/u/shop/src/page.css")).toBeNull();
    expect(kind("/home/u/shop/src/data.json")).toBeNull();
  });
});
