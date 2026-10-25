/**
 * A new application for a repository that has none (ADR 0025): Vite, React, TypeScript and
 * Tailwind v4, with a set of components to design with — a button, inputs, a card, a badge, a
 * dialog, a select, tabs, a checkbox — written as shadcn writes them (ADR 0029): variants in a
 * `cva`, every part marked with `data-slot`, the dialog, select, tabs and checkbox on Base UI, so
 * the catalogue reads them as it reads any library and a spec can style each part. The theme's
 * `@theme` starts from the tokens the caller gives (a Figma file's), else from a neutral set; the
 * components use only the colours the neutral set names. Pure: the server writes the files.
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

const CN = `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class names joined, the falsy ones left out, a later Tailwind class winning over one it conflicts with. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const CHECK_ICON = `<svg
          aria-hidden="true"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3}
          viewBox="0 0 24 24"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>`;

const BUTTON = `import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-4",
        icon: "size-9",
        lg: "h-10 px-6 text-base",
        sm: "h-8 gap-1.5 px-3",
      },
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      },
    },
  }
);

/** The action of a screen or a form. */
function Button({
  className,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      className={cn(buttonVariants({ className, size, variant }))}
      data-slot="button"
      type={type}
      {...props}
    />
  );
}

export { Button, buttonVariants };
`;

const BADGE = `import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2.5 py-0.5 font-medium text-xs [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
        secondary: "bg-secondary text-secondary-foreground",
      },
    },
  }
);

/** A short status or count. */
function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ className, variant }))} data-slot="badge" {...props} />
  );
}

export { Badge, badgeVariants };
`;

const CARD = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** A surface that groups what belongs together. */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6 rounded-lg border bg-card py-6 text-card-foreground shadow-sm",
        className
      )}
      data-slot="card"
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-1.5 px-6", className)} data-slot="card-header" {...props} />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("font-semibold text-lg leading-none", className)}
      data-slot="card-title"
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="card-description"
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-6", className)} data-slot="card-content" {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-center gap-2 px-6", className)} data-slot="card-footer" {...props} />
  );
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
`;

const INPUT = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** A line of text to type. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm outline-none transition-colors file:border-0 file:bg-transparent file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
`;

const TEXTAREA = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** Several lines of text to type. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "field-sizing-content flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
`;

const LABEL = `import type * as React from "react";
import { cn } from "@/lib/cn";

/** What a field is, above or beside it. */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the caller's, by htmlFor.
    <label
      className={cn(
        "flex select-none items-center gap-2 font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      data-slot="label"
      {...props}
    />
  );
}

export { Label };
`;

const CHECKBOX = `import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "@/lib/cn";

/** A yes or no; a Label beside it says what it is about. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center text-current"
        data-slot="checkbox-indicator"
      >
        ${CHECK_ICON}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
`;

const DIALOG = `import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** A question or a form over the screen, which waits for an answer. */
function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className
      )}
      data-slot="dialog-overlay"
      {...props}
    />
  );
}

function DialogContent({
  children,
  className,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-popover p-6 text-popover-foreground shadow-lg outline-none transition-all duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:max-w-md",
          className
        )}
        data-slot="dialog-content"
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button className="absolute top-3 right-3 size-7" size="icon" variant="ghost" />}
          >
            <svg
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-slot="dialog-header" {...props} />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("font-semibold text-lg leading-none", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
`;

const SELECT = `import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "@/lib/cn";

/** One choice from a list. */
function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectPrimitive.Root.Props<Value, Multiple>
) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn("flex-1 truncate text-left", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectTrigger({ children, className, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-placeholder:text-muted-foreground data-popup-open:border-ring",
        className
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-muted-foreground" data-slot="select-icon">
        <svg
          aria-hidden="true"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  children,
  className,
  sideOffset = 4,
  ...props
}: SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, "sideOffset">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner className="z-50 outline-none" sideOffset={sideOffset}>
        <SelectPrimitive.Popup
          className={cn(
            "max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className
          )}
          data-slot="select-content"
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ children, className, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50",
        className
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        className="absolute right-2 flex items-center justify-center"
        data-slot="select-item-indicator"
      >
        ${CHECK_ICON}
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
`;

const TABS = `import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/cn";

/** Views of one thing, one at a time. */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      className={cn("flex flex-col gap-2 data-[orientation=vertical]:flex-row", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className
      )}
      data-slot="tabs-list"
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 font-medium text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:bg-background data-active:text-foreground data-active:shadow-sm data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn("flex-1 text-sm outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
`;

const APP = `import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The first screen: replace it with yours, designed in ultrapaint and implemented here. */
export const App = () => (
  <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
    <Badge variant="secondary">New</Badge>
    <Card>
      <CardHeader>
        <CardTitle>Your application</CardTitle>
        <CardDescription>Design it in ultrapaint, then implement it here.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" placeholder="you@example.com" type="email" />
      </CardContent>
      <CardFooter>
        <Button>Get started</Button>
      </CardFooter>
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
      dependencies: {
        "@base-ui/react": "^1.8.0",
        "class-variance-authority": "^0.7.1",
        clsx: "^2.1.1",
        react: "^19.3.0",
        "react-dom": "^19.3.0",
        "tailwind-merge": "^3.7.0",
      },
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
