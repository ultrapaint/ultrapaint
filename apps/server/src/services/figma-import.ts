/**
 * Figma files brought into the project. An upload is kept in the state directory with what
 * the fixed-rule reading found in it — pages, frames, components — and a mapping that grows as
 * an agent decides, component by component, what each becomes here. A frame is written as a
 * page with the mapping as it stands; the conversion itself is `@ultrapaint/figma-import`.
 */

import type { DesignNode, PageDocument } from "@ultrapaint/contracts/document";
import {
  BadRequest,
  type Conflict,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  type ComponentMapping,
  type FigmaComponent,
  type FigmaFrame,
  FigmaImport,
  MAX_FIG_BYTES,
} from "@ultrapaint/contracts/figma";
import type { Page } from "@ultrapaint/contracts/pages";
import { makeIdGenerator } from "@ultrapaint/design-document/ids";
import { DOCUMENT_VERSION } from "@ultrapaint/design-document/tree";
import { candidatesFor } from "@ultrapaint/figma-import/candidates";
import {
  type Conversion,
  convertComponent,
  convertFrame,
} from "@ultrapaint/figma-import/convert";
import {
  descendantsOf,
  type FigFile,
  type FigNode,
  idOf,
  readFig,
} from "@ultrapaint/figma-import/fig";
import { outlineOf } from "@ultrapaint/figma-import/outline";
import { makeTokenMatcher } from "@ultrapaint/figma-import/paint";
import {
  type FigmaTokenSet,
  readFigmaTokens,
} from "@ultrapaint/figma-import/tokens";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Semaphore,
} from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { makeStamp } from "../file-stamp.ts";
import { makeId, safeFileId } from "../ids.ts";
import { CatalogueService } from "./catalogue.ts";
import { DesignSystemService } from "./design-system.ts";
import type { EditFailure } from "./edit.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";
import { Storage } from "./storage.ts";

const IMPORTS_DIR = "imports";
const FILE_NAME = "file.fig";
const SUMMARY_NAME = "import.json";
/** Parsed files kept in memory: a large file takes a while to read. */
const LOADED_LIMIT = 2;

const decodeImport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FigmaImport)
);
const decodePage = Schema.decodeUnknownEffect(
  Schema.Struct({ root: Schema.Unknown, version: Schema.Number })
);

/** A frame converted with the mapping as it stands. */
export interface FramePreview {
  readonly document: DesignNode;
  readonly frame: FigmaFrame;
  /** The frame's layers as text, with its instances named. */
  readonly outline: string;
  /** Component key → instances that were expanded for want of a mapping. */
  readonly unmapped: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

export interface ComponentPreview {
  readonly component: FigmaComponent;
  /** The component's definition, converted. */
  readonly document: DesignNode;
  readonly outline: string;
  /** Names of the frames that use it. */
  readonly usedIn: readonly string[];
}

export interface WrittenFrame {
  readonly page: Page;
  readonly unmapped: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

type ImportFailure = NotFound | BadRequest;

const frameSummary = (
  file: FigFile,
  page: string,
  frame: FigNode
): FigmaFrame => {
  const id = idOf(frame);
  const below = descendantsOf(file, id);
  return {
    height: Math.round(frame.size?.y ?? 0),
    id,
    instances: below.filter((node) => node.type === "INSTANCE").length,
    name: frame.name,
    nodes: below.length,
    page,
    width: Math.round(frame.size?.x ?? 0),
  };
};

/** What the file holds, read once when it arrives; the candidates are added when it is read. */
const summarise = (
  file: FigFile
): Omit<FigmaImport, "createdAt" | "id" | "mapping" | "name"> => {
  const warnings: string[] = [];
  const pages = file.pages.map((page) => ({
    frames: page.frames.map((frame) => frameSummary(file, page.name, frame)),
    name: page.name,
  }));
  const missing = [...file.pages]
    .flatMap((page) => page.frames)
    .flatMap((frame) => descendantsOf(file, idOf(frame)))
    .filter(
      (node) => node.type === "INSTANCE" && file.componentOf(node) === null
    ).length;
  if (missing > 0) {
    warnings.push(
      `${missing} instance${missing === 1 ? "" : "s"} of components that are not in the file (a library the file uses); they convert to empty groups`
    );
  }
  if (pages.every((page) => page.frames.length === 0)) {
    warnings.push("the file has no frames on its pages");
  }
  return {
    components: file.components.map((component) => ({
      candidates: [],
      ...(component.description !== undefined && {
        description: component.description,
      }),
      key: component.key,
      name: component.name,
      page: component.page,
      props: [
        ...Object.keys(component.variants).map((name) => ({
          name,
          type: "variant" as const,
        })),
        ...component.props.map((prop) => ({
          name: prop.name,
          type: prop.type,
        })),
      ],
      uses: component.uses,
      variants: component.variants,
    })),
    pages,
    warnings,
  };
};

export class FigmaImportService extends Context.Service<
  FigmaImportService,
  {
    /** One component's definition, as the mapping would keep it when it is not replaced. */
    readonly component: (
      id: string,
      key: string
    ) => Effect.Effect<ComponentPreview, ImportFailure>;
    /** Reads the file, keeps it, and answers with what it holds. */
    readonly create: (
      name: string,
      bytes: Uint8Array
    ) => Effect.Effect<FigmaImport, BadRequest>;
    /** A frame converted with the mapping as it stands, found by its id or its name. */
    readonly frame: (
      id: string,
      frame: string
    ) => Effect.Effect<FramePreview, ImportFailure>;
    readonly get: (id: string) => Effect.Effect<FigmaImport, ImportFailure>;
    /** The file's variables and styles as tokens named the way the code names them (ADR 0025). */
    readonly tokens: (
      id: string
    ) => Effect.Effect<FigmaTokenSet, ImportFailure>;
    /** The most recent import, or null when there is none. */
    readonly latest: Effect.Effect<FigmaImport | null>;
    readonly list: Effect.Effect<readonly FigmaImport[]>;
    /** Says what a component becomes; null forgets the decision. */
    readonly map: (
      id: string,
      key: string,
      mapping: ComponentMapping | null
    ) => Effect.Effect<FigmaImport, ImportFailure>;
    /**
     * Writes a frame as a page of the canvas, named after the frame and serving `route` when one
     * is given, with its images in the shared assets.
     */
    readonly writeFrame: (
      id: string,
      frame: string,
      canvas: string,
      route?: string
    ) => Effect.Effect<WrittenFrame, ImportFailure | EditFailure | Conflict>;
  }
>()("ultrapaint/server/FigmaImportService") {
  static readonly layer = Layer.effect(
    FigmaImportService,
    Effect.gen(function* () {
      const storage = yield* Storage;
      const paths = yield* RepoPaths;
      const catalogue = yield* CatalogueService;
      const designSystem = yield* DesignSystemService;
      const pages = yield* PagesService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const loaded = new Map<string, FigFile>();
      // The summary file is read, changed and written back: one at a time.
      const writing = yield* Semaphore.make(1);

      // Removed recursively by `delete`: an id that named anything else would take that with it.
      const dirOf = (id: string) =>
        Effect.flatMap(safeFileId("Figma import", id), (safe) =>
          Effect.map(storage.stateDir, (state) =>
            path.join(state, IMPORTS_DIR, safe)
          )
        );

      const readSummary = Effect.fnUntraced(function* (id: string) {
        const dir = yield* dirOf(id);
        const text = yield* Effect.option(
          fs.readFileString(path.join(dir, SUMMARY_NAME))
        );
        if (text._tag === "None") {
          return yield* new NotFound({
            message: `no Figma import ${id}; list_figma_imports has the ones there are`,
          });
        }
        // A summary that does not read is that import's problem alone: the list leaves it out,
        // and the other imports are still there.
        return yield* decodeImport(text.value).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the summary of Figma import ${id} cannot be read: ${error.message}`,
              })
          )
        );
      });

      /** A disk that will not take a write, said as the request's failure. */
      const notSaved =
        (what: string) => (error: { readonly message: string }) =>
          new BadRequest({
            message: `${what} could not be saved: ${error.message}`,
          });

      const writeSummary = Effect.fnUntraced(function* (summary: FigmaImport) {
        // Its id was made here or read back with it: one that is not an id is a bug.
        const dir = yield* Effect.orDie(dirOf(summary.id));
        yield* Effect.andThen(
          fs.makeDirectory(dir, { recursive: true }),
          writeAtomic(
            path.join(dir, SUMMARY_NAME),
            `${JSON.stringify(summary, null, 2)}\n`
          )
        ).pipe(Effect.mapError(notSaved(`${summary.name}'s import`)));
      });

      /** The catalogue's guesses for each component, from the names; nothing when it is not built. */
      const withCandidates = Effect.fnUntraced(function* (
        summary: FigmaImport
      ) {
        const components = yield* Effect.orElseSucceed(
          Effect.map(catalogue.get(false), (c) => c.components),
          () => []
        );
        return {
          ...summary,
          components: summary.components.map((entry) => ({
            ...entry,
            candidates: candidatesFor(entry.name, components),
          })),
        } satisfies FigmaImport;
      });

      const get = Effect.fn("FigmaImportService.get")(function* (id: string) {
        return yield* withCandidates(yield* readSummary(id));
      });

      const stampOf = makeStamp(fs);
      /** Summaries as last read, with the stamp their file had then: a list reads only what changed. */
      const summaries = new Map<
        string,
        { readonly stamp: string; readonly summary: FigmaImport }
      >();

      /** Every import's summary, newest first, without the catalogue's guesses. */
      const listSummaries = Effect.gen(function* () {
        const root = path.join(yield* storage.stateDir, IMPORTS_DIR);
        const ids = yield* Effect.orElseSucceed(
          fs.readDirectory(root),
          (): string[] => []
        );
        for (const id of summaries.keys()) {
          if (!ids.includes(id)) {
            summaries.delete(id);
          }
        }
        const found = yield* Effect.forEach(ids, (id) =>
          Effect.gen(function* () {
            // Stamped before it is read, so a change during the reading is seen next time.
            const stamp = yield* stampOf([path.join(root, id, SUMMARY_NAME)]);
            const kept = summaries.get(id);
            if (kept?.stamp === stamp) {
              return [kept.summary];
            }
            const read = yield* Effect.option(readSummary(id));
            if (read._tag === "None") {
              summaries.delete(id);
              return [];
            }
            summaries.set(id, { stamp, summary: read.value });
            return [read.value];
          })
        );
        return found.flat().sort((a, b) => b.createdAt - a.createdAt);
      });

      const list = Effect.flatMap(listSummaries, (all) =>
        Effect.forEach(all, withCandidates)
      ).pipe(Effect.withSpan("FigmaImportService.list"));

      const latest = Effect.flatMap(listSummaries, ([newest]) =>
        newest === undefined ? Effect.succeed(null) : withCandidates(newest)
      ).pipe(Effect.withSpan("FigmaImportService.latest"));

      const load = Effect.fnUntraced(function* (id: string) {
        const cached = loaded.get(id);
        if (cached) {
          return cached;
        }
        const dir = yield* dirOf(id);
        const bytes = yield* fs
          .readFile(path.join(dir, FILE_NAME))
          .pipe(
            Effect.mapError(
              () =>
                new NotFound({ message: `the file of import ${id} is gone` })
            )
          );
        const file = yield* Effect.try({
          catch: (error) =>
            new BadRequest({
              message: `the file of import ${id} cannot be read: ${String(error)}`,
            }),
          try: () => readFig(bytes),
        });
        if (loaded.size >= LOADED_LIMIT) {
          const oldest = loaded.keys().next().value;
          if (oldest !== undefined) {
            loaded.delete(oldest);
          }
        }
        loaded.set(id, file);
        return file;
      });

      const create = Effect.fn("FigmaImportService.create")(function* (
        name: string,
        bytes: Uint8Array
      ) {
        if (bytes.byteLength > MAX_FIG_BYTES) {
          return yield* new BadRequest({
            message: `${name} is larger than ${MAX_FIG_BYTES / 1024 / 1024} MB`,
          });
        }
        const file = yield* Effect.try({
          catch: (error) =>
            new BadRequest({
              message: `${name} is not a Figma file the import can read: ${error instanceof Error ? error.message : String(error)}`,
            }),
          try: () => readFig(bytes),
        });
        const id = yield* makeId("fig");
        const summary: FigmaImport = {
          ...summarise(file),
          createdAt: yield* Clock.currentTimeMillis,
          id,
          mapping: {},
          name,
        };
        const dir = yield* Effect.orDie(dirOf(id));
        yield* Effect.andThen(
          fs.makeDirectory(dir, { recursive: true }),
          fs.writeFile(path.join(dir, FILE_NAME), bytes)
        ).pipe(Effect.mapError(notSaved(name)));
        yield* writeSummary(summary);
        loaded.set(id, file);
        return yield* withCandidates(summary);
      });

      const map = Effect.fn("FigmaImportService.map")(function* (
        id: string,
        key: string,
        mapping: ComponentMapping | null
      ) {
        return yield* writing.withPermits(1)(
          Effect.gen(function* () {
            const summary = yield* readSummary(id);
            if (!summary.components.some((c) => c.key === key)) {
              const known = summary.components.map((c) => c.key).join(", ");
              return yield* new NotFound({
                message: `no Figma component ${JSON.stringify(key)} in this file; the components are ${known || "none"}`,
              });
            }
            const { [key]: _old, ...rest } = summary.mapping;
            const next = {
              ...summary,
              mapping: mapping === null ? rest : { ...rest, [key]: mapping },
            };
            yield* writeSummary(next);
            return yield* withCandidates(next);
          })
        );
      });

      const frameOf = Effect.fnUntraced(function* (
        summary: FigmaImport,
        file: FigFile,
        ref: string
      ) {
        const wanted = ref.trim().toLowerCase();
        for (const page of file.pages) {
          for (const frame of page.frames) {
            const id = idOf(frame);
            if (id === ref || frame.name.trim().toLowerCase() === wanted) {
              return {
                node: frame,
                summary: frameSummary(file, page.name, frame),
              };
            }
          }
        }
        const names = summary.pages
          .flatMap((page) => page.frames.map((f) => `${f.name} (${f.id})`))
          .join(", ");
        return yield* new NotFound({
          message: `no frame ${JSON.stringify(ref)} in the file; the frames are ${names || "none"}`,
        });
      });

      const conversionOptions = Effect.fnUntraced(function* (
        summary: FigmaImport
      ) {
        const { designSystem: saved } = yield* designSystem.get;
        // Before a design system is written, the code's own tokens are what colours match
        // (ADR 0025): Figma's may have been taken into it already.
        const ds = saved ?? (yield* designSystem.scan).designSystem;
        return {
          mapping: summary.mapping,
          next: makeIdGenerator(["root"]),
          tokens: makeTokenMatcher(ds),
        };
      });

      const frame = Effect.fn("FigmaImportService.frame")(function* (
        id: string,
        ref: string
      ) {
        const summary = yield* readSummary(id);
        const file = yield* load(id);
        const found = yield* frameOf(summary, file, ref);
        const conversion = convertFrame(
          file,
          found.node,
          yield* conversionOptions(summary)
        );
        return {
          document: conversion.root,
          frame: found.summary,
          outline: outlineOf(
            file,
            found.node,
            new Set(Object.keys(summary.mapping))
          ),
          unmapped: conversion.unmapped,
          warnings: conversion.warnings,
        } satisfies FramePreview;
      });

      const component = Effect.fn("FigmaImportService.component")(function* (
        id: string,
        key: string
      ) {
        const summary = yield* withCandidates(yield* readSummary(id));
        const file = yield* load(id);
        const found = file.components.find((c) => c.key === key);
        const described = summary.components.find((c) => c.key === key);
        if (!(found && described)) {
          const known = summary.components.map((c) => c.key).join(", ");
          return yield* new NotFound({
            message: `no Figma component ${JSON.stringify(key)} in this file; the components are ${known || "none"}`,
          });
        }
        const conversion = convertComponent(
          file,
          found,
          yield* conversionOptions(summary)
        );
        const [symbol] = found.symbols;
        const usedIn = file.pages.flatMap((page) =>
          page.frames
            .filter((f) =>
              descendantsOf(file, idOf(f)).some(
                (node) =>
                  node.type === "INSTANCE" &&
                  file.componentOf(node)?.key === key
              )
            )
            .map((f) => f.name)
        );
        return {
          component: described,
          document: conversion.root,
          outline: symbol ? outlineOf(file, symbol) : "",
          usedIn,
        } satisfies ComponentPreview;
      });

      /**
       * The pictures a page shows, written once each into the shared assets; a file already
       * there is the same picture, since its name is its content's.
       */
      const writeImages = Effect.fnUntraced(function* (conversion: Conversion) {
        for (const image of conversion.images) {
          const abs = yield* paths.resolve(
            path.join(paths.designsDir, image.src)
          );
          if (yield* Effect.orElseSucceed(fs.exists(abs), () => false)) {
            continue;
          }
          yield* Effect.andThen(
            fs.makeDirectory(path.dirname(abs), { recursive: true }),
            fs.writeFile(abs, image.bytes)
          ).pipe(Effect.mapError(notSaved(image.src)));
        }
      });

      const writeFrame = Effect.fn("FigmaImportService.writeFrame")(function* (
        id: string,
        ref: string,
        canvas: string,
        route?: string
      ) {
        const summary = yield* readSummary(id);
        const file = yield* load(id);
        const found = yield* frameOf(summary, file, ref);
        const conversion = convertFrame(
          file,
          found.node,
          yield* conversionOptions(summary)
        );
        const document: PageDocument = yield* decodePage({
          root: conversion.root,
          version: DOCUMENT_VERSION,
        }).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the frame did not convert to a valid page: ${error.message}`,
              })
          ),
          Effect.map((decoded) => decoded as unknown as PageDocument)
        );
        yield* writeImages(conversion);
        const page = yield* pages.createWith(
          canvas,
          { name: found.node.name, route },
          document,
          {
            height: found.summary.height,
            width: found.summary.width,
          }
        );
        return {
          page,
          unmapped: conversion.unmapped,
          warnings: conversion.warnings,
        } satisfies WrittenFrame;
      });

      const tokens = Effect.fn("FigmaImportService.tokens")(function* (
        id: string
      ) {
        const file = yield* load(id);
        return readFigmaTokens(file);
      });

      return FigmaImportService.of({
        component,
        create,
        frame,
        get,
        latest,
        list,
        map,
        tokens,
        writeFrame,
      });
    })
  );
}
