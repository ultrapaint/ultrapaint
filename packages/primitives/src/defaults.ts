/**
 * Each primitive's default look as data (ADR 0040): a component spec (ADR 0029) in the design
 * document's own style fields, over the design system's tokens (`$color-primary`). `look.ts`
 * draws them under the project's specs; taking a primitive's look over starts the project's spec
 * from its default, so the designer edits real values. What a spec cannot say stays in `look.ts`:
 * layout, positioning, a dialog's sheet on a narrow frame, animations, and what a pointer or a
 * state does to a part.
 */
import type { Sides } from "@ultrapaint/contracts/document";
import { PRIMITIVES_FROM } from "@ultrapaint/contracts/spec-names";
import type {
  ComponentSpec,
  SlotStyles,
  SpecStyle,
} from "@ultrapaint/contracts/specs";
import { PRIMITIVES, type PrimitiveMeta } from "./catalogue.ts";

/** The same length above and below, and the same on either side. */
const pad = (block: string | number, inline: string | number): Sides => ({
  bottom: block,
  left: inline,
  right: inline,
  top: block,
});
const line = (color: string): SpecStyle["border"] => ({
  color,
  width: "1px",
});

const POPUP_SHADOW =
  "0 10px 30px -10px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(0 0 0 / 0.06)";
const ROUND = "9999px";

/** A popup's surface: a select's, a menu's, a popover's. */
const popup: SpecStyle = {
  color: "$color-popover-foreground",
  fill: "$color-popover",
  fontSize: "0.875rem",
  radius: "$radius-md",
  shadow: POPUP_SHADOW,
};
/** An item of a select or a menu. */
const item: SpecStyle = {
  gap: "0.5rem",
  padding: pad("0.375rem", "0.5rem"),
  radius: "$radius-sm",
};
/** A field's label and the box a value is typed or chosen in. */
const label: SpecStyle = {
  color: "$color-foreground",
  fontSize: "0.875rem",
  fontWeight: 500,
};
const field: SpecStyle = {
  border: line("$color-input"),
  color: "$color-foreground",
  fill: "transparent",
  fontSize: "0.875rem",
  radius: "$radius-md",
};

interface Look {
  readonly base: SlotStyles;
  readonly variants?: ComponentSpec["variants"];
}

const LOOKS: Readonly<Record<string, Look>> = {
  Avatar: {
    base: {
      root: {
        color: "$color-secondary-foreground",
        fill: "$color-secondary",
        fontSize: "0.875rem",
        fontWeight: 500,
        height: "2.5rem",
        radius: ROUND,
        width: "2.5rem",
      },
    },
    variants: {
      size: {
        lg: {
          root: { fontSize: "1.125rem", height: "3.5rem", width: "3.5rem" },
        },
        sm: { root: { fontSize: "0.75rem", height: "2rem", width: "2rem" } },
      },
    },
  },
  Badge: {
    base: {
      root: {
        border: line("transparent"),
        color: "$color-primary-foreground",
        fill: "$color-primary",
        fontSize: "0.75rem",
        fontWeight: 600,
        gap: "0.25rem",
        padding: pad("0.125rem", "0.625rem"),
        radius: ROUND,
      },
    },
    variants: {
      variant: {
        destructive: {
          root: {
            color: "$color-destructive-foreground",
            fill: "$color-destructive",
          },
        },
        outline: {
          root: {
            border: { color: "$color-border" },
            color: "$color-foreground",
            fill: "transparent",
          },
        },
        secondary: {
          root: {
            color: "$color-secondary-foreground",
            fill: "$color-secondary",
          },
        },
      },
    },
  },
  Button: {
    base: {
      root: {
        border: line("transparent"),
        color: "$color-primary-foreground",
        fill: "$color-primary",
        fontSize: "0.875rem",
        fontWeight: 500,
        gap: "0.5rem",
        height: "2.25rem",
        padding: pad(0, "1rem"),
        radius: "$radius-md",
      },
    },
    // The size first: a link's padding and height win over a size's.
    variants: {
      size: {
        icon: { root: { padding: 0, width: "2.25rem" } },
        lg: {
          root: {
            fontSize: "0.9375rem",
            height: "2.75rem",
            padding: pad(0, "1.5rem"),
          },
        },
        sm: {
          root: {
            fontSize: "0.8125rem",
            height: "2rem",
            padding: pad(0, "0.75rem"),
          },
        },
      },
      variant: {
        destructive: {
          root: {
            color: "$color-destructive-foreground",
            fill: "$color-destructive",
          },
        },
        ghost: { root: { color: "$color-foreground", fill: "transparent" } },
        link: {
          root: {
            color: "$color-primary",
            fill: "transparent",
            height: "auto",
            padding: 0,
          },
        },
        outline: {
          root: {
            border: { color: "$color-input" },
            color: "$color-foreground",
            fill: "$color-background",
          },
        },
        secondary: {
          root: {
            color: "$color-secondary-foreground",
            fill: "$color-secondary",
          },
        },
      },
    },
  },
  Card: {
    base: {
      "card-content": { gap: "0.75rem", padding: pad(0, "1.5rem") },
      "card-description": {
        color: "$color-muted-foreground",
        fontSize: "0.875rem",
      },
      "card-footer": { gap: "0.5rem", padding: pad(0, "1.5rem") },
      "card-header": { gap: "0.375rem", padding: pad(0, "1.5rem") },
      "card-title": { fontSize: "1rem", fontWeight: 600 },
      root: {
        border: line("$color-border"),
        color: "$color-card-foreground",
        fill: "$color-card",
        gap: "1.5rem",
        padding: pad("1.5rem", 0),
        radius: "$radius-lg",
        shadow: "0 1px 2px rgb(0 0 0 / 0.05)",
      },
    },
  },
  Checkbox: {
    base: {
      checkbox: {
        border: line("$color-input"),
        color: "$color-primary-foreground",
        fill: "transparent",
        height: "1rem",
        radius: "0.25rem",
        width: "1rem",
      },
      root: { fontSize: "0.875rem", gap: "0.5rem" },
    },
  },
  Dialog: {
    base: {
      dialog: {
        border: line("$color-border"),
        color: "$color-foreground",
        fill: "$color-background",
        gap: "1rem",
        padding: "1.5rem",
        radius: "$radius-lg",
        shadow: POPUP_SHADOW,
      },
      "dialog-backdrop": { fill: "rgb(0 0 0 / 0.5)" },
      "dialog-close": {
        color: "$color-muted-foreground",
        fill: "transparent",
        height: "1.75rem",
        radius: "$radius-sm",
        width: "1.75rem",
      },
      "dialog-content": { gap: "0.75rem" },
      "dialog-description": {
        color: "$color-muted-foreground",
        fontSize: "0.875rem",
      },
      "dialog-footer": { gap: "0.5rem" },
      "dialog-header": { gap: "0.5rem" },
      "dialog-title": { fontSize: "1.125rem", fontWeight: 600 },
    },
  },
  Input: {
    base: {
      "field-label": label,
      input: { ...field, height: "2.25rem", padding: pad(0, "0.75rem") },
      root: { gap: "0.375rem" },
    },
    variants: {
      size: {
        lg: { input: { height: "2.75rem" } },
        sm: { input: { height: "2rem" } },
      },
    },
  },
  Menu: {
    base: {
      "menu-item": item,
      "menu-popup": { ...popup, padding: "0.25rem" },
      "menu-separator": { fill: "$color-border", height: "1px" },
    },
  },
  Popover: {
    base: {
      popover: { ...popup, padding: "1rem", width: "18rem" },
      "popover-content": { gap: "0.5rem" },
      "popover-title": { fontSize: "0.9375rem", fontWeight: 600 },
    },
  },
  Select: {
    base: {
      "field-label": label,
      root: { gap: "0.375rem" },
      "select-item": {
        ...item,
        padding: { ...pad("0.375rem", "0.5rem"), left: "1.75rem" },
      },
      "select-popup": { ...popup, padding: "0.25rem" },
      "select-trigger": {
        ...field,
        gap: "0.5rem",
        height: "2.25rem",
        padding: pad(0, "0.75rem"),
      },
    },
  },
  Separator: { base: { root: { fill: "$color-border" } } },
  Spinner: {
    base: { root: { height: "1rem", width: "1rem" } },
    variants: {
      size: {
        lg: { root: { height: "1.5rem", width: "1.5rem" } },
        sm: { root: { height: "0.75rem", width: "0.75rem" } },
      },
    },
  },
  Switch: {
    base: {
      root: { fontSize: "0.875rem", gap: "0.5rem" },
      switch: {
        fill: "$color-input",
        height: "1.25rem",
        padding: "2px",
        radius: ROUND,
        width: "2.25rem",
      },
      "switch-thumb": {
        fill: "$color-background",
        height: "1rem",
        radius: ROUND,
        shadow: "0 1px 2px rgb(0 0 0 / 0.2)",
        width: "1rem",
      },
    },
  },
  Tabs: {
    base: {
      root: { gap: "1rem" },
      tab: {
        color: "$color-muted-foreground",
        fontSize: "0.875rem",
        fontWeight: 500,
        padding: pad("0.5rem", "0.75rem"),
      },
      "tab-panel": { gap: "0.75rem" },
      "tabs-indicator": { fill: "$color-primary", height: "2px" },
      "tabs-list": {
        border: { color: "$color-border", width: "0 0 1px 0" },
        gap: "0.25rem",
      },
    },
  },
  Textarea: {
    base: {
      "field-label": label,
      root: { gap: "0.375rem" },
      textarea: { ...field, padding: pad("0.5rem", "0.75rem") },
    },
  },
  Toast: {
    base: {
      root: {
        border: line("$color-border"),
        color: "$color-popover-foreground",
        fill: "$color-popover",
        fontSize: "0.875rem",
        gap: "0.25rem",
        padding: pad("0.875rem", "1rem"),
        radius: "$radius-lg",
        shadow: POPUP_SHADOW,
      },
      "toast-action": { gap: "0.5rem" },
      "toast-description": { opacity: 0.85 },
      "toast-title": { fontWeight: 600 },
    },
    variants: {
      variant: {
        destructive: {
          root: {
            border: { color: "transparent" },
            color: "$color-destructive-foreground",
            fill: "$color-destructive",
          },
        },
      },
    },
  },
  Tooltip: {
    base: {
      tooltip: {
        color: "$color-primary-foreground",
        fill: "$color-primary",
        fontSize: "0.75rem",
        padding: pad("0.375rem", "0.625rem"),
        radius: "$radius-sm",
      },
    },
  },
};

const specOf = (meta: PrimitiveMeta): ComponentSpec => {
  const look = LOOKS[meta.name] ?? { base: {} };
  return {
    base: look.base,
    component: meta.name,
    defaults: Object.fromEntries(
      Object.entries(meta.variants).flatMap(([axis, members]) =>
        members[0] === undefined ? [] : [[axis, members[0]]]
      )
    ),
    description: meta.description,
    from: PRIMITIVES_FROM,
    look: "design",
    slots: meta.slots.map((s) => ({ label: s.label, name: s.name })),
    states: {},
    variants: look.variants ?? {},
    version: 1,
  };
};

/** Every primitive's default look, as a spec. */
export const PRIMITIVE_DEFAULTS: readonly ComponentSpec[] =
  PRIMITIVES.map(specOf);

const byName = new Map(PRIMITIVE_DEFAULTS.map((s) => [s.component, s]));

/** A primitive's default look, as a spec; undefined for a name that is no primitive. */
export const defaultSpecOf = (component: string): ComponentSpec | undefined =>
  byName.get(component);
