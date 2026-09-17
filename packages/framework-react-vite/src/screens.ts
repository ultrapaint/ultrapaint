import type { ScreenFiles } from "@ultrapaint/framework-api/node";
import { humanise } from "@ultrapaint/shared/path";

const TSX_EXT_RE = /\.tsx$/;
const NON_SCREEN_TSX_RE = /\.(stories|test|spec)\.tsx$/;
const LEADING_LETTER_RE = /^[A-Za-z]/;

export const screenTemplates = [
  { id: "blank", name: "Blank" },
  { id: "centered", name: "Centered content" },
  { id: "page", name: "Page with header" },
] as const;

/** `sign-in.tsx` becomes `SignIn`; a name that cannot start an identifier gets a prefix. */
export const componentName = (fileName: string) => {
  const base = fileName.replace(TSX_EXT_RE, "");
  const pascal = base.replaceAll(/(^|[-_ ])(\w)/g, (_, __, c: string) =>
    c.toUpperCase()
  );
  return LEADING_LETTER_RE.test(pascal) ? pascal : `Screen${pascal}`;
};

export const screenFileName = (name: string) =>
  `${
    name
      .trim()
      .replaceAll(/[^A-Za-z0-9-_]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .toLowerCase() || "screen"
  }.tsx`;

export const renderTemplate = (id: string, name: string): string => {
  switch (id) {
    case "centered":
      return `export default function ${name}() {\n  return (\n    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background-100 p-8">\n      <h1 className="font-semibold text-2xl text-foreground">${humanise(name)}</h1>\n      <p className="text-muted">Start designing here.</p>\n    </main>\n  );\n}\n`;
    case "page":
      return `export default function ${name}() {\n  return (\n    <main className="flex min-h-screen flex-col bg-background-100">\n      <header className="flex items-center justify-between border-border-100 border-b px-6 py-4">\n        <span className="font-semibold text-foreground">${humanise(name)}</span>\n      </header>\n      <section className="flex flex-1 flex-col gap-4 p-6">\n        <p className="text-muted">Start designing here.</p>\n      </section>\n    </main>\n  );\n}\n`;
    default:
      return `export default function ${name}() {\n  return <main className="min-h-screen bg-background-100 p-8" />;\n}\n`;
  }
};

/** Screens are TSX modules whose default export is the screen component. */
export const screens: ScreenFiles = {
  // The component is named after the file, so a copy is renamed with it.
  duplicate: (content, from, to) =>
    content.replace(
      new RegExp(`export default function ${componentName(from)}\\b`),
      `export default function ${componentName(to)}`
    ),
  extension: ".tsx",
  fileName: screenFileName,
  isScreenFile: (name) =>
    TSX_EXT_RE.test(name) &&
    !NON_SCREEN_TSX_RE.test(name) &&
    !name.startsWith("_"),
  render: (templateId, fileName) =>
    renderTemplate(templateId, componentName(fileName)),
  templates: screenTemplates,
};
