/**
 * The built editor, served when `--web-dist` is given; in development Vite serves it. Its
 * `assets/` are named by their contents, so a browser keeps each for good and never asks for it
 * again: a second start, over SSH above all, loads the editor from its cache. The pages
 * (`index.html`, `welcome.html`) name the assets of their build, so they are asked for each time,
 * and a new build is taken at once.
 */
import { Layer } from "effect";
import { HttpStaticServer } from "effect/http";

/** What a file named by its contents may be kept for: a year, never asked for again. */
const FOREVER = "public, max-age=31536000, immutable";

export const editorBuild = (webDist: string) =>
  Layer.mergeAll(
    HttpStaticServer.layer({
      cacheControl: FOREVER,
      prefix: "/assets",
      root: `${webDist}/assets`,
    }),
    HttpStaticServer.layer({
      cacheControl: "no-cache",
      root: webDist,
      spa: true,
    })
  );
