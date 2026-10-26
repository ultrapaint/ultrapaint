/**
 * The application's public files, as its code names them from the root (`"/media/a.webp"`),
 * found under the preview's base (ADR 0034). The preview's modules run in the editor's page, where
 * the root is the editor's: Vite adjusts the URLs of imported assets and of stylesheets to the
 * base, not a string in the code, which an application served from its root has no reason to
 * write any other way.
 *
 * A string is moved under the base when it names a file of the public directory, or, cut short by
 * a template literal's `${`, when what comes before is inside one of its directories: a route
 * of the application (`"/media"`, `"/news/:slug"`) is left as it is.
 */

/**
 * The module the editor's entry reads the public directory's entries from (`publicFiles`), for
 * the paths the pages give components (`"image": "/media/a.webp"`), which no code names.
 */
export const PUBLIC_FILES_ID = "virtual:ultrapaint/public-files";

/** A string or template literal opening on a root path, up to its end or its first `${`. */
const ROOT_LITERAL_RE = /(["'`])(\/[^"'`\s\\$]*)(\$\{|\1)/g;

/** A URL's query and fragment. */
const QUERY_RE = /[?#].*$/;

export interface PublicDir {
  readonly isDirectory: (relative: string) => boolean;
  readonly isFile: (relative: string) => boolean;
}

const decoded = (url: string) => {
  try {
    return decodeURI(url);
  } catch {
    // Not a URL: a string that only starts like one.
    return null;
  }
};

const named = (url: string, files: PublicDir, open: boolean) => {
  const path = decoded(url.replace(QUERY_RE, ""));
  if (path === null || url.startsWith("//")) {
    return false;
  }
  const relative = path.slice(1);
  if (!open) {
    return relative !== "" && files.isFile(relative);
  }
  const dir = relative.slice(0, relative.lastIndexOf("/") + 1);
  return dir !== "" && files.isDirectory(dir);
};

/** `code` with its root paths to public files under `base` (`/preview/`); null when none is. */
export const prefixPublicUrls = (
  code: string,
  base: string,
  files: PublicDir
): string | null => {
  let changed = false;
  const next = code.replace(
    ROOT_LITERAL_RE,
    (whole, quote: string, url: string, end: string) => {
      if (
        url.startsWith(base) ||
        !named(url, files, end === "${" && quote === "`")
      ) {
        return whole;
      }
      changed = true;
      return `${quote}${base}${url.slice(1)}${end}`;
    }
  );
  return changed ? next : null;
};
