/**
 * The first implementation of a designs-only project (ADR 0062): there is no application yet, so
 * the stack is settled with the user before any code, each choice filled in from the design
 * system (its typeface, its icons' stroke, how its colours are named), and the application is
 * written in it. A project with an application says nothing here.
 */
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { CONFIG_FILE_NAMES } from "@ultrapaint/contracts/settings";
import { Effect, type FileSystem } from "effect";
import { RepoPaths } from "../repo-paths.ts";
import type { AgentWays } from "./agent-ways.ts";

const QUOTED_FACE_RE = /^\s*["']([^"']+)["']/;

/** The design system's sans by its family's name, when it names one: `"Figtree", …` is Figtree. */
const faceOf = (ds: DesignSystem | null) => {
  const sans = ds?.typography.fonts.find((f) => f.name === "font-sans");
  const quoted = sans ? QUOTED_FACE_RE.exec(sans.value) : null;
  return quoted ? quoted[1] : undefined;
};

/** Fontsource's package for a family: `IBM Plex Sans` is `@fontsource-variable/ibm-plex-sans`. */
const fontsourceOf = (face: string) =>
  `@fontsource-variable/${face.toLowerCase().replaceAll(" ", "-")}`;

/** The step a first implementation starts with, the stack's choices filled in from `ds`. */
export const stackStep = (ds: DesignSystem | null, ways: AgentWays) => {
  const face = faceOf(ds);
  const stroke = ds?.icons?.stroke ?? 2;
  const detailed = ds?.tokenPreset === "detailed";
  const save = ways.tools
    ? `call ${ways.tools.save_setup} with stylesheet, the stylesheet's path, so the editor reads the code's tokens from now on`
    : "tell the user to set the stylesheet in the settings, so the editor reads the code's tokens";
  return `This project is designs only: it has no application yet. Before any code, settle its stack with the
user ${ways.askUser}, in one question whose choices are filled in from the design system, the first
of each recommended:
- Framework: React with Vite, or Next.js.
- Styling: Tailwind CSS v4, its @theme written from the design system's tokens${detailed ? " in their own namespaces (--text-color-*, --background-color-*, --border-color-*), with the roles the components read (--color-primary…) set to them" : ""}.
- Typeface: ${face ? `${face}, from ${fontsourceOf(face)}` : "the system's own sans"}.
- Icons: lucide-react, at strokeWidth ${stroke}.
- Components: the system components the designs use, written as the application's own on Base UI.
Then write the application in that stack in app/ (its package.json, the stylesheet with the
@theme, the entry and its routes), install its packages, and ${save}. Then go on below.
`;
};

/** What a designs-only folder holds beside its designs: its configuration and its notes. */
const BESIDE_DESIGNS = new Set([
  ...CONFIG_FILE_NAMES,
  "DESIGN.md",
  "README.md",
]);

/**
 * Whether the project is designs only, as `ultrapaint new --code=none` writes one: its folder
 * holds its designs, its configuration and dotfiles, and nothing else.
 */
export const designsOnly = (fs: FileSystem.FileSystem) =>
  Effect.gen(function* () {
    const { root, settings } = yield* RepoPaths;
    const [designs] = settings.designsDir.split("/");
    const there = yield* fs
      .readDirectory(root)
      .pipe(Effect.orElseSucceed((): readonly string[] => ["?"]));
    return there.every(
      (name) =>
        name.startsWith(".") || name === designs || BESIDE_DESIGNS.has(name)
    );
  });
