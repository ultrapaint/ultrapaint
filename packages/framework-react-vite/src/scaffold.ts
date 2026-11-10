/**
 * A new application for a repository that has none (ADR 0025): Vite, React, TypeScript and
 * Tailwind v4, with a component for each of ultrapaint's system components (`starter-components.ts`,
 * ADR 0040): the same names, props, parts (`data-slot`) and variant axes, on Base UI where the
 * system component is, so a design implemented there maps one to one. The theme's `@theme` starts from
 * the tokens the caller gives (a Figma file's), else from the default look (ADR 0062), so a new
 * application is drawn as a new design is; the components use only the tokens the default look
 * names. A blank application (PLAN-desktop D11) has none of the
 * components and a theme that declares nothing, for a design system defined from nothing; its
 * component directory is there, empty. Pure: the server writes the files.
 */
import type { ScaffoldTemplate } from "@ultrapaint/contracts/setup";
import { DEFAULT_LOOK } from "@ultrapaint/system-components/default-look";
import { STARTER_APP, STARTER_COMPONENTS } from "./starter-components.ts";

/** A new application's files, repo-relative, and the settings that point the tool at it. */
interface Scaffolded {
  readonly files: Readonly<Record<string, string>>;
  /** Relative to the repository. */
  readonly settings: {
    readonly hostCss: string;
    readonly libraryDir: string;
    readonly resolveFrom: string;
  };
}

/**
 * What a theme declares of the default look: its colours, fonts, radii and shadows. Its type
 * scale and spacing are Tailwind's own, which the stylesheet imports.
 */
const LOOK_TOKENS = [
  ...DEFAULT_LOOK.colors.flatMap((group) => group.tokens),
  ...DEFAULT_LOOK.typography.fonts,
  ...DEFAULT_LOOK.radius,
  ...DEFAULT_LOOK.shadows,
];

/** The theme a new application starts with when nothing else is given: the default look's. */
const STARTER_TOKENS: Readonly<Record<string, string>> = Object.fromEntries(
  LOOK_TOKENS.map((token) => [token.name, token.value])
);

const DARK_TOKENS: Readonly<Record<string, string>> = Object.fromEntries(
  LOOK_TOKENS.flatMap((token) =>
    token.values?.dark === undefined ? [] : [[token.name, token.values.dark]]
  )
);

const LEADING_DOT_SLASH_RE = /^\.\/?/;

/** A theme's declarations, in English's order whatever the machine's language. */
const declarations = (tokens: Readonly<Record<string, string>>) =>
  Object.entries(tokens)
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");

const stylesheet = (tokens: Readonly<Record<string, string>>) => {
  const own = Object.keys(tokens).length > 0;
  const theme = own ? tokens : STARTER_TOKENS;
  return `@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/* The design system's tokens: ultrapaint reads them from here, and writes them here. */
@theme {
${declarations(theme)}
}
${
  own
    ? ""
    : `
.dark {
${declarations(DARK_TOKENS)}
}
`
}
@layer base {
  * {
    border-color: var(--color-border);
  }
  body {
    background: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
  }
}
`;
};

/**
 * A blank application's stylesheet: Tailwind, and a theme that declares nothing of its own, which
 * the design system fills in once it is defined. The tokens given (a Figma file's) when there are.
 */
const blankStylesheet = (tokens: Readonly<Record<string, string>>) => {
  const declared = declarations(tokens);
  return `@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/* The design system's tokens: ultrapaint reads them from here, and writes them here. */
@theme {
${declared ? `${declared}\n` : ""}}
`;
};

const CN = `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class names joined, the falsy ones left out, a later Tailwind class winning over one it conflicts with. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

/** A blank application's first screen: nothing on it, for the first page to be designed. */
const BLANK_APP = `/** The first screen: design it in Ultrapaint, then implement it here. */
export const App = () => <main className="min-h-screen" />;
`;

const MAIN = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;

const VITE_CONFIG = `import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
`;

const html = (name: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

/**
 * The versions ultrapaint itself is built and tested with. A blank application leaves out
 * Base UI, which only the starter's components use; it keeps what a component written the
 * shadcn way needs, for the first one implemented.
 */
const dependenciesOf = (template: ScaffoldTemplate) => ({
  ...(template === "starter" && { "@base-ui/react": "^1.8.0" }),
  "class-variance-authority": "^0.7.1",
  clsx: "^2.1.1",
  react: "^19.3.0",
  "react-dom": "^19.3.0",
  "tailwind-merge": "^3.7.0",
});

const packageJson = (name: string, template: ScaffoldTemplate) =>
  `${JSON.stringify(
    {
      dependencies: dependenciesOf(template),
      devDependencies: {
        "@tailwindcss/vite": "^4.3.3",
        "@types/node": "^24.0.0",
        "@types/react": "^19.3.0",
        "@types/react-dom": "^19.3.0",
        "@vitejs/plugin-react": "^6.1.1",
        tailwindcss: "^4.3.3",
        typescript: "^7.0.2",
        vite: "^8.3.0",
      },
      name,
      private: true,
      scripts: {
        build: "tsc && vite build",
        dev: "vite",
        preview: "vite preview",
      },
      type: "module",
      version: "0.0.0",
    },
    null,
    2
  )}\n`;

/** A package name from anything: lower case, dashes. */
const packageNameOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app";

/** A new application to start from, for a repository that has none (ADR 0025). */
export const scaffold = ({
  dir,
  name,
  template = "starter",
  tokens,
}: {
  /** Repo-relative directory the application goes in; `.` for the root. */
  readonly dir: string;
  /** The application's name, for its package.json. */
  readonly name: string;
  readonly template?: ScaffoldTemplate;
  /** Tokens to start the theme with, by name; the template's own when empty. */
  readonly tokens: Readonly<Record<string, string>>;
}): Scaffolded => {
  const base = dir.replace(LEADING_DOT_SLASH_RE, "");
  const at = (file: string) => (base ? `${base}/${file}` : file);
  const starter = template === "starter";
  const files: Record<string, string> = {
    ".gitignore": "node_modules\ndist\n",
    "index.html": html(name),
    "package.json": packageJson(packageNameOf(name), template),
    ...(starter
      ? Object.fromEntries(
          Object.entries(STARTER_COMPONENTS).map(([file, text]) => [
            `src/${file}`,
            text,
          ])
        )
      : // Where the components go once there are some: the settings point at it from the start.
        { "src/components/.gitkeep": "" }),
    "src/App.tsx": starter ? STARTER_APP : BLANK_APP,
    "src/index.css": starter ? stylesheet(tokens) : blankStylesheet(tokens),
    "src/lib/cn.ts": CN,
    "src/main.tsx": MAIN,
    "tsconfig.json": TSCONFIG,
    "vite.config.ts": VITE_CONFIG,
  };
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([file, text]) => [at(file), text])
    ),
    settings: {
      hostCss: at("src/index.css"),
      libraryDir: at("src/components"),
      resolveFrom: base || ".",
    },
  };
};
