import type {
  PageFiles,
  PageTemplateInput,
} from "@ultrapaint/framework-api/node";
import { humanise } from "@ultrapaint/shared/path";
import { ROUTER_MODULE_FILE, routerModuleSource } from "./router-module.ts";

const TSX_EXT_RE = /\.tsx$/;
const NON_PAGE_TSX_RE = /\.(stories|test|spec)\.tsx$/;
const LEADING_LETTER_RE = /^[A-Za-z]/;
const BRACKETS_RE = /[[\].]/g;

export const pageTemplates = [
  { id: "blank", name: "Blank" },
  { id: "centered", name: "Centered content" },
  { id: "page", name: "Page with header" },
] as const;

/** `sign-in.tsx` becomes `SignIn`; a name that cannot start an identifier gets a prefix. */
export const componentName = (fileName: string) => {
  const base = fileName.replace(TSX_EXT_RE, "").replaceAll(BRACKETS_RE, "");
  const pascal = base.replaceAll(/(^|[-_ ])(\w)/g, (_, __, c: string) =>
    c.toUpperCase()
  );
  return LEADING_LETTER_RE.test(pascal) ? pascal : `Page${pascal}`;
};

export const pageFileName = (name: string) =>
  `${
    name
      .trim()
      .replaceAll(/[^A-Za-z0-9-_]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .toLowerCase() || "page"
  }.tsx`;

export const renderTemplate = (
  id: string,
  { fileName, route, routerImport }: PageTemplateInput
): string => {
  const name = componentName(fileName);
  const title = humanise(fileName);
  switch (id) {
    case "centered":
      return `export default function ${name}() {\n  return (\n    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background-100 p-8">\n      <h1 className="font-semibold text-2xl text-foreground">${title}</h1>\n      <p className="text-muted">Start designing here.</p>\n    </main>\n  );\n}\n`;
    case "page": {
      // The header of the home page has nowhere to go back to.
      const back =
        route === "/"
          ? '<span className="text-muted">Home</span>'
          : '<Link className="text-muted hover:text-foreground" to="/">Home</Link>';
      const importLine =
        route === "/"
          ? ""
          : `import { Link } from ${JSON.stringify(routerImport)};\n\n`;
      return `${importLine}export default function ${name}() {\n  return (\n    <main className="flex min-h-screen flex-col bg-background-100">\n      <header className="flex items-center justify-between border-border-100 border-b px-6 py-4">\n        <span className="font-semibold text-foreground">${title}</span>\n        ${back}\n      </header>\n      <section className="flex flex-1 flex-col gap-4 p-6">\n        <p className="text-muted">Start designing here.</p>\n      </section>\n    </main>\n  );\n}\n`;
    }
    default:
      return `export default function ${name}() {\n  return <main className="min-h-screen bg-background-100 p-8" />;\n}\n`;
  }
};

/** Pages are TSX modules whose default export is the page component. */
export const pages: PageFiles = {
  // The component is named after the file, so a copy is renamed with it.
  duplicate: (content, from, to) =>
    content.replace(
      new RegExp(`export default function ${componentName(from)}\\b`),
      `export default function ${componentName(to)}`
    ),
  extension: ".tsx",
  fileName: pageFileName,
  isPageFile: (name) =>
    TSX_EXT_RE.test(name) &&
    !NON_PAGE_TSX_RE.test(name) &&
    !name.startsWith("_"),
  render: renderTemplate,
  routerModule: {
    content: routerModuleSource,
    fileName: ROUTER_MODULE_FILE,
  },
  templates: pageTemplates,
};
