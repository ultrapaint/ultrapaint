import { describe, expect, it } from "vitest";
import {
  createProvenance,
  fileUnder,
  isRepositoryModule,
  isRepositoryUrl,
  readStack,
} from "./provenance.ts";

const ORIGIN = "http://127.0.0.1:4601";

/** Recorded V8 stacks, as the guards read them: the patch's caller first. */
const stacksUnder = (base: string) => {
  const served = `${ORIGIN}${base}`;
  const bundle = `${served}@fs/home/u/ultrapaint/packages/framework-react-vite/dist/editor.js`;
  const at = (f: string, url: string, line = 3, column = 9) =>
    `    at ${f} (${url}:${line}:${column})`;
  const page = (f: string) => at(f, `${served}src/${f}.tsx`);
  const frames = {
    dependency: at(
      "renderWithHooks",
      `${served}node_modules/.vite/deps/react-dom_client.js?v=1a2b`,
      9,
      1
    ),
    editor: (f: string) => at(f, `${ORIGIN}/assets/index-4f2a.js`, 5, 5),
    /** A module of the repository's as the server sent it, with its map inline (`?t=`: edited). */
    mapped: at("Spin", `${served}src/components/page.tsx?t=17`, 2, 3),
    native: "    at Array.forEach (<anonymous>)",
    ours: (f: string) => at(f, `${bundle}?v=3`, 1, 2),
    page,
  };
  return { bundle, frames, served };
};

const stackOf = (...frames: string[]) => ["Error", ...frames].join("\n");

/** What each rule says of a stack: the first caller, the immediate caller, the whole stack. */
interface Expected {
  readonly immediate: boolean;
  readonly request: boolean;
  /** The file `thrownAt` names, or null for the editor's. */
  readonly thrown: string | null;
  readonly windowCall: boolean;
}

const cases = (base: string) => {
  const { frames: f } = stacksUnder(base);
  return [
    {
      expected: {
        immediate: false,
        request: false,
        thrown: null,
        windowCall: false,
      },
      name: "the editor's code alone",
      stack: [f.editor("canvas"), f.editor("main")],
    },
    {
      expected: {
        immediate: true,
        request: true,
        thrown: "src/Page.tsx",
        windowCall: true,
      },
      name: "the page's code alone",
      stack: [f.page("Page"), f.dependency, f.page("main")],
    },
    {
      expected: {
        immediate: true,
        request: true,
        thrown: "src/onKey.tsx",
        windowCall: true,
      },
      name: "the page's, called back by the editor's bundle for the page",
      stack: [f.page("onKey"), f.ours("runAs"), f.page("dispatch")],
    },
    {
      expected: {
        immediate: false,
        request: false,
        thrown:
          "@fs/home/u/ultrapaint/packages/framework-react-vite/dist/editor.js",
        windowCall: true,
      },
      name: "the editor's bundle, called by the page (a patch, the registry handing itself over)",
      stack: [f.ours("setComponents"), f.page("registry")],
    },
    {
      expected: {
        immediate: true,
        request: true,
        thrown: "node_modules/.vite/deps/react-dom_client.js",
        windowCall: true,
      },
      name: "a dependency's, handed its work by the editor through the bundle",
      stack: [f.dependency, f.ours("draw"), f.editor("canvas")],
    },
    {
      expected: {
        immediate: true,
        request: false,
        thrown: "src/loggedFetch.tsx",
        windowCall: true,
      },
      name: "the page's wrapper of a global, called by the editor",
      stack: [f.page("loggedFetch"), f.editor("api")],
    },
    {
      expected: {
        immediate: false,
        request: false,
        thrown: null,
        windowCall: false,
      },
      name: "the editor's own code inside a callback of the page's",
      stack: [f.editor("commitRoot"), f.page("onClick")],
    },
    {
      expected: {
        immediate: false,
        request: true,
        thrown: "src/Page.tsx",
        windowCall: false,
      },
      name: "the browser's own code first",
      stack: [f.native, f.page("Page")],
    },
    {
      expected: {
        immediate: true,
        request: true,
        thrown: "src/components/page.tsx",
        windowCall: true,
      },
      name: "a module of the repository's with its map inline, edited",
      stack: [f.mapped, f.ours("runAs")],
    },
  ] satisfies {
    expected: Expected;
    name: string;
    stack: string[];
  }[];
};

describe.each(["/preview/", "/tools/ultrapaint/preview/"])(
  "each rule under %s",
  (base) => {
    const { bundle } = stacksUnder(base);
    for (const { expected, name, stack } of cases(base)) {
      it(name, () => {
        const rules = createProvenance({
          base,
          ownScript: bundle,
          stack: () => stackOf(...stack),
        });
        const patched = () => undefined;
        expect({
          domWrite: rules.domWrite(patched),
          request: rules.request(patched),
          scheduling: rules.scheduling(patched),
          storage: rules.storage(patched),
          thrown: rules.thrownAt(stackOf(...stack))?.file ?? null,
          windowCall: rules.windowCall(),
        }).toEqual({
          domWrite: expected.immediate,
          request: expected.request,
          scheduling: expected.immediate,
          storage: expected.immediate,
          thrown: expected.thrown,
          windowCall: expected.windowCall,
        });
      });
    }
  }
);

describe("the base", () => {
  it("is the whole path given, not its first segment", () => {
    const { frames } = stacksUnder("/preview/");
    const rules = createProvenance({
      base: "/tools/ultrapaint/preview/",
      ownScript: "",
      stack: () => stackOf(frames.page("Page")),
    });
    expect(rules.windowCall()).toBe(false);
    expect(rules.thrownAt(stackOf(frames.page("Page")))).toBeNull();
  });

  it("makes nothing the page's before the preview starts", () => {
    const { bundle, frames } = stacksUnder("/preview/");
    const rules = createProvenance({
      base: "",
      ownScript: bundle,
      stack: () => stackOf(frames.page("Page")),
    });
    const patched = () => undefined;
    expect(rules.windowCall()).toBe(false);
    expect(rules.scheduling(patched)).toBe(false);
    expect(rules.request(patched)).toBe(false);
    expect(rules.thrownAt(stackOf(frames.page("Page")))).toBeNull();
  });
});

describe("reading a stack", () => {
  it("reads V8's frames and SpiderMonkey's, the message left out", () => {
    const url = `${ORIGIN}/preview/@fs/lib/button.tsx`;
    expect(
      readStack(
        [
          `Error: failed at ${url}:1:1`,
          `    at async Button (${url}:4:2)`,
          `    at ${url}:5:6`,
          "    at new Promise (<anonymous>)",
          `Button@${url}:7:8`,
        ].join("\n")
      )
    ).toEqual([
      { column: 2, line: 4, url },
      { column: 6, line: 5, url },
      { column: 0, line: 0, url: null },
      { column: 8, line: 7, url },
    ]);
  });

  it("reads the live stack above a patch", () => {
    const here = new URL(import.meta.url).pathname;
    const base = here.slice(0, here.lastIndexOf("/") + 1);
    const patched = (ask: (p: object) => boolean): boolean => ask(patched);
    // This file is the page's; the frame above `patched` is this test's own.
    expect(patched(createProvenance({ base }).scheduling)).toBe(true);
    // This file the editor's bundle: the first caller outside it is vitest's.
    expect(createProvenance({ base, ownScript: here }).windowCall()).toBe(
      false
    );
  });
});

describe("where an error was thrown", () => {
  /** Its first line is the source's fifth, its second the sixth. */
  const map = btoa(
    JSON.stringify({ mappings: "AAIA;AACA", sources: ["page.tsx"], version: 3 })
  );
  const module = `spin();\nmore();\n//# sourceMappingURL=data:application/json;base64,${map}`;

  it("names the source's line through the module's inline map", async () => {
    const { frames } = stacksUnder("/tools/ultrapaint/preview/");
    const read: string[] = [];
    const rules = createProvenance({
      base: "/tools/ultrapaint/preview/",
      readModule: (url) => {
        read.push(url);
        return Promise.resolve(module);
      },
    });
    const at = rules.thrownAt(stackOf(frames.native, frames.mapped));
    expect(at).toEqual({
      column: 3,
      file: "src/components/page.tsx",
      line: 2,
      url: `${ORIGIN}/tools/ultrapaint/preview/src/components/page.tsx?t=17`,
    });
    expect(at && (await rules.sourceLine(at))).toBe(6);
    expect(at && (await rules.sourceLine(at))).toBe(6);
    expect(read).toHaveLength(1);
  });

  it("keeps the module's line when the module cannot be read", async () => {
    const { frames } = stacksUnder("/preview/");
    const rules = createProvenance({
      base: "/preview/",
      readModule: () => Promise.reject(new Error("gone")),
    });
    const at = rules.thrownAt(stackOf(frames.mapped));
    expect(at && (await rules.sourceLine(at))).toBe(2);
  });
});

describe("the repository's modules", () => {
  const base = "/tools/ultrapaint/preview/";
  const served = `${ORIGIN}${base}`;

  it("are told by their address, under the whole base", () => {
    expect(isRepositoryUrl(`${served}src/page.tsx?t=3`, base)).toBe(true);
    expect(isRepositoryUrl(`${served}@fs/home/u/lib/button.tsx`, base)).toBe(
      true
    );
    for (const url of [
      `${served}node_modules/.vite/deps/react.js?v=1`,
      `${served}@fs/home/u/.cache/preview/.vite/deps/react.js`,
      `${served}@vite/client`,
      `${served}@id/__x00__virtual:ultrapaint/guard`,
      `${served}@react-refresh`,
      `${ORIGIN}/preview/src/page.tsx`,
      `${ORIGIN}/assets/index.js`,
    ]) {
      expect(isRepositoryUrl(url, base)).toBe(false);
    }
  });

  it("are the ones the preview's server marked", () => {
    const url = `${served}@fs/home/u/lib/button.tsx`;
    expect(
      isRepositoryModule(url, "__edModuleStarts(import.meta.url);", base)
    ).toBe(true);
    expect(isRepositoryModule(url, "export const createPreview", base)).toBe(
      false
    );
  });

  it("are named by their path under the base", () => {
    expect(fileUnder(`${served}src/my%20page.tsx?t=1`, base)).toBe(
      "src/my page.tsx"
    );
    expect(fileUnder(`${ORIGIN}/preview/src/page.tsx`, base)).toBeNull();
  });
});
