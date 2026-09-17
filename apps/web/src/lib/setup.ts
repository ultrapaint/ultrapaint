import type { Settings } from "@ultrapaint/contracts/settings";
import type { SetupSuggestions } from "@ultrapaint/contracts/setup";

/** Where new screens go when the repository has no designs directory yet. */
export const DEFAULT_DESIGNS_DIR = "docs/designs";

/** Directory the preview is generated into; host CSS imports are written relative to it. */
const GENERATED_DIR = ".ultrapaint";

/** Relative posix path from a directory to a file, both relative to the same root. */
export const relativePosix = (fromDir: string, toFile: string): string => {
  const from = fromDir.split("/").filter((s) => s && s !== ".");
  const to = toFile.split("/").filter((s) => s && s !== ".");
  let shared = 0;
  while (
    shared < from.length &&
    shared < to.length - 1 &&
    from[shared] === to[shared]
  ) {
    shared += 1;
  }
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
};

/**
 * The settings the first-run setup proposes for a repository: an existing designs directory or
 * the default one, the best anchor, the first component library and its stylesheet. Every
 * value stays editable in the form.
 */
export const applySuggestions = (
  settings: Settings,
  found: SetupSuggestions
): Settings => {
  const designsDir = found.designsDirs[0] ?? DEFAULT_DESIGNS_DIR;
  const [anchor] = found.anchors;
  const [library] = found.libraries;
  // A stylesheet of the designs directory itself wins: it was written for the screens.
  const css =
    found.cssEntries.find((file) => file.startsWith(`${designsDir}/`)) ??
    found.cssEntries[0];
  return {
    ...settings,
    componentPackages: library ? [library.name] : [],
    designsDir,
    framework: found.framework,
    hostCss: css ? [relativePosix(`${designsDir}/${GENERATED_DIR}`, css)] : [],
    libraryDirs: library ? [library.sourceDir] : [],
    // A designs directory that is a package resolves its own imports.
    resolveFrom: anchor && anchor.dir !== designsDir ? anchor.dir : undefined,
  };
};

/** What the form shows about a detection, in one sentence. */
export const describeSuggestions = (found: SetupSuggestions): string => {
  const [anchor] = found.anchors;
  const [library] = found.libraries;
  if (!(anchor || library)) {
    return `Nothing in ${found.repoName} looks like a React package. Fill the fields in by hand.`;
  }
  const parts = [
    library ? `component library ${library.name}` : null,
    anchor ? `imports resolved from ${anchor.name} (${anchor.reason})` : null,
    found.designsDirs[0]
      ? `screens in ${found.designsDirs[0]}`
      : `no designs directory yet, proposing ${DEFAULT_DESIGNS_DIR}`,
  ].filter(Boolean);
  return `Found in ${found.repoName}: ${parts.join("; ")}.`;
};
