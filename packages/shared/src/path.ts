const LEADING_DOT_SLASH_RE = /^\.\//;
const EXTENSION_RE = /\.[^./]+$/;

/** Normalises a path to posix separators and strips a leading `./`. */
export const toPosix = (p: string): string =>
  p.replaceAll("\\", "/").replace(LEADING_DOT_SLASH_RE, "");

export const basename = (p: string): string => {
  const parts = toPosix(p).split("/");
  return parts.at(-1) ?? "";
};

export const dirname = (p: string): string => {
  const parts = toPosix(p).split("/");
  parts.pop();
  return parts.join("/");
};

export const stripExtension = (p: string): string =>
  p.replace(EXTENSION_RE, "");

/** Turns a file name like `welcome-screen.tsx` into `Welcome screen`. */
export const humanise = (name: string): string => {
  const base = stripExtension(basename(name)).replaceAll(/[-_]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
};
