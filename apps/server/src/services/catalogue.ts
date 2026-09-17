import { Worker } from "node:worker_threads";
import type { Catalogue } from "@ultrapaint/contracts/catalogue";
import type { ForbiddenPath } from "@ultrapaint/contracts/errors";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Semaphore,
} from "effect";
import { AppLog } from "../app-log.ts";
import { makeWriteAtomic } from "../atomic-write.ts";
import { ServerConfig } from "../config.ts";
import {
  catalogueCacheKey,
  catalogueSourceFiles,
  type ExtractContext,
} from "./catalogue-extract.ts";
import { RepoPaths } from "./repo-paths.ts";

const TRAILING_SLASH_RE = /\/$/;

// Source checkouts run the TypeScript file directly; the esbuild bundle ships the worker as a
// second entry next to `bin.mjs`.
const WORKER_URL = new URL(
  import.meta.url.endsWith(".ts")
    ? "./catalogue-worker.ts"
    : "./catalogue-worker.mjs",
  import.meta.url
);

/**
 * Runs the compiler pass on a worker thread; interrupting the effect terminates the worker. A
 * build that fails is a defect: an unexpected error in this request, not a wire error.
 */
const buildInWorker = (ctx: ExtractContext, files: string[]) =>
  Effect.callback<Catalogue>((resume) => {
    const worker = new Worker(WORKER_URL, { workerData: { ctx, files } });
    worker.once("message", (catalogue: Catalogue) =>
      resume(Effect.succeed(catalogue))
    );
    worker.once("error", (error) => resume(Effect.die(error)));
    worker.once("exit", (code) => {
      if (code !== 0) {
        resume(Effect.die(new Error(`catalogue worker exited with ${code}`)));
      }
    });
    return Effect.promise(() => worker.terminate());
  });

/**
 * Component catalogue for the palette and the props inspector. The extraction is the synchronous
 * TypeScript 5 compiler pass in `catalogue-extract.ts`, run on a worker thread; this service
 * resolves the library directories, caches the result in memory and on disk, and keeps builds
 * from overlapping.
 */
export class CatalogueService extends Context.Service<
  CatalogueService,
  {
    readonly get: (refresh: boolean) => Effect.Effect<Catalogue, ForbiddenPath>;
    readonly storyUrl: (storyId: string) => string | null;
  }
>()("ultrapaint/server/CatalogueService") {
  static readonly layer = Layer.effect(
    CatalogueService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const { home } = yield* ServerConfig;
      const log = yield* AppLog;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const building = yield* Semaphore.make(1);
      let cached: Catalogue | null = null;

      const load = Effect.fnUntraced(function* (refresh: boolean) {
        if (!refresh && cached) {
          return cached;
        }
        const ctx: ExtractContext = {
          componentPackages: paths.settings.componentPackages,
          libraryDirs: yield* Effect.forEach(
            paths.settings.libraryDirs,
            paths.resolve
          ),
          root: paths.root,
        };
        const files = catalogueSourceFiles(ctx);
        const cacheFile = path.join(
          home,
          "catalogue",
          `${catalogueCacheKey(ctx, files)}.json`
        );
        if (!refresh) {
          // A missing or unreadable cache file only means the catalogue is rebuilt.
          const stored = yield* fs.readFileString(cacheFile).pipe(
            Effect.map((text) => JSON.parse(text) as Catalogue),
            Effect.option
          );
          if (stored._tag === "Some") {
            cached = stored.value;
            return cached;
          }
        }
        const started = yield* Clock.currentTimeMillis;
        const catalogue = yield* buildInWorker(ctx, files);
        cached = catalogue;
        yield* Effect.ignore(
          writeAtomic(cacheFile, JSON.stringify(catalogue)),
          { log: true }
        );
        const elapsed = (yield* Clock.currentTimeMillis) - started;
        yield* log.log(
          "server",
          "info",
          `catalogue built: ${catalogue.components.length} components (${catalogue.coverage.usable} with metadata) in ${elapsed} ms`
        );
        return catalogue;
      });

      return CatalogueService.of({
        get: (refresh) =>
          building
            .withPermits(1)(load(refresh))
            .pipe(Effect.withSpan("CatalogueService.get")),
        storyUrl: (storyId) => {
          const base = paths.settings.storybookUrl;
          return base
            ? `${base.replace(TRAILING_SLASH_RE, "")}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`
            : null;
        },
      });
    })
  );
}
