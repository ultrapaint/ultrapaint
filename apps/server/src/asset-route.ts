/**
 * The images a canvas's pages show (ADR 0040): a design names a file inside the canvas
 * (`assets/hero.png`), and a canvas may keep its own `assets/`, whose files take the place of the
 * shared ones of the same name at the root of the designs directory (ADR 0019). The editor draws
 * the frames itself, so it asks here: `GET /api/asset?canvas=&src=`. The project's own images,
 * its icon among them, are at `GET /api/project-image?path=` (ADR 0107).
 */
import path from "node:path";
import { PROJECT_IMAGE_ROUTE } from "@ultrapaint/contracts/project";
import { Effect, FileSystem } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { OpenProject } from "./project.ts";
import { imageType, ProjectImages } from "./services/project-images.ts";
import { RepoPaths } from "./services/repo-paths.ts";

export const ASSET_ROUTE = "/api/asset";

/**
 * What an image of the project or a canvas is answered with. Its file is the repository's to write, and an SVG
 * opened as a document of the server's origin would run its script there: as a document it runs
 * nothing (sandboxed, no script, no request), its type is the one given, and an `<img>` draws it
 * as before.
 */
export const IMAGE_HEADERS = {
  "cache-control": "no-cache",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff",
} as const;

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
        const type = imageType(src);
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
          headers: IMAGE_HEADERS,
        }).pipe(
          // Gone or unreadable between the look and the read: not found, as it now is.
          Effect.orElseSucceed(() => notFound)
        );
      })
    );
  })
);

/**
 * An image of the open project (ADR 0107), its icon or one offered for it: `GET
 * /api/project-image?path=`, by its path from the project's folder; none outside it, nor a file
 * that is not an image.
 */
export const ProjectImageRoute = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const images = (yield* OpenProject).service(ProjectImages);
    yield* router.add(
      "GET",
      PROJECT_IMAGE_ROUTE,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const rel =
          new URL(request.url, "http://localhost").searchParams.get("path") ??
          "";
        const found = yield* images((i) => i.file(rel))
          // No project open: there is no image to find.
          .pipe(Effect.catchTag("NotConfigured", () => Effect.succeed(null)));
        const type = imageType(rel);
        if (!(found && type)) {
          return notFound;
        }
        return HttpServerResponse.uint8Array(found, {
          contentType: type,
          headers: IMAGE_HEADERS,
        });
      })
    );
  })
);
