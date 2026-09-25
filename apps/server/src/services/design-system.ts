import {
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
  DesignSystem,
  type DesignSystemState,
} from "@ultrapaint/contracts/design-system";
import { BadRequest } from "@ultrapaint/contracts/errors";
import { serialise } from "@ultrapaint/design-document/factories";
import type { DesignSystemScan } from "@ultrapaint/framework-api/node";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Stream,
} from "effect";
import { EventBus } from "../events.ts";
import { CatalogueService } from "./catalogue.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { ProjectFramework } from "./framework.ts";
import { RepoPaths } from "./repo-paths.ts";

const decodeDesignSystem = Schema.decodeUnknownEffect(DesignSystem);

/**
 * The design system as the project records it: `design-system.json` and `DESIGN.md` at the root
 * of the designs directory. `/init` has an agent write them through `write`, which validates;
 * `detect` writes what the fixed-rule scan finds, for a project without an agent. Both are one
 * undo step, and the editor hears about every change, whoever made it.
 */
export class DesignSystemService extends Context.Service<
  DesignSystemService,
  {
    readonly detect: Effect.Effect<DesignSystem, EditFailure>;
    readonly get: Effect.Effect<DesignSystemState>;
    /** What the stylesheets say, with the catalogue's categories for the components. */
    readonly scan: Effect.Effect<DesignSystemScan>;
    /** Validates and saves; `notes` replaces `DESIGN.md` when given. */
    readonly write: (
      designSystem: unknown,
      notes?: string
    ) => Effect.Effect<DesignSystem, EditFailure>;
  }
>()("ultrapaint/server/DesignSystemService") {
  static readonly layer = Layer.effect(
    DesignSystemService,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const edit = yield* EditService;
      const framework = yield* ProjectFramework;
      const catalogue = yield* CatalogueService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const systemFile = path.join(paths.designsDir, DESIGN_SYSTEM_FILE);
      const notesFile = path.join(paths.designsDir, DESIGN_NOTES_FILE);

      const readOptional = (file: string) =>
        Effect.orElseSucceed(
          Effect.map(fs.readFileString(file), (text): string | null => text),
          () => null
        );

      const get: Effect.Effect<DesignSystemState> = Effect.gen(function* () {
        const [text, notes] = yield* Effect.all([
          readOptional(systemFile),
          readOptional(notesFile),
        ]);
        if (text === null) {
          return { designSystem: null, notes };
        }
        const decoded = yield* Effect.result(
          Effect.flatMap(
            Effect.try({
              catch: (error) =>
                new BadRequest({ message: `not JSON: ${String(error)}` }),
              try: () => JSON.parse(text) as unknown,
            }),
            decodeDesignSystem
          )
        );
        return decoded._tag === "Success"
          ? { designSystem: decoded.success, notes }
          : {
              designSystem: null,
              notes,
              problem: `${DESIGN_SYSTEM_FILE} is not valid: ${decoded.failure.message}`,
            };
      }).pipe(Effect.withSpan("DesignSystemService.get"));

      const scan = Effect.gen(function* () {
        const found = yield* Effect.sync(() =>
          framework.designSystem.scan({
            anchorDir: paths.anchorDir,
            root: paths.root,
            settings: paths.settings,
          })
        );
        // Categories are what the catalogue already knows; a catalogue not built yet only
        // leaves them to the agent.
        const components = yield* Effect.orElseSucceed(
          Effect.map(catalogue.get(false), (c) => c.components),
          () => []
        );
        if (components.length === 0) {
          return found;
        }
        return {
          ...found,
          designSystem: {
            ...found.designSystem,
            components: Object.fromEntries(
              components.map((c) => [
                c.name,
                {
                  category: c.category,
                  ...(c.description !== undefined && {
                    description: c.description,
                  }),
                },
              ])
            ),
          },
        } satisfies DesignSystemScan;
      }).pipe(Effect.withSpan("DesignSystemService.scan"));

      const write = Effect.fn("DesignSystemService.write")(function* (
        input: unknown,
        notes?: string
      ) {
        const designSystem = yield* decodeDesignSystem(input).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `the design system is not valid: ${error.message}`,
              })
          )
        );
        yield* edit.transaction("Update the design system", (tx) =>
          Effect.gen(function* () {
            yield* tx.write(
              paths.relative(systemFile),
              serialise(designSystem)
            );
            if (notes !== undefined) {
              yield* tx.write(
                paths.relative(notesFile),
                notes.endsWith("\n") ? notes : `${notes}\n`
              );
            }
          })
        );
        yield* Effect.flatMap(get, (state) =>
          events.publish("designSystem", state)
        );
        return designSystem;
      });

      const detect = Effect.flatMap(scan, (found) => write(found.designSystem));

      // Whoever changes the files — an undo, an agent writing them by hand, a checkout.
      const names = new Set([
        paths.relative(systemFile),
        paths.relative(notesFile),
      ]);
      yield* events.subscribe("file.changed").pipe(
        Stream.filter(({ file }) => names.has(file)),
        Stream.debounce("50 millis"),
        Stream.runForEach(() =>
          Effect.flatMap(get, (state) => events.publish("designSystem", state))
        ),
        Effect.forkScoped
      );

      return DesignSystemService.of({ detect, get, scan, write });
    })
  );
}
