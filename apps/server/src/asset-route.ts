/**
 * The images a canvas's pages show (ADR 0040): a design names a file inside the canvas
 * (`assets/hero.png`), and a canvas may keep its own `assets/`, whose files take the place of the
 * shared ones of the same name at the root of the designs directory (ADR 0019). The editor draws
 * the frames itself, so it asks here: `GET /api/asset?canvas=&src=`.
 */
import path from "node:path";
import { Effect, FileSystem } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { OpenProject } from "./project.ts";
import { RepoPaths } from "./services/repo-paths.ts";

export const ASSET_ROUTE = "/api/asset";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/**
 * Where the file `src` names for a canvas may be, in order: the canvas's own, then the shared one;
 * a path that leaves the designs directory is none.
 */
const assetCandidates = (
  designsDir: string,
  canvas: string,
  src: string
): string[] =>
  [
    ...(canvas ? [path.resolve(designsDir, canvas, src)] : []),
    path.resolve(designsDir, src),
  ].filter((file) => file.startsWith(`${designsDir}${path.sep}`));

const notFound = HttpServerResponse.text("not found", { status: 404 });

export const AssetRoute = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const project = yield* OpenProject;
    const fs = yield* FileSystem.FileSystem;
    yield* router.add(
      "GET",
      ASSET_ROUTE,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.url, "http://localhost");
        const src = url.searchParams.get("src") ?? "";
        const canvas = url.searchParams.get("canvas") ?? "";
        const type = CONTENT_TYPES[path.extname(src).toLowerCase()];
        if (!(src && type)) {
          return notFound;
        }
        const found = yield* project
          .use(
            Effect.gen(function* () {
              // Absolute already: joined to the root again, it named a directory that is not there.
              const { designsDir } = yield* RepoPaths;
              for (const file of assetCandidates(designsDir, canvas, src)) {
                const info = yield* Effect.option(fs.stat(file));
                if (info._tag === "Some" && info.value.type === "File") {
                  return file;
                }
              }
              return null;
            })
          )
          // No project open: there is no canvas to find an image in.
          .pipe(Effect.catchTag("NotConfigured", () => Effect.succeed(null)));
        if (!found) {
          return notFound;
        }
        return yield* HttpServerResponse.file(found, {
          contentType: type,
          headers: { "cache-control": "no-cache" },
        }).pipe(Effect.orElseSucceed(() => notFound));
      })
    );
  })
);
