/**
 * A new application for a repository that has none (ADR 0025): Vite, React, TypeScript and
 * Tailwind v4, with a set of plain components to design with — a button, inputs, a card, a
 * badge, a dialog, tabs — each a file of its own with its variants as typed props, so the
 * catalogue reads them as it reads any library. The theme's `@theme` starts from the tokens the
 * caller gives (a Figma file's), else from a neutral set. Pure: the server writes the files.
 */
import type { Scaffold } from "@ultrapaint/framework-api/node";

/** The theme a new application starts with when nothing else is given. */
const STARTER_TOKENS: Readonly<Record<string, string>> = {
  "color-accent": "#f4f4f5",
  "color-accent-foreground": "#18181b",
  "color-background": "#ffffff",
  "color-border": "#e4e4e7",
  "color-card": "#ffffff",
  "color-card-foreground": "#09090b",
  "color-destructive": "#dc2626",
  "color-destructive-foreground": "#ffffff",
  "color-foreground": "#09090b",
  "color-input": "#e4e4e7",
  "color-muted": "#f4f4f5",
  "color-muted-foreground": "#71717a",
  "color-popover": "#ffffff",
  "color-popover-foreground": "#09090b",
  "color-primary": "#2563eb",
  "color-primary-foreground": "#ffffff",
  "color-ring": "#2563eb",
  "color-secondary": "#f4f4f5",
  "color-secondary-foreground": "#18181b",
  "font-sans": '"Inter", ui-sans-serif, system-ui, sans-serif',
  "radius-lg": "0.75rem",
  "radius-md": "0.5rem",
  "radius-sm": "0.375rem",
};

const DARK_TOKENS: Readonly<Record<string, string>> = {
  "color-accent": "#27272a",
  "color-accent-foreground": "#fafafa",
  "color-background": "#09090b",
  "color-border": "#27272a",
  "color-card": "#18181b",
  "color-card-foreground": "#fafafa",
  "color-foreground": "#fafafa",
  "color-input": "#27272a",
  "color-muted": "#27272a",
  "color-muted-foreground": "#a1a1aa",
  "color-popover": "#18181b",
  "color-popover-foreground": "#fafafa",
  "color-secondary": "#27272a",
  "color-secondary-foreground": "#fafafa",
};

const LEADING_DOT_SLASH_RE = /^\.\/?/;

const declarations = (tokens: Readonly<Record<string, string>>) =>
  Object.entries(tokens)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
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

const CN = `/** Class names joined, the falsy ones left out. */
export const cn = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");
`;

const BUTTON = `import type * as React from "react";
import { cn } from "@/lib/cn";

const VARIANTS = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  outline: "border bg-background hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
};

const SIZES = {
  default: "h-9 px-4 text-sm",
  lg: "h-10 px-6 text-base",
  sm: "h-8 px-3 text-sm",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "default" | "sm" | "lg";
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
}

/** The action of a screen or a form. */
export const Button = ({
  className,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: ButtonProps) => (
  <button
    className={cn(
      "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
      VARIANTS[variant],
      SIZES[size],
      className
    )}
    type={type}
    {...props}
  />
);
`;

const INPUT = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** A line of text to type. */
export const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      "h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
      className
    )}
    {...props}
  />
);
`;

const TEXTAREA = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** Several lines of text to type. */
export const Textarea = ({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    className={cn(
      "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
      className
    )}
    {...props}
  />
);
`;

const LABEL = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** What a field is, above or beside it. */
export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is the caller's, by htmlFor.
  <label className={cn("font-medium text-sm", className)} {...props} />
);
`;

const SELECT = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** One choice from a short list. */
export const Select = ({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cn(
      "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring",
      className
    )}
    {...props}
  />
);
`;

const CHECKBOX = `import type * as React from "react";
import { cn } from "@/lib/cn";

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

/** A yes or no, with what it is about. */
export const Checkbox = ({ className, label, ...props }: CheckboxProps) => (
  <label className={cn("inline-flex items-center gap-2 text-sm", className)}>
    <input className="size-4 rounded border-input accent-primary" type="checkbox" {...props} />
    {label}
  </label>
);
`;

const CARD = `import type * as React from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  description?: string;
  title?: string;
}

/** A surface that groups what belongs together, with a title when it has one. */
export const Card = ({ children, className, description, title, ...props }: CardProps) => (
  <div
    className={cn("flex flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground shadow-sm", className)}
    {...props}
  >
    {title ? (
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-lg leading-none">{title}</h3>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
    ) : null}
    {children}
  </div>
);
`;

const BADGE = `import type * as React from "react";
import { cn } from "@/lib/cn";

const VARIANTS = {
  default: "bg-primary text-primary-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  outline: "border text-foreground",
  secondary: "bg-secondary text-secondary-foreground",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline" | "destructive";
}

/** A short status or count. */
export const Badge = ({ className, variant = "default", ...props }: BadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs",
      VARIANTS[variant],
      className
    )}
    {...props}
  />
);
`;

const DIALOG = `import type * as React from "react";
import { cn } from "@/lib/cn";

export interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  description?: string;
  open?: boolean;
  title: string;
}

/** A question or a form over the screen, which waits for an answer. */
export const Dialog = ({
  children,
  className,
  description,
  open = true,
  title,
  ...props
}: DialogProps) =>
  open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        aria-modal="true"
        className={cn("flex w-full max-w-md flex-col gap-4 rounded-lg border bg-popover p-6 text-popover-foreground shadow-lg", className)}
        role="dialog"
        {...props}
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-lg">{title}</h2>
          {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>
  ) : null;
`;

const TABS = `import { useState } from "react";
import { cn } from "@/lib/cn";

export interface TabsProps {
  className?: string;
  /** The tab shown first. */
  defaultValue?: string;
  tabs: { content?: string; label: string; value: string }[];
}

/** Views of one thing, one at a time. */
export const Tabs = ({ className, defaultValue, tabs }: TabsProps) => {
  const [current, setCurrent] = useState(defaultValue ?? tabs[0]?.value);
  const shown = tabs.find((t) => t.value === current);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="inline-flex w-fit rounded-md bg-muted p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            aria-selected={tab.value === current}
            className={cn(
              "rounded-sm px-3 py-1 font-medium text-sm",
              tab.value === current ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
            key={tab.value}
            onClick={() => setCurrent(tab.value)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {shown?.content ? <p className="text-sm">{shown.content}</p> : null}
    </div>
  );
};
`;

const APP = `import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The first screen: replace it with yours, designed in ultrapaint and implemented here. */
export const App = () => (
  <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
    <Badge variant="secondary">New</Badge>
    <Card description="Design it in ultrapaint, then implement it here." title="Your application">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" placeholder="you@example.com" type="email" />
      </div>
      <Button>Get started</Button>
    </Card>
  </main>
);
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

const packageJson = (name: string) =>
  `${JSON.stringify(
    {
      // The versions ultrapaint itself is built and tested with.
      dependencies: { react: "^19.3.0", "react-dom": "^19.3.0" },
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

export const scaffold: Scaffold = ({ dir, name, tokens }) => {
  const base = dir.replace(LEADING_DOT_SLASH_RE, "");
  const at = (file: string) => (base ? `${base}/${file}` : file);
  const files: Record<string, string> = {
    ".gitignore": "node_modules\ndist\n",
    "index.html": html(name),
    "package.json": packageJson(packageNameOf(name)),
    "src/App.tsx": APP,
    "src/components/ui/badge.tsx": BADGE,
    "src/components/ui/button.tsx": BUTTON,
    "src/components/ui/card.tsx": CARD,
    "src/components/ui/checkbox.tsx": CHECKBOX,
    "src/components/ui/dialog.tsx": DIALOG,
    "src/components/ui/input.tsx": INPUT,
    "src/components/ui/label.tsx": LABEL,
    "src/components/ui/select.tsx": SELECT,
    "src/components/ui/tabs.tsx": TABS,
    "src/components/ui/textarea.tsx": TEXTAREA,
    "src/index.css": stylesheet(tokens),
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
