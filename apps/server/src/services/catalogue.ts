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
  buildCatalogue,
  catalogueCacheKey,
  catalogueSourceFiles,
  type ExtractContext,
} from "./catalogue-extract.ts";
import { RepoPaths } from "./repo-paths.ts";

const TRAILING_SLASH_RE = /\/$/;

/**
 * Component catalogue for the palette and the props inspector. The extraction itself is the
 * synchronous TypeScript 5 compiler pass in `catalogue-extract.ts`; this service resolves the
 * library directories, caches the result in memory and on disk, and keeps builds from overlapping.
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
          relative: paths.relative,
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
        const catalogue = buildCatalogue(ctx, files);
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
