import {
  DESIGN_NOTES_FILE,
  DESIGN_SYSTEM_FILE,
  DesignSystem,
  type DesignSystemState,
  mapTokenRecords,
  mapTokens,
} from "@ultrapaint/contracts/design-system";
import { BadRequest } from "@ultrapaint/contracts/errors";
import type { SourceToken, TokenChange } from "@ultrapaint/contracts/tokens";
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
import { makeWriteAtomic } from "../atomic-write.ts";
import { EventBus } from "../events.ts";
import { CatalogueService } from "./catalogue.ts";
import { type EditFailure, EditService } from "./edit.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";

const decodeDesignSystem = Schema.decodeUnknownEffect(DesignSystem);

/**
 * The design system as the project records it: `design-system.json` and `DESIGN.md` at the root
 * of the designs directory. `/init` has an agent write them through `write`, which validates;
 * `detect` writes what the fixed-rule scan finds, for a project without an agent. Both are one
 * undo step, and the editor hears about every change, whoever made it.
 *
 * A token's value is the code's (ADR 0025): it is read through the style system every time, and
 * the file leaves it out for a token the code declares. A token the code does not declare keeps
 * the value the file gives it, if any.
 */
export class DesignSystemService extends Context.Service<
  DesignSystemService,
  {
    readonly detect: Effect.Effect<DesignSystem, EditFailure>;
    readonly get: Effect.Effect<DesignSystemState>;
    /** What the stylesheets say, with the catalogue's categories for the components. */
    readonly scan: Effect.Effect<DesignSystemScan>;
    /**
     * A token's value set in the code where the style system declares it, added when it is not
     * declared yet, or taken out (ADR 0025). Returns the files written and the value before,
     * for an undo.
     */
    readonly setToken: (change: TokenChange) => Effect.Effect<
      {
        readonly files: readonly string[];
        readonly previous: string | null;
      },
      BadRequest
    >;
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
      const styleSystem = yield* ProjectStyleSystem;
      const catalogue = yield* CatalogueService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const writeAtomic = makeWriteAtomic(fs, path);
      const systemFile = path.join(paths.designsDir, DESIGN_SYSTEM_FILE);
      const notesFile = path.join(paths.designsDir, DESIGN_NOTES_FILE);

      const readOptional = (file: string) =>
        Effect.orElseSucceed(
          Effect.map(fs.readFileString(file), (text): string | null => text),
          () => null
        );

      /** The tokens the code declares, by name; none when the stylesheets cannot be read. */
      const codeTokens = Effect.try(() => {
        const source = styleSystem.readTokens({
          anchorDir: paths.anchorDir,
          root: paths.root,
          settings: paths.settings,
        });
        return new Map<string, SourceToken>(
          source.tokens.map((t) => [t.name, t])
        );
      }).pipe(
        // A stylesheet that cannot be read leaves the file's own values in force.
        Effect.orElseSucceed(() => new Map<string, SourceToken>())
      );

      /** The code's value over the file's, for every token the code declares. */
      const withCodeValues = (
        ds: DesignSystem,
        code: ReadonlyMap<string, SourceToken>
      ): DesignSystem => {
        const merged = mapTokens(ds, (t) => {
          const found = code.get(t.name);
          if (!found) {
            return t;
          }
          const { values: _stale, ...rest } = t;
          return {
            ...rest,
            value: found.value,
            ...(found.values && { values: found.values }),
          };
        });
        const base = code.get("spacing")?.value;
        return base === undefined
          ? merged
          : { ...merged, spacing: { ...merged.spacing, base } };
      };

      /** What the file keeps: the values of the tokens the code declares left out. */
      const forFile = (
        ds: DesignSystem,
        code: ReadonlyMap<string, SourceToken>
      ): unknown =>
        mapTokenRecords(ds, (t) => {
          if (!(typeof t.name === "string" && code.has(t.name))) {
            return t;
          }
          const { value: _value, values: _values, ...rest } = t;
          return rest;
        });

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
              // A value the file leaves out is the code's, filled in below.
              try: () =>
                mapTokenRecords(JSON.parse(text) as unknown, (t) =>
                  "value" in t ? t : { ...t, value: "" }
                ),
            }),
            decodeDesignSystem
          )
        );
        return decoded._tag === "Success"
          ? {
              designSystem: withCodeValues(decoded.success, yield* codeTokens),
              notes,
            }
          : {
              designSystem: null,
              notes,
              problem: `${DESIGN_SYSTEM_FILE} is not valid: ${decoded.failure.message}`,
            };
      }).pipe(Effect.withSpan("DesignSystemService.get"));

      const scan = Effect.gen(function* () {
        const found = yield* Effect.sync(() =>
          styleSystem.scan({
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
        const code = yield* codeTokens;
        yield* edit.transaction("Update the design system", (tx) =>
          Effect.gen(function* () {
            yield* tx.write(
              paths.relative(systemFile),
              serialise(forFile(designSystem, code))
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

      const setToken = Effect.fn("DesignSystemService.setToken")(function* (
        change: TokenChange
      ) {
        const before = (yield* codeTokens).get(change.name);
        const previous =
          (change.theme ? before?.values?.[change.theme] : before?.value) ??
          null;
        const edits = yield* Effect.try({
          catch: (error) =>
            new BadRequest({
              message: `the stylesheets could not be written: ${String(error)}`,
            }),
          try: () =>
            styleSystem.writeTokens(
              {
                anchorDir: paths.anchorDir,
                root: paths.root,
                settings: paths.settings,
              },
              [change]
            ),
        });
        if (edits.length === 0) {
          return yield* new BadRequest({
            message: `${change.name} is not declared in a stylesheet of the repository, and there is none to add it to.`,
          });
        }
        const root = path.resolve(paths.root);
        for (const written of edits) {
          const file = path.resolve(root, written.file);
          if (!file.startsWith(root + path.sep)) {
            return yield* new BadRequest({
              message: `${written.file} is outside the repository`,
            });
          }
          yield* Effect.orDie(writeAtomic(file, written.text));
        }
        yield* Effect.flatMap(get, (state) =>
          events.publish("designSystem", state)
        );
        return { files: edits.map((e) => e.file), previous };
      });

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

      return DesignSystemService.of({ detect, get, scan, setToken, write });
    })
  );
}
