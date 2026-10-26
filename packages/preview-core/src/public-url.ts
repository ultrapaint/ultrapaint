import type { PublicFiles } from "@ultrapaint/framework-api/browser";

/** A root path's first segment, and the slash after it when there is one. */
const FIRST_SEGMENT_RE = /^\/([^/?#]+)(\/)?/;

/**
 * Where the editor's page finds the application's public file a root path names (ADR 0034): the
 * application serves them from its root, the editor's page from the preview's base. A path is one
 * of them when its first segment is an entry of the public directory (a directory's followed by
 * more): a route of the application cannot be one, the public file would answer it.
 */
export const publicUrlOf = (files: PublicFiles | undefined) => {
  const entries = new Set(files?.entries);
  return (url: string): string => {
    if (
      files === undefined ||
      !url.startsWith("/") ||
      url.startsWith("//") ||
      url.startsWith(files.base)
    ) {
      return url;
    }
    const first: RegExpExecArray | null = FIRST_SEGMENT_RE.exec(url);
    const name = first?.[1];
    if (name === undefined || !entries.has(first?.[2] ? `${name}/` : name)) {
      return url;
    }
    return `${files.base}${url.slice(1)}`;
  };
};
