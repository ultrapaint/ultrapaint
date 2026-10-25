import type { SourceToken } from "@ultrapaint/contracts/tokens";
import { describe, expect, it } from "vitest";
import { componentSpec } from "./component-spec.ts";

const token = (name: string, value = "x"): SourceToken => ({
  kind: "other",
  name,
  own: true,
  value,
});

const tokens = [
  "color-primary",
  "color-primary-foreground",
  "color-secondary",
  "color-secondary-foreground",
  "color-destructive",
  "color-background",
  "color-accent",
  "color-accent-foreground",
  "color-input",
  "color-ring",
  "color-border",
  "radius-md",
].map((name) => token(name));

/** shadcn's button, as the catalogue reads its cva. */
const BUTTON = {
  base: "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  classes: {
    size: {
      default: "h-9 px-4 py-2 has-[>svg]:px-3",
      icon: "size-9",
      lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
      sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
    },
    variant: {
      default: "bg-primary text-primary-foreground hover:bg-primary/90",
      destructive:
        "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      link: "text-primary underline-offset-4 hover:underline",
      outline:
        "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    },
  },
  defaults: { size: "default", variant: "default" },
};

describe("componentSpec", () => {
  it("reads a shadcn button into its base, its variants and its states", () => {
    expect(componentSpec(BUTTON, tokens)).toEqual({
      base: {
        root: {
          fontSize: "$text-sm",
          fontWeight: "$font-weight-medium",
          gap: "$spacing-2",
          radius: "$radius-md",
        },
      },
      defaults: { size: "default", variant: "default" },
      states: {
        disabled: { root: { opacity: 0.5 } },
        focus: { root: { border: { color: "$color-ring" } } },
        invalid: { root: { border: { color: "$color-destructive" } } },
      },
      variants: {
        size: {
          default: {
            root: {
              height: "$spacing-9",
              padding: {
                bottom: "$spacing-2",
                left: "$spacing-4",
                right: "$spacing-4",
                top: "$spacing-2",
              },
            },
          },
          icon: { root: { height: "$spacing-9", width: "$spacing-9" } },
          lg: {
            root: {
              height: "$spacing-10",
              padding: { left: "$spacing-6", right: "$spacing-6" },
              radius: "$radius-md",
            },
          },
          sm: {
            root: {
              gap: "$spacing-1.5",
              height: "$spacing-8",
              padding: { left: "$spacing-3", right: "$spacing-3" },
              radius: "$radius-md",
            },
          },
        },
        variant: {
          default: {
            root: {
              color: "$color-primary-foreground",
              fill: "$color-primary",
            },
          },
          destructive: { root: { color: "#fff", fill: "$color-destructive" } },
          link: { root: { color: "$color-primary" } },
          outline: {
            root: {
              border: { width: 1 },
              fill: "$color-background",
              shadow: "$shadow-xs",
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
    });
  });

  it("reads the state classes of the member an axis starts in, and of no other", () => {
    const spec = componentSpec(
      {
        base: "",
        classes: {
          variant: {
            ghost: "hover:bg-accent",
            solid: "bg-primary hover:bg-accent hover:text-accent-foreground",
          },
        },
        defaults: { variant: "ghost" },
      },
      tokens
    );
    expect(spec.states).toEqual({ hover: { root: { fill: "$color-accent" } } });
    // A member with nothing but other states' classes has no entry.
    expect(spec.variants).toEqual({
      variant: { solid: { root: { fill: "$color-primary" } } },
    });
  });

  it("reads every state the headless libraries say", () => {
    const { states } = componentSpec(
      {
        base: [
          "hover:bg-accent",
          "focus:bg-ring",
          "active:bg-primary",
          "data-disabled:opacity-40",
          "aria-disabled:opacity-[0.3]",
          "data-[state=open]:bg-secondary",
          'data-[state="checked"]:bg-primary',
          "aria-checked:text-primary-foreground",
          "data-invalid:border-destructive",
        ].join(" "),
        classes: {},
        defaults: {},
      },
      tokens
    );
    expect(states).toEqual({
      active: { root: { fill: "$color-primary" } },
      checked: {
        root: { color: "$color-primary-foreground", fill: "$color-primary" },
      },
      disabled: { root: { opacity: 0.3 } },
      focus: { root: { fill: "$color-ring" } },
      hover: { root: { fill: "$color-accent" } },
      invalid: { root: { border: { color: "$color-destructive" } } },
      open: { root: { fill: "$color-secondary" } },
    });
  });

  it("takes arbitrary values as CSS, and leaves out what a spec cannot say", () => {
    const { base } = componentSpec(
      {
        base: "bg-[#f7f5f2] text-[13px] text-[#333] p-[13px] rounded-[6px] border-[1.5px] border-dashed border-[color:var(--edge)] h-[calc(100%_-_2px)] w-full opacity-[85%] font-[550] shadow-[0_1px_2px_rgb(0_0_0/0.1)] dark:bg-primary sm:p-4 group-hover:bg-accent *:p-2 bg-primary/90 border-t-2 rounded-t-md text-left font-sans",
        classes: {},
        defaults: {},
      },
      tokens
    );
    expect(base).toEqual({
      root: {
        border: { color: "var(--edge)", style: "dashed", width: "1.5px" },
        color: "#333",
        fill: "#f7f5f2",
        fontSize: "13px",
        fontWeight: 550,
        height: "calc(100% - 2px)",
        opacity: 0.85,
        padding: "13px",
        radius: "6px",
        shadow: "0 1px 2px rgb(0 0 0/0.1)",
        width: "100%",
      },
    });
  });

  it("names tokens the theme declares, and Tailwind's scale steps", () => {
    const { base } = componentSpec(
      {
        base: "text-body font-weight-x font-bold rounded-xl rounded shadow-card p-(--gutter) pt-0.5 border-2 border-border",
        classes: {},
        defaults: {},
      },
      [...tokens, token("text-body"), token("shadow-card")]
    );
    expect(base).toEqual({
      root: {
        border: { color: "$color-border", width: 2 },
        fontSize: "$text-body",
        fontWeight: "$font-weight-bold",
        // `rounded` with no `--radius` is Tailwind's 0.25rem; the later class wins.
        padding: {
          bottom: "var(--gutter)",
          left: "var(--gutter)",
          right: "var(--gutter)",
          top: "$spacing-0.5",
        },
        radius: "0.25rem",
        shadow: "$shadow-card",
      },
    });
  });

  it("gives empty fields for classes that set nothing", () => {
    expect(
      componentSpec(
        {
          base: "inline-flex items-center",
          classes: { size: { sm: "" } },
          defaults: { size: "sm" },
        },
        tokens
      )
    ).toEqual({ base: {}, defaults: { size: "sm" }, states: {}, variants: {} });
  });
});
