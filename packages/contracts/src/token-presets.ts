/**
 * How a design system names its colour tokens (ADR 0062), one preset per system: **simple** roles
 * (`color-primary`, `color-muted-foreground`, shadcn's names) or **detailed** tokens by property
 * and meaning (`text-color-subtle`, `background-color-danger-subtle`, `border-color-focus`,
 * Atlassian's way), written in Tailwind v4's per-property namespaces so the code's classes read
 * `text-subtle`, `bg-danger-subtle`, `border-focus`. The system components read their colours by
 * role; in a detailed system each role is the detailed token this table names.
 */
import { Schema } from "effect";

export const TokenPreset = Schema.Literals(["simple", "detailed"]);
export type TokenPreset = typeof TokenPreset.Type;

/** The namespaces a detailed system's colours are in, each a group of its own. */
export const DETAILED_GROUPS = [
  { name: "Text", prefix: "text-color-" },
  { name: "Background", prefix: "background-color-" },
  { name: "Border", prefix: "border-color-" },
] as const;

/** Each role the system components read, and the detailed token it is in a detailed system. */
export const DETAILED_ROLES: Readonly<Record<string, string>> = {
  "color-accent": "background-color-neutral-hovered",
  "color-accent-foreground": "text-color-default",
  "color-background": "background-color-default",
  "color-border": "border-color-default",
  "color-card": "background-color-raised",
  "color-card-foreground": "text-color-default",
  "color-destructive": "background-color-danger-bold",
  "color-destructive-foreground": "text-color-inverse",
  "color-foreground": "text-color-default",
  "color-input": "border-color-input",
  "color-muted": "background-color-neutral",
  "color-muted-foreground": "text-color-subtle",
  "color-popover": "background-color-overlay",
  "color-popover-foreground": "text-color-default",
  "color-primary": "background-color-brand-bold",
  "color-primary-foreground": "text-color-on-brand",
  "color-ring": "border-color-focus",
  "color-secondary": "background-color-neutral",
  "color-secondary-foreground": "text-color-default",
};
