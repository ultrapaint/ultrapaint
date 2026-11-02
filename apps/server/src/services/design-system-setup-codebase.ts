/**
 * How the design-system setup reads the code: the application's source files, those the folder's
 * `.gitignore` keeps (no git needed), as the style system reads them, against the saved design system or, before there is one, the
 * theme's scan.
 */
import { emptyDesignSystem } from "@ultrapaint/contracts/design-system";
import type { UsageContext, UsageReader } from "@ultrapaint/framework-api/node";
import { Clock, Effect, FileSystem, Path } from "effect";
import { makeWriteAtomic } from "../atomic-write.ts";
import { OpenProject } from "../project.ts";
import { CodeSide } from "./code-side.ts";
import { DesignSystemService } from "./design-system.ts";
import { refuse } from "./design-system-setup-store.ts";
import { RepoPaths } from "./repo-paths.ts";
import { ProjectStyleSystem } from "./style-system.ts";
import { WorkingTree } from "./working-tree.ts";

/** Bigger than this, a source file is generated or bundled, not written. */
const MAX_SOURCE_BYTES = 512 * 1024;
/** Files read between two yields, so the server keeps answering while the code is read. */
const FILES_PER_YIELD = 25;

/** What the code is read with: the design system, the style system's reader, and the files. */
export interface Codebase {
  readonly ctx: UsageContext;
  /** Application source files, repo-relative. */
  readonly files: readonly string[];
  readonly read: (file: string) => Effect.Effect<string | null>;
  /** The style system's reader of the code (ADR 0024). */
  readonly usage: UsageReader;
  readonly write: (file: string, text: string) => Effect.Effect<void>;
}

export const makeCodebaseReader = Effect.gen(function* () {
  const project = yield* OpenProject;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const writeAtomic = makeWriteAtomic(fs, path);

  /**
   * The code as the setup reads it: against the saved design system, or the theme's scan
   * when there is none yet and `saved` is not required.
   */
  const codebase = (required: boolean, perGroup?: number) =>
    project.use(
      Effect.gen(function* () {
        const paths = yield* RepoPaths;
        const tree = yield* WorkingTree;
        const { usage } = yield* ProjectStyleSystem;
        const saved = (yield* (yield* DesignSystemService).get).designSystem;
        if (required && !saved) {
          return yield* refuse(
            "There is no design system saved: Define writes design-system.json first."
          );
        }
        const theme = saved ? null : yield* (yield* CodeSide).scan;
        const designs = paths.relative(paths.designsDir);
        const files = (yield* tree.files).filter(
          (file) =>
            usage.includes(file) &&
            file !== designs &&
            !file.startsWith(`${designs}/`)
        );
        const ctx: UsageContext = {
          designSystem: saved ?? theme?.designSystem ?? emptyDesignSystem(),
          ownTokens: theme ? theme.ownTokens : null,
          ...(perGroup !== undefined && { perGroup }),
        };
        const read = (file: string) =>
          fs.readFileString(path.join(paths.root, file)).pipe(
            Effect.map((text): string | null =>
              text.length <= MAX_SOURCE_BYTES ? text : null
            ),
            // Listed and deleted since: there is nothing to read.
            Effect.orElseSucceed(() => null)
          );
        const write = (file: string, text: string) =>
          Effect.orDie(writeAtomic(path.join(paths.root, file), text));
        return { ctx, files, read, usage, write } satisfies Codebase;
      })
    );

  /** Every source file, read and handed to `f`, yielding now and then. */
  const eachSource = <A>(
    code: Codebase,
    f: (file: string, text: string) => A
  ) =>
    Effect.gen(function* () {
      const out: A[] = [];
      for (const [i, file] of code.files.entries()) {
        if (i % FILES_PER_YIELD === 0) {
          yield* Effect.yieldNow;
        }
        const text = yield* code.read(file);
        if (text !== null) {
          out.push(f(file, text));
        }
      }
      return out;
    });

  /** The code read and summed up against the design system the codebase holds. */
  const readCode = Effect.fnUntraced(function* (code: Codebase) {
    const scanned = yield* eachSource(code, (file, text) => ({
      file,
      uses: code.usage.scanFile(file, text),
    }));
    return code.usage.summarise(
      scanned,
      code.ctx,
      yield* Clock.currentTimeMillis
    );
  });

  return { codebase, eachSource, readCode };
});
