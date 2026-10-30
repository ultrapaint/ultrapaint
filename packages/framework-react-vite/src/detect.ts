/**
 * Recognises a React repository for the first-run setup: which packages are component
 * libraries, or which directory of the application holds its components, and which package the
 * pages could resolve their imports from. It reads manifests and file names only; everything it
 * returns is a suggestion the user confirms. The stylesheets are the style system's to find
 * (ADR 0024).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  LibrarySuggestion,
  SetupSuggestions,
} from "@ultrapaint/contracts/setup";
import { toPosix } from "@ultrapaint/shared/path";

const MAX_DEPTH = 5;
const MAX_SUGGESTIONS = 5;
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
]);
const COMPONENT_FILE_RE = /^(?!.*\.(stories|test|spec)\.)[^_].*\.tsx$/;
const LIBRARY_NAME_RE =
  /(^|[-/@])(ui|components?|design-system|ds|kit)([-/]|$)/i;
const APP_NAME_RE =
  /(^|[-/@])(app|web|site|client|front|frontend|storybook)([-/]|$)/i;
const DESIGNS_NAME_RE = /(^|[-/])designs?$/i;

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  peerDependencies?: Record<string, string>;
}

interface Package {
  readonly dependencies: ReadonlySet<string>;
  /** Absolute. */
  readonly dir: string;
  readonly name: string;
  readonly peers: ReadonlySet<string>;
  /** Repo-relative, posix; empty for the root package. */
  readonly rel: string;
}

const readManifest = (dir: string): Manifest | null => {
  try {
    return JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8")
    ) as Manifest;
  } catch {
    return null;
  }
};

const subdirectories = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          !SKIPPED_DIRS.has(e.name)
      )
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
};

/** Every package of the repository, whatever the package manager calls a workspace. */
const findPackages = (root: string): Package[] => {
  const packages: Package[] = [];
  const visit = (dir: string, depth: number) => {
    const manifest = readManifest(dir);
    if (manifest) {
      packages.push({
        dependencies: new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
        ]),
        dir,
        name: manifest.name ?? path.basename(dir),
        peers: new Set(Object.keys(manifest.peerDependencies ?? {})),
        rel: toPosix(path.relative(root, dir)),
      });
    }
    if (depth < MAX_DEPTH) {
      for (const child of subdirectories(dir)) {
        visit(child, depth + 1);
      }
    }
  };
  visit(root, 0);
  return packages;
};

/** Component files below a directory, counted up to what is enough to tell a library. */
const countComponents = (dir: string, depth = 0): number => {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && COMPONENT_FILE_RE.test(entry.name)) {
        count += 1;
      } else if (
        entry.isDirectory() &&
        depth < 3 &&
        !SKIPPED_DIRS.has(entry.name) &&
        !entry.name.startsWith(".")
      ) {
        count += countComponents(path.join(dir, entry.name), depth + 1);
      }
    }
  } catch {
    return count;
  }
  return count;
};

const sourceDirOf = (pkg: Package): string => {
  const candidates = ["src/components", "src", "components", "lib"];
  const found = candidates.find((c) => existsSync(path.join(pkg.dir, c)));
  return found ? path.join(pkg.dir, found) : pkg.dir;
};

/**
 * Where an application keeps its own components when they are not a package: the first of
 * these that holds component files.
 */
const IN_APP_COMPONENT_DIRS = [
  "src/components",
  "components",
  "src/ui",
  "app/components",
  "src/lib/components",
];

const inAppComponentsOf = (pkg: Package): string | null => {
  const found = IN_APP_COMPONENT_DIRS.find(
    (dir) => countComponents(path.join(pkg.dir, dir)) > 0
  );
  return found === undefined ? null : path.join(pkg.dir, found);
};

const usesReact = (pkg: Package) =>
  pkg.dependencies.has("react") || pkg.peers.has("react");

interface Scored<T> {
  readonly score: number;
  readonly value: T;
}

const best = <T>(items: Scored<T>[]): T[] =>
  items
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS)
    .map((i) => i.value);

/** What the setup proposes of a repository's application, the stylesheets aside. */
export type Detected = Pick<
  SetupSuggestions,
  "anchors" | "designsDirs" | "libraries" | "rootManifest"
>;

/**
 * What is recognised of a repository's React application; null when it has none. Synchronous and
 * read-only: it looks at manifests and file names, never runs anything.
 */
export const detect = (root: string): Detected | null => {
  const packages = findPackages(root);
  const reactPackages = packages.filter(usesReact);
  if (reactPackages.length === 0) {
    return null;
  }
  const dependents = (name: string) =>
    packages.filter((p) => p.dependencies.has(name)).length;

  // A component library: React is a peer (it is rendered by someone else's React), it holds
  // components, and other packages of the repository depend on it.
  const libraries: LibrarySuggestion[] = best(
    reactPackages
      .filter((pkg) => pkg.rel !== "" && !DESIGNS_NAME_RE.test(pkg.rel))
      .map((pkg) => {
        const sourceDir = sourceDirOf(pkg);
        const components = countComponents(sourceDir);
        const used = dependents(pkg.name);
        const score =
          components === 0 || (used === 0 && !pkg.peers.has("react"))
            ? 0
            : (pkg.peers.has("react") ? 3 : 0) +
              (LIBRARY_NAME_RE.test(pkg.name) ? 2 : 0) +
              Math.min(used, 3) +
              Math.min(Math.floor(components / 10), 3);
        return {
          score,
          value: {
            dir: pkg.rel,
            name: pkg.name,
            sourceDir: toPosix(path.relative(root, sourceDir)),
          },
        };
      })
  );
  const libraryNames = new Set(libraries.map((l) => l.name));

  // An anchor: a package that renders with React and already depends on the libraries, so a
  // page can import from it everything the real UI imports.
  const anchors = best(
    reactPackages
      .filter((pkg) => pkg.dependencies.has("react"))
      .map((pkg) => {
        const usedLibraries = [...pkg.dependencies].filter((d) =>
          libraryNames.has(d)
        );
        const reasons = [
          usedLibraries.length > 0
            ? `depends on ${usedLibraries.join(", ")}`
            : "depends on react",
          ...(pkg.dependencies.has("vite") ? ["has Vite"] : []),
        ];
        const score =
          // Rendering with React is enough to resolve pages from; the rest says how well.
          1 +
          (pkg.dependencies.has("react-dom") ? 1 : 0) +
          usedLibraries.length * 3 +
          // A designs package that is already there was made for exactly this.
          (DESIGNS_NAME_RE.test(pkg.rel) ? 20 : 0) +
          (pkg.dependencies.has("vite") ? 2 : 0) +
          (pkg.dependencies.has("@tailwindcss/vite") ||
          pkg.dependencies.has("tailwindcss")
            ? 1
            : 0) +
          (APP_NAME_RE.test(pkg.name) ? 1 : 0) -
          (libraryNames.has(pkg.name) ? 2 : 0);
        return {
          score,
          value: {
            dir: pkg.rel === "" ? "." : pkg.rel,
            name: pkg.name,
            reason: reasons.join(", "),
          },
        };
      })
  );

  const anchorPackages = anchors
    .map((a) => packages.find((p) => (p.rel === "" ? "." : p.rel) === a.dir))
    .filter((p): p is Package => p !== undefined);

  // No package of the repository is a library: the components are the application's own,
  // in a directory of it (a single app in `front/` with `front/src/components`).
  if (libraries.length === 0) {
    for (const pkg of anchorPackages) {
      const sourceDir = inAppComponentsOf(pkg);
      if (sourceDir) {
        libraries.push({
          dir: pkg.rel === "" ? "." : pkg.rel,
          inApp: true,
          name: pkg.name,
          sourceDir: toPosix(path.relative(root, sourceDir)),
        });
        break;
      }
    }
  }

  const designsDirs = packages
    .map((p) => p.rel)
    .filter((rel) => DESIGNS_NAME_RE.test(rel));
  for (const candidate of ["designs", "docs/designs"]) {
    if (
      existsSync(path.join(root, candidate)) &&
      !designsDirs.includes(candidate)
    ) {
      designsDirs.push(candidate);
    }
  }

  return { anchors, designsDirs, libraries };
};
