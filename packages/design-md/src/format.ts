/**
 * The DESIGN.md format (github.com/google-labs-code/design.md, version `alpha`): YAML front
 * matter with design tokens, then a markdown body in `##` sections. What this package reads and
 * writes of it (ADR 0027). Pure and synchronous, like the framework packages.
 */

/** The version of the format this package writes and reads. */
export const FORMAT_VERSION = "alpha";

/** The file's name, at the root of the repository. */
export const DESIGN_MD_FILE = "DESIGN.md";

/** The body's sections in the order the format gives them, with the headings that also name them. */
export const SECTIONS = [
  { aliases: ["Brand & Style"], name: "Overview" },
  { aliases: [], name: "Colors" },
  { aliases: [], name: "Typography" },
  { aliases: ["Layout & Spacing"], name: "Layout" },
  { aliases: ["Elevation"], name: "Elevation & Depth" },
  { aliases: [], name: "Shapes" },
  { aliases: [], name: "Components" },
  { aliases: [], name: "Do's and Don'ts" },
] as const;

export type SectionName = (typeof SECTIONS)[number]["name"];

const normalise = (heading: string) =>
  heading.trim().toLowerCase().replaceAll("’", "'");

/** The section a `##` heading names, or null for one the format does not know. */
export const sectionOf = (heading: string): SectionName | null => {
  const wanted = normalise(heading);
  const found = SECTIONS.find(
    (s) =>
      normalise(s.name) === wanted ||
      s.aliases.some((alias) => normalise(alias) === wanted)
  );
  return found?.name ?? null;
};

/** The front matter's token groups the code's values fill in; the rest is the file's authors'. */
export const MIRRORED_GROUPS = [
  "colors",
  "typography",
  "rounded",
  "spacing",
  "components",
] as const;
export type MirroredGroup = (typeof MIRRORED_GROUPS)[number];

/** The front matter's keys in the format's order, for placing one that is added. */
export const KEY_ORDER = [
  "version",
  "name",
  "description",
  "colors",
  "typography",
  "rounded",
  "spacing",
  "components",
] as const;

/** One typography token: a text style's settings as values. */
export interface Typography {
  readonly fontFamily?: string;
  readonly fontFeature?: string;
  readonly fontSize?: string;
  readonly fontVariation?: string;
  readonly fontWeight?: number;
  readonly letterSpacing?: string;
  readonly lineHeight?: number | string;
}

/**
 * One component token: its properties (`backgroundColor`, `textColor`, `rounded`, `padding`,
 * `height`, `width`, `size`), each a reference (`{colors.primary}`) or a value.
 */
export type ComponentToken = Readonly<Record<string, string>>;

/** The mirrored groups, by token key. */
export interface TokenGroups {
  readonly colors: Readonly<Record<string, string>>;
  readonly components: Readonly<Record<string, ComponentToken>>;
  readonly rounded: Readonly<Record<string, string>>;
  readonly spacing: Readonly<Record<string, number | string>>;
  readonly typography: Readonly<Record<string, Typography>>;
}

export const emptyGroups = (): TokenGroups => ({
  colors: {},
  components: {},
  rounded: {},
  spacing: {},
  typography: {},
});
